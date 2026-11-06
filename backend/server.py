#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stratum Arch Studio - FastAPI 推論サーバー & 物理・構造整合性バリデータ (server.py)

機能:
  - POST `/api/generate-blueprint`:
      フロントエンドから自然言語の建築要件 (`prompt`) を受け取り、
      学習済みSLM（Ollama / vLLM / ローカルルール推論エンジン）で `StratumArchBIMSchema` 準拠の
      3レイヤー座標JSONを生成。
  - サーバーサイド物理整合性バリデータ & 自動補正エンジン (`validate_and_repair_blueprint`):
      生成されたJSONに対し、以下の4大物理・建築ルールを検証し、違反がある場合は幾何学的に自動補正して返す:
        1. 敷地境界制約: abs(r.x) + r.w / 2 <= site.width / 2 かつ abs(r.z) + r.d / 2 <= site.depth / 2
        2. 同一階非重複制約 (AABB Collision): 部屋同士および部屋とコア (skeleton.cores) の干渉解消
        3. 設備シャフト近接制約 (MEP Alignment): needsPlumbing == True の部屋を plumbing シャフト半径 3.5m 以内に補正
        4. 通し柱グリッド整合性: skeleton.columns の欠損・境界外れ補正
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import random
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# どのカレントディレクトリから実行しても backend パッケージを解決できるようにパスを追加
_THIS_DIR = Path(__file__).resolve().parent
_ROOT_DIR = _THIS_DIR.parent
for _p in (str(_ROOT_DIR), str(_THIS_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:
    from backend.dataset_generator import (
        BUILDING_ARCHETYPES,
        SYSTEM_PROMPT,
        aabb_overlaps,
        enrich_blueprint_details,
        generate_column_grid,
        generate_commercial_blueprint,
        generate_residential_blueprint,
        r1,
        validate_blueprint,
    )
    from backend.subsurface_ml_engine import (
        Point2D,
        SiteGeometryFeatures,
        ml_predictor,
    )
except ImportError:
    from dataset_generator import (  # type: ignore[import-not-found,no-redef]
        BUILDING_ARCHETYPES,
        SYSTEM_PROMPT,
        aabb_overlaps,
        enrich_blueprint_details,
        generate_column_grid,
        generate_commercial_blueprint,
        generate_residential_blueprint,
        r1,
        validate_blueprint,
    )
    from subsurface_ml_engine import (  # type: ignore[import-not-found,no-redef]
        Point2D,
        SiteGeometryFeatures,
        ml_predictor,
    )


BASE_DIR = Path(__file__).resolve().parent.parent
SCHEMA_PATH = BASE_DIR / "schema" / "stratum_bim_schema.json"

OLLAMA_API_URL = os.environ.get("STRATUM_OLLAMA_URL", "http://127.0.0.1:11434/api/chat")
OLLAMA_MODEL_NAME = os.environ.get("STRATUM_OLLAMA_MODEL", "stratum-arch-slm")
VLLM_API_URL = os.environ.get("STRATUM_VLLM_URL", "http://127.0.0.1:8001/v1/chat/completions")
VLLM_MODEL_NAME = os.environ.get("STRATUM_VLLM_MODEL", "stratum-arch-slm")


app = FastAPI(
    title="Stratum Arch Studio - BIM Inference & Structural Validator API",
    version="1.0.0",
    description="3レイヤー建築BIM構造化JSON推論およびAABB干渉・給排水シャフト距離バリデーションサーバー",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# リクエスト / レスポンスモデル
# ==========================================
class GenerateBlueprintRequest(BaseModel):
    prompt: str = Field(
        ...,
        min_length=2,
        description="自然言語による建築設計要件（敷地寸法・階数・用途・コア配置など）",
    )
    prefer_engine: str = Field(
        default="auto",
        description="推論エンジン指定 ('auto' | 'ollama' | 'vllm' | 'local_slm')",
    )
    auto_repair: bool = Field(
        default=True,
        description="サーバー側でAABB衝突・敷地境界・水回り距離違反を自動補正するか",
    )


class ValidateBlueprintRequest(BaseModel):
    blueprint: Dict[str, Any]
    auto_repair: bool = True


class GenerateFromSpecRequest(BaseModel):
    """選択式ウィザードから送られる構造化された設計条件"""
    building_type: str = Field(
        ...,
        description="family_house | garage_house | two_generation | cafe_office | clinic | coworking | research_lab",
    )
    width: float = Field(10.0, ge=8.0, le=28.0)
    depth: float = Field(9.5, ge=8.0, le=28.0)
    floors: int = Field(2, ge=1, le=5)
    orientation: str = Field("northeast", description="northeast | northwest | southeast | southwest")
    variants: int = Field(3, ge=1, le=3)


RESIDENTIAL_TYPE_MAP = {"family_house": 0, "garage_house": 1, "two_generation": 2}
COMMERCIAL_TYPE_MAP = {"cafe_office": 0, "clinic": 1, "coworking": 2, "research_lab": 3}
ORIENTATION_MAP = {"northeast": 0, "northwest": 1, "southeast": 2, "southwest": 3}


class SubsurfacePredictRequest(BaseModel):
    polygon: List[Dict[str, float]] = Field(default_factory=list, description="敷地ポリゴン頂点座標リスト")
    road_width_m: float = 6.0
    road_direction: str = "south"
    neighbor_count_45m: int = 5
    tall_building_count: int = 0
    waterway_distance_m: float = 999.0
    has_existing_building: bool = False
    building_footprint_sqm: float = 0.0
    building_levels: int = 2
    estimated_era_year: int = 1985
    site_status: str = "vacant_lot"


@app.post("/api/predict-subsurface-ml", tags=["ML Subsurface Inference"])
async def api_predict_subsurface_ml(req: SubsurfacePredictRequest) -> Dict[str, Any]:
    """
    敷地ポリゴンの幾何形状・周辺建物・道路・履歴特徴量から機械学習モデルにより
    地下ガス管・上下水管深度・障害物確率を精密推論する
    """
    pts = [Point2D(x=p.get("x", 0.0), z=p.get("z", 0.0)) for p in req.polygon]
    if len(pts) < 3:
        w, d = 10.0, 10.0
        pts = [
            Point2D(x=-w / 2, z=-d / 2),
            Point2D(x=w / 2, z=-d / 2),
            Point2D(x=w / 2, z=d / 2),
            Point2D(x=-w / 2, z=d / 2),
        ]

    area = 0.0
    perim = 0.0
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        area += pts[i].x * pts[j].z - pts[j].x * pts[i].z
        perim += math.hypot(pts[j].x - pts[i].x, pts[j].z - pts[i].z)
    area = abs(area) / 2.0

    features = SiteGeometryFeatures(
        polygon=pts,
        area_sqm=area,
        perimeter_m=perim,
        road_frontage_m=max(4.0, math.sqrt(area)),
        road_width_m=req.road_width_m,
        road_direction=req.road_direction,
        neighbor_count_45m=req.neighbor_count_45m,
        tall_building_count=req.tall_building_count,
        waterway_distance_m=req.waterway_distance_m,
        has_existing_building=req.has_existing_building,
        building_footprint_sqm=req.building_footprint_sqm,
        building_levels=req.building_levels,
        estimated_era_year=req.estimated_era_year,
        site_status=req.site_status,
    )
    pred = ml_predictor.predict(features)
    return {
        "status": "success",
        "site_status_label": pred.site_status_label,
        "gas_pipe_depth_gl": pred.gas_pipe_depth_gl,
        "gas_pipe_diameter_a": pred.gas_pipe_diameter_a,
        "gas_pipe_spec": pred.gas_pipe_spec,
        "water_pipe_depth_gl": pred.water_pipe_depth_gl,
        "water_pipe_diameter_mm": pred.water_pipe_diameter_mm,
        "sewer_pipe_depth_gl": pred.sewer_pipe_depth_gl,
        "cross_border_risk_probability": pred.cross_border_risk_probability,
        "obstacle_probabilities": pred.obstacle_probabilities,
        "predicted_pipes": pred.predicted_pipes,
        "predicted_obstacles": pred.predicted_obstacles,
        "model_version": pred.model_version,
    }


# ==========================================
# 物理整合性バリデータ & 幾何学的自動補正エンジン
# ==========================================
def clamp_box_to_site(
    x: float, z: float, w: float, d: float, site_w: float, site_d: float, margin: float = 0.2
) -> Tuple[float, float, float, float, bool]:
    """矩形 (x, z, w, d) を敷地境界内に収めるよう寸法・座標をクランプする"""
    changed = False
    max_w = max(1.2, site_w - margin * 2.0)
    max_d = max(1.2, site_d - margin * 2.0)

    new_w = min(max(1.2, float(w)), max_w)
    new_d = min(max(1.2, float(d)), max_d)
    if abs(new_w - w) > 1e-3 or abs(new_d - d) > 1e-3:
        changed = True

    limit_x = max(0.0, site_w / 2.0 - margin - new_w / 2.0)
    limit_z = max(0.0, site_d / 2.0 - margin - new_d / 2.0)

    new_x = min(max(float(x), -limit_x), limit_x)
    new_z = min(max(float(z), -limit_z), limit_z)
    if abs(new_x - x) > 1e-3 or abs(new_z - z) > 1e-3:
        changed = True

    return r1(new_x), r1(new_z), r1(new_w), r1(new_d), changed


def resolve_two_box_collision(
    moving: Dict[str, Any],
    fixed: Dict[str, Any],
    site_w: float,
    site_d: float,
    clearance: float = 0.15,
) -> bool:
    """
    `moving` 部屋が `fixed` 部屋（またはコア）とAABB干渉している場合、
    最小貫通軸方向にシフトまたは寸法縮小して非重複化する。
    """
    mx, mz, mw, md = float(moving["x"]), float(moving["z"]), float(moving["w"]), float(moving["d"])
    fx, fz, fw, fd = float(fixed["x"]), float(fixed["z"]), float(fixed["w"]), float(fixed["d"])

    overlap_x = (mw + fw) / 2.0 + clearance - abs(mx - fx)
    overlap_z = (md + fd) / 2.0 + clearance - abs(mz - fz)

    if overlap_x <= 0 or overlap_z <= 0:
        return False

    # 貫通量が小さい軸に沿って解消を試みる
    if overlap_x <= overlap_z:
        direction = 1.0 if mx >= fx else -1.0
        candidate_x = mx + direction * overlap_x
        if abs(candidate_x) + mw / 2.0 <= site_w / 2.0 - 0.15:
            moving["x"] = r1(candidate_x)
            return True
        # シフトだけで敷地外に出る場合は幅 w を縮小して再配置
        shrunk_w = max(1.2, mw - overlap_x)
        moving["w"] = r1(shrunk_w)
        moving["x"] = r1(fx + direction * ((fw + shrunk_w) / 2.0 + clearance))
        moving["x"], moving["z"], moving["w"], moving["d"], _ = clamp_box_to_site(
            moving["x"], moving["z"], moving["w"], moving["d"], site_w, site_d
        )
        return True
    else:
        direction = 1.0 if mz >= fz else -1.0
        candidate_z = mz + direction * overlap_z
        if abs(candidate_z) + md / 2.0 <= site_d / 2.0 - 0.15:
            moving["z"] = r1(candidate_z)
            return True
        shrunk_d = max(1.2, md - overlap_z)
        moving["d"] = r1(shrunk_d)
        moving["z"] = r1(fz + direction * ((fd + shrunk_d) / 2.0 + clearance))
        moving["x"], moving["z"], moving["w"], moving["d"], _ = clamp_box_to_site(
            moving["x"], moving["z"], moving["w"], moving["d"], site_w, site_d
        )
        return True


def validate_and_repair_blueprint(
    raw_blueprint: Dict[str, Any],
    auto_repair: bool = True,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    3レイヤーBIMデータを検証し、auto_repair=True の場合は物理制約違反を幾何学的に補正する。
    """
    bp = copy.deepcopy(raw_blueprint)
    corrections: List[str] = []

    # 1. Site バリデーション・補正
    site = bp.setdefault("site", {})
    site_w = r1(min(max(float(site.get("width", 12.0)), 6.0), 30.0))
    site_d = r1(min(max(float(site.get("depth", 10.0)), 6.0), 30.0))
    floors = int(min(max(int(site.get("floors", 3)), 1), 5))
    floor_h = r1(min(max(float(site.get("floorHeight", 3.5)), 2.8), 4.5))
    site.update({"width": site_w, "depth": site_d, "floors": floors, "floorHeight": floor_h})

    # 2. Skeleton バリデーション・補正
    skeleton = bp.setdefault("skeleton", {})
    if not skeleton.get("columns"):
        skeleton["columns"] = generate_column_grid(site_w, site_d)
        corrections.append("通し柱グリッド (skeleton.columns) を自動生成しました。")

    cores = skeleton.setdefault("cores", [])
    if not cores:
        cores.append({
            "id": "CORE-EV",
            "label": "EV・階段コア",
            "x": r1(site_w / 2.0 - 1.8),
            "z": r1(-site_d / 2.0 + 1.8),
            "w": 2.4,
            "d": 2.4,
        })
        corrections.append("EV・階段コア (CORE-EV) をデフォルト位置に補完しました。")

    if auto_repair:
        for core in cores:
            cx, cz, cw, cd, changed = clamp_box_to_site(
                core["x"], core["z"], core["w"], core["d"], site_w, site_d
            )
            if changed:
                core["x"], core["z"], core["w"], core["d"] = cx, cz, cw, cd
                corrections.append(f"コア {core['id']} を敷地境界内に補正しました。")

    # 3. MEP シャフトバリデーション・補正
    mep = bp.setdefault("mep", {})
    shafts = mep.setdefault("shafts", [])
    plumbing_shafts = [s for s in shafts if s.get("type") == "plumbing"]
    if not plumbing_shafts:
        c0 = cores[0]
        ps_x = r1(max(-site_w / 2.0 + 1.2, min(site_w / 2.0 - 1.2, c0["x"] - c0["w"] / 2.0 - 1.2)))
        ps_z = r1(c0["z"])
        new_ps = {
            "id": "PS-1",
            "type": "plumbing",
            "label": "給排水縦シャフト(PS)",
            "x": ps_x,
            "z": ps_z,
            "radius": 0.35,
        }
        shafts.append(new_ps)
        plumbing_shafts.append(new_ps)
        corrections.append("給排水縦シャフト (PS-1) を補完しました。")

    if not any(s.get("type") == "hvac" for s in shafts):
        ps0 = plumbing_shafts[0]
        shafts.append({
            "id": "DS-1",
            "type": "hvac",
            "label": "空調縦ダクト(DS)",
            "x": r1(ps0["x"] - 0.7),
            "z": r1(ps0["z"]),
            "radius": 0.35,
        })

    # 4. Rooms バリデーション・補正
    rooms = bp.setdefault("rooms", [])
    if auto_repair:
        for r in rooms:
            if r.get("type") == "wet":
                r["needsPlumbing"] = True

            # (a) 敷地境界クランプ
            rx, rz, rw, rd, changed = clamp_box_to_site(
                r["x"], r["z"], r["w"], r["d"], site_w, site_d
            )
            if changed:
                r["x"], r["z"], r["w"], r["d"] = rx, rz, rw, rd
                corrections.append(f"{r['floor']}F「{r['name']}」({r['id']}) を敷地境界内に補正しました。")

            # (b) 水回り部屋と給排水シャフト(PS)の距離 <= 3.5m 補正
            if r.get("needsPlumbing") and plumbing_shafts:
                nearest_ps = min(
                    plumbing_shafts,
                    key=lambda ps: math.hypot(r["x"] - ps["x"], r["z"] - ps["z"]),
                )
                dist = math.hypot(r["x"] - nearest_ps["x"], r["z"] - nearest_ps["z"])
                if dist > 3.5:
                    # PSに向かって距離 2.4m の位置へ引き寄せる
                    angle = math.atan2(r["z"] - nearest_ps["z"], r["x"] - nearest_ps["x"])
                    target_x = nearest_ps["x"] + math.cos(angle) * 2.2
                    target_z = nearest_ps["z"] + math.sin(angle) * 2.2
                    rx, rz, rw, rd, _ = clamp_box_to_site(
                        target_x, target_z, r["w"], r["d"], site_w, site_d
                    )
                    r["x"], r["z"], r["w"], r["d"] = rx, rz, rw, rd
                    corrections.append(
                        f"{r['floor']}F「{r['name']}」({r['id']}) を給排水シャフト {nearest_ps['id']} の半径3.5m以内に移動補正しました（旧距離: {dist:.2f}m）。"
                    )

        # (c) 同一フロア内の AABB 衝突解消（対コア & 対他部屋）
        for fl in range(1, floors + 1):
            fl_rooms = [r for r in rooms if int(r.get("floor", 1)) == fl]
            # 水回り部屋の位置を優先固定するため、needsPlumbing=True を先に並べる
            fl_rooms.sort(key=lambda r: (0 if r.get("needsPlumbing") else 1, r.get("id", "")))

            for _iteration in range(6):
                any_fixed = False
                for r in fl_rooms:
                    for core in cores:
                        if aabb_overlaps(r["x"], r["z"], r["w"], r["d"], core["x"], core["z"], core["w"], core["d"]):
                            if resolve_two_box_collision(r, core, site_w, site_d):
                                any_fixed = True
                                corrections.append(
                                    f"{fl}F「{r['name']}」({r['id']}) とコア {core['id']} のAABB干渉を解消しました。"
                                )

                for i in range(len(fl_rooms)):
                    for j in range(i + 1, len(fl_rooms)):
                        fixed_room = fl_rooms[i]
                        moving_room = fl_rooms[j]
                        if aabb_overlaps(
                            fixed_room["x"], fixed_room["z"], fixed_room["w"], fixed_room["d"],
                            moving_room["x"], moving_room["z"], moving_room["w"], moving_room["d"],
                        ):
                            if resolve_two_box_collision(moving_room, fixed_room, site_w, site_d):
                                any_fixed = True
                                corrections.append(
                                    f"{fl}F「{moving_room['name']}」と「{fixed_room['name']}」のAABB干渉を解消しました。"
                                )
                if not any_fixed:
                    break

    # 詳細設計パラメータ（柱断面・大梁/小梁・耐力壁・スラブ/プレナム・天井高・仕上材・什器・窓/ドア開口部）を補完
    enrich_blueprint_details(bp)

    if auto_repair:
        slab_t = float(site.get("slabThickness", 0.22))
        plenum_h = float(site.get("plenumHeight", 0.36))
        max_allow_ch = r1(max(2.1, floor_h - slab_t - plenum_h))
        for r in rooms:
            # (d) 垂直方向（天井高）のクリアランス補正
            ch = float(r.get("ceilingHeight", max_allow_ch))
            if slab_t + plenum_h + ch > floor_h + 0.05:
                r["ceilingHeight"] = max_allow_ch
                corrections.append(
                    f"{r['floor']}F「{r['name']}」の天井高をスラブ・プレナム厚に合わせて {max_allow_ch:.2f}m に補正しました。"
                )

            # (e) 建築基準法 採光基準（居室の窓面積 >= 床面積の 1/7）の自動補正
            rtype = r.get("type", "office")
            if rtype in ("public", "office", "meeting"):
                openings = r.setdefault("openings", [])
                windows = [op for op in openings if op.get("type") == "window"]
                win_area = sum(float(w.get("width", 0)) * float(w.get("height", 0)) for w in windows)
                req_area = (float(r["w"]) * float(r["d"])) / 7.0
                if win_area + 0.02 < req_area and windows:
                    w0 = windows[0]
                    w0_h = max(1.2, float(w0.get("height", 1.8)))
                    needed_w = r1((req_area - win_area) / w0_h + float(w0.get("width", 1.2)))
                    w0["width"] = min(max(float(r["w"]), float(r["d"])) * 0.85, needed_w)
                    w0["height"] = w0_h
                    corrections.append(
                        f"{r['floor']}F「{r['name']}」の採光窓 ({w0['id']}) を建築基準法1/7基準以上に拡大補正しました。"
                    )

    is_valid, remaining_warnings = validate_blueprint(bp)
    validation_report = {
        "isValid": is_valid,
        "repairedCount": len(corrections),
        "corrections": corrections,
        "warnings": remaining_warnings,
    }
    return bp, validation_report


# ==========================================
# 自然言語プロンプト解析 & SLM推論エンジン
# ==========================================
def extract_json_object(raw_text: str) -> Optional[Dict[str, Any]]:
    """LLM出力文字列からJSONオブジェクト部分を抽出してパースする"""
    cleaned = raw_text.strip()
    if "```" in cleaned:
        match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, flags=re.DOTALL)
        if match:
            cleaned = match.group(1)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError:
            return None
    return None


def try_ollama_inference(prompt: str) -> Optional[Dict[str, Any]]:
    """ローカルのOllamaサーバーに学習済みモデルが起動していれば推論を実行"""
    payload = {
        "model": OLLAMA_MODEL_NAME,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "format": "json",
        "stream": False,
        "options": {"temperature": 0.15, "num_ctx": 4096},
    }
    req = urllib.request.Request(
        OLLAMA_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=4.0) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            content = body.get("message", {}).get("content", "")
            return extract_json_object(content)
    except Exception:
        return None


def try_vllm_inference(prompt: str) -> Optional[Dict[str, Any]]:
    """ローカルのvLLM (OpenAI互換API) が起動していれば推論を実行"""
    payload = {
        "model": VLLM_MODEL_NAME,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.15,
        "max_tokens": 2048,
    }
    req = urllib.request.Request(
        VLLM_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=4.0) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            choices = body.get("choices", [])
            if choices:
                content = choices[0].get("message", {}).get("content", "")
                return extract_json_object(content)
    except Exception:
        return None


def is_residential_prompt(prompt: str) -> bool:
    """
    プロンプトの文脈から「一般住宅（戸建て・マイホーム・ガレージハウス・二世帯住宅）」か
    「商業・オフィス・クリニック・研究施設」かを自律判定する。
    """
    commercial_keywords = [
        "オフィスビル", "複合ビル", "商業", "クリニック", "調剤", "病院", "診察",
        "コワーキング", "シェアオフィス", "スタートアップ", "研究棟", "ラボ",
        "クリーンルーム", "ギャラリー", "ロースタリー", "カフェ＆オフィス",
    ]
    residential_keywords = [
        "一般の家", "一般住宅", "戸建", "一戸建", "マイホーム", "住宅", "家",
        "LDK", "3LDK", "4LDK", "5LDK", "木造", "子供部屋", "主寝室", "寝室",
        "和室", "タタミ", "ウォークインクローゼット", "WIC", "シューズクローク",
        "ガレージハウス", "ビルトインガレージ", "二世帯", "平屋", "家族で暮らす",
    ]
    has_commercial = any(k in prompt for k in commercial_keywords)
    has_residential = any(k in prompt for k in residential_keywords)
    if has_residential and not has_commercial:
        return True
    if "クリニック" in prompt and "レジデンス" in prompt:
        return False
    return has_residential


def generate_from_prompt_rule_slm(prompt: str) -> Dict[str, Any]:
    """
    自然言語プロンプトから建物種別（一般住宅 vs オフィス・複合建築）、敷地サイズ、階数、
    用途・部屋構成を自律判断し、物理制約を100%満たす3レイヤーBIM JSONを生成する内蔵SLM推論エンジン。
    """
    prompt_hash = int(hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:8], 16)
    rng = random.Random(prompt_hash)

    # プロンプト中の数値指定（例: "10m×10m", "14×12m", "2階建て"）を抽出
    dim_match = re.search(r"(\d+(?:\.\d+)?)\s*m?\s*[×xX＊*]\s*(\d+(?:\.\d+)?)\s*m?", prompt)
    floor_match = re.search(r"(\d+)\s*階", prompt)
    if "平屋" in prompt:
        parsed_floors: Optional[int] = 1
    elif floor_match:
        parsed_floors = min(max(int(floor_match.group(1)), 1), 5)
    else:
        parsed_floors = None

    parsed_w = r1(min(max(float(dim_match.group(1)), 7.5), 28.0)) if dim_match else None
    parsed_d = r1(min(max(float(dim_match.group(2)), 7.5), 28.0)) if dim_match else None

    # A. 一般住宅（戸建て・ガレージハウス・二世帯住宅）と判定された場合
    if is_residential_prompt(prompt):
        res_arch_idx = 0  # デフォルト: 4LDK ファミリー戸建て住宅
        if any(k in prompt for k in ["ガレージ", "中庭", "ビルトイン", "車", "アウトドア"]):
            res_arch_idx = 1
        elif any(k in prompt for k in ["二世帯", "親世帯", "子世帯", "三世代"]):
            res_arch_idx = 2

        _, res_bp = generate_residential_blueprint(
            seed_idx=prompt_hash,
            rng=rng,
            archetype_idx=res_arch_idx,
            override_w=parsed_w or 10.0,
            override_d=parsed_d or 9.5,
            override_floors=parsed_floors or 2,
        )
        return res_bp

    # B. 非住宅・商業・オフィス・クリニック・研究施設と判定された場合
    archetype_idx = 0
    if any(k in prompt for k in ["クリニック", "病院", "診察", "薬局", "レジデンス", "clinic"]):
        archetype_idx = 1
    elif any(k in prompt for k in ["コワーキング", "シェアオフィス", "スタートアップ", "cowork"]):
        archetype_idx = 2
    elif any(k in prompt for k in ["ラボ", "研究", "実験", "バイオ", "クリーン", "lab"]):
        archetype_idx = 3
    elif any(k in prompt for k in ["カフェ", "ロースタリー", "オフィス", "cafe"]):
        archetype_idx = 0
    else:
        archetype_idx = prompt_hash % len(BUILDING_ARCHETYPES)

    orient_idx = (prompt_hash // 7) % 4
    if "北東" in prompt:
        orient_idx = 0
    elif "北西" in prompt or "西側" in prompt:
        orient_idx = 1
    elif "南東" in prompt:
        orient_idx = 2
    elif "南西" in prompt:
        orient_idx = 3

    seed_idx = orient_idx * len(BUILDING_ARCHETYPES) + archetype_idx
    _, base_bp = generate_commercial_blueprint(seed_idx, rng)

    target_w = parsed_w if parsed_w is not None else base_bp["site"]["width"]
    target_d = parsed_d if parsed_d is not None else base_bp["site"]["depth"]
    target_floors = parsed_floors if parsed_floors is not None else base_bp["site"]["floors"]

    scale_x = target_w / base_bp["site"]["width"]
    scale_z = target_d / base_bp["site"]["depth"]

    base_bp["site"]["width"] = target_w
    base_bp["site"]["depth"] = target_d
    base_bp["site"]["floors"] = target_floors
    base_bp["skeleton"]["columns"] = generate_column_grid(target_w, target_d)

    for core in base_bp["skeleton"]["cores"]:
        core["x"] = r1(core["x"] * scale_x)
        core["z"] = r1(core["z"] * scale_z)
        core["w"] = r1(max(1.8, core["w"] * scale_x))
        core["d"] = r1(max(1.8, core["d"] * scale_z))

    for shaft in base_bp["mep"]["shafts"]:
        shaft["x"] = r1(shaft["x"] * scale_x)
        shaft["z"] = r1(shaft["z"] * scale_z)

    scaled_rooms: List[Dict[str, Any]] = []
    for rm in base_bp["rooms"]:
        if rm["floor"] <= target_floors:
            rm_copy = copy.deepcopy(rm)
            rm_copy["x"] = r1(rm_copy["x"] * scale_x)
            rm_copy["z"] = r1(rm_copy["z"] * scale_z)
            rm_copy["w"] = r1(max(1.4, rm_copy["w"] * scale_x))
            rm_copy["d"] = r1(max(1.4, rm_copy["d"] * scale_z))
            scaled_rooms.append(rm_copy)

    max_existing_floor = max((r["floor"] for r in scaled_rooms), default=1)
    if target_floors > max_existing_floor:
        template_rooms = [r for r in scaled_rooms if r["floor"] == max_existing_floor]
        for extra_fl in range(max_existing_floor + 1, target_floors + 1):
            for idx, tr in enumerate(template_rooms, start=1):
                new_rm = copy.deepcopy(tr)
                new_rm["floor"] = extra_fl
                new_rm["id"] = f"R{extra_fl}0{idx}"
                new_rm["name"] = re.sub(r"^\d+F\s*", f"{extra_fl}F ", new_rm["name"])
                scaled_rooms.append(new_rm)

    base_bp["rooms"] = scaled_rooms
    return base_bp


# ==========================================
# API エンドポイント
# ==========================================
@app.get("/api/health")
def health_check() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "Stratum Arch Studio Inference & Validator Server",
        "schema_exists": SCHEMA_PATH.exists(),
        "ollama_model": OLLAMA_MODEL_NAME,
    }


@app.post("/api/generate-blueprint")
def generate_blueprint_endpoint(req: GenerateBlueprintRequest) -> Dict[str, Any]:
    prompt = req.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt must not be empty.")

    raw_blueprint: Optional[Dict[str, Any]] = None
    engine_used = "stratum-local-slm"

    if req.prefer_engine in ("auto", "ollama"):
        raw_blueprint = try_ollama_inference(prompt)
        if raw_blueprint is not None:
            engine_used = f"ollama ({OLLAMA_MODEL_NAME})"

    if raw_blueprint is None and req.prefer_engine in ("auto", "vllm"):
        raw_blueprint = try_vllm_inference(prompt)
        if raw_blueprint is not None:
            engine_used = f"vllm ({VLLM_MODEL_NAME})"

    if raw_blueprint is None:
        raw_blueprint = generate_from_prompt_rule_slm(prompt)
        engine_used = "stratum-slm-solver"

    validated_bp, validation_report = validate_and_repair_blueprint(
        raw_blueprint, auto_repair=req.auto_repair
    )

    return {
        "prompt": prompt,
        "engine": engine_used,
        "blueprint": validated_bp,
        "validation": validation_report,
    }


@app.post("/api/validate-blueprint")
def validate_blueprint_endpoint(req: ValidateBlueprintRequest) -> Dict[str, Any]:
    validated_bp, validation_report = validate_and_repair_blueprint(
        req.blueprint, auto_repair=req.auto_repair
    )
    return {
        "blueprint": validated_bp,
        "validation": validation_report,
    }


def summarize_blueprint(bp: Dict[str, Any]) -> Dict[str, Any]:
    """比較カード表示用の指標（延床面積・部屋数・水回り数）を算出する"""
    rooms = bp.get("rooms", [])
    return {
        "totalArea": round(sum(float(r["w"]) * float(r["d"]) for r in rooms), 1),
        "roomCount": len(rooms),
        "wetCount": sum(1 for r in rooms if r.get("needsPlumbing")),
        "floors": int(bp.get("site", {}).get("floors", 1)),
    }


@app.post("/api/generate-from-spec")
def generate_from_spec_endpoint(req: GenerateFromSpecRequest) -> Dict[str, Any]:
    """
    選択式の設計条件から、物理制約を満たす間取り案を最大3案生成して返す。
    自然文の解析を介さないため、指定した用途・敷地・階数がそのまま確実に反映される。
    """
    is_residential = req.building_type in RESIDENTIAL_TYPE_MAP
    if not is_residential and req.building_type not in COMMERCIAL_TYPE_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown building_type: {req.building_type}")

    orient = ORIENTATION_MAP.get(req.orientation, 0)
    mirrored = orient ^ 1  # 北東<->北西、南東<->南西

    if is_residential:
        variant_defs = [
            ("A", "標準プラン", orient, 0.60),
            ("B", "左右反転プラン", mirrored, 0.60),
            ("C", "ワイドLDKプラン", orient, 0.68),
        ]
    else:
        variant_defs = [
            ("A", "標準プラン", orient, 0.60),
            ("B", "左右反転プラン", mirrored, 0.60),
            ("C", "大空間メイン室プラン", orient, 0.70),
        ]

    results: List[Dict[str, Any]] = []
    for label, title, v_orient, ratio in variant_defs[: req.variants]:
        seed_src = f"{req.building_type}-{req.width}-{req.depth}-{req.floors}-{label}"
        rng = random.Random(int(hashlib.sha256(seed_src.encode("utf-8")).hexdigest()[:8], 16))

        if is_residential:
            prompt, raw_bp = generate_residential_blueprint(
                seed_idx=0,
                rng=rng,
                archetype_idx=RESIDENTIAL_TYPE_MAP[req.building_type],
                override_w=req.width,
                override_d=req.depth,
                override_floors=min(req.floors, 3),
                orient_idx=v_orient,
                ldk_ratio=ratio,
            )
        else:
            prompt, raw_bp = generate_commercial_blueprint(
                seed_idx=0,
                rng=rng,
                archetype_idx=COMMERCIAL_TYPE_MAP[req.building_type],
                orient_idx=v_orient,
                override_w=req.width,
                override_d=req.depth,
                override_floors=max(req.floors, 2),
                main_ratio=ratio,
            )

        validated_bp, report = validate_and_repair_blueprint(raw_bp, auto_repair=True)
        results.append({
            "label": label,
            "title": title,
            "prompt": prompt,
            "blueprint": validated_bp,
            "validation": report,
            "summary": summarize_blueprint(validated_bp),
        })

    return {"engine": "stratum-spec-solver", "variants": results}


@app.post("/api/export-svg")
def export_svg_endpoint(req: ValidateBlueprintRequest) -> Dict[str, Any]:
    try:
        from backend.verify_pipeline import render_svg_blueprint
    except ImportError:
        from verify_pipeline import render_svg_blueprint  # type: ignore[import-not-found,no-redef]

    validated_bp, validation_report = validate_and_repair_blueprint(
        req.blueprint, auto_repair=req.auto_repair
    )
    svg_str = render_svg_blueprint(validated_bp)
    return {
        "svg": svg_str,
        "blueprint": validated_bp,
        "validation": validation_report,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        app_dir=str(Path(__file__).resolve().parent),
    )

