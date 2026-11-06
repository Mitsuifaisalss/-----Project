#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stratum Arch Studio - E2E Pipeline Verifier & 2D CAD (SVG) Blueprint Exporter
1. data/train_stratum_bim.jsonl (500件) の全件物理制約監査
2. FastAPI (/api/generate-blueprint) の推論・自己修復エンジンの疎通テスト
3. 3レイヤーBIM JSONデータから建築模型・図面用の2DマルチレイヤーSVG図面を自動生成
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATASET_PATH = BASE_DIR / "data" / "train_stratum_bim.jsonl"
DEFAULT_SVG_OUT_PATH = BASE_DIR / "data" / "sample_stratum_plan.svg"


def check_aabb_collision(
    x1: float, z1: float, w1: float, d1: float,
    x2: float, z2: float, w2: float, d2: float,
    eps: float = 0.03
) -> bool:
    """2つの矩形が衝突しているか判定する（境界接触は許容）"""
    overlap_x = (w1 / 2.0 + w2 / 2.0) - abs(x1 - x2)
    overlap_z = (d1 / 2.0 + d2 / 2.0) - abs(z1 - z2)
    return (overlap_x - eps) > 0.0 and (overlap_z - eps) > 0.0


def audit_single_blueprint(bp: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """1件のStratumArchBIMSchemaデータを監査し、違反リストを返す"""
    errors: List[str] = []
    site = bp.get("site", {})
    sw = float(site.get("width", 0.0))
    sd = float(site.get("depth", 0.0))
    floors = int(site.get("floors", 0))

    if sw <= 0.0 or sd <= 0.0 or floors <= 0:
        errors.append("Invalid site dimensions or floors")
        return False, errors

    cores = bp.get("skeleton", {}).get("cores", [])
    shafts = bp.get("mep", {}).get("shafts", [])
    rooms = bp.get("rooms", [])
    plumbing_shafts = [s for s in shafts if s.get("type") == "plumbing"]

    half_w = sw / 2.0 + 0.05
    half_d = sd / 2.0 + 0.05

    # 1. 敷地境界チェック (Cores)
    for c in cores:
        if abs(c["x"]) + c["w"] / 2.0 > half_w or abs(c["z"]) + c["d"] / 2.0 > half_d:
            errors.append(f"Core {c['id']} exceeds site boundary")

    # 2. 部屋ごとの敷地境界 & 水回りシャフト距離チェック
    for r in rooms:
        if abs(r["x"]) + r["w"] / 2.0 > half_w or abs(r["z"]) + r["d"] / 2.0 > half_d:
            errors.append(f"Room {r['id']} (F{r['floor']}) exceeds site boundary")

        if r.get("needsPlumbing", False):
            if not plumbing_shafts:
                errors.append(f"Room {r['id']} requires plumbing but no PS shaft exists")
            else:
                min_dist = min(
                    math.hypot(r["x"] - ps["x"], r["z"] - ps["z"])
                    for ps in plumbing_shafts
                )
                if min_dist > 3.55:
                    errors.append(
                        f"Room {r['id']} (F{r['floor']}) plumbing distance {min_dist:.2f}m exceeds 3.5m limit"
                    )

        # 垂直方向クリアランス監査 (slabThickness + plenumHeight + ceilingHeight <= floorHeight)
        floor_h = float(site.get("floorHeight", 3.0))
        slab_t = float(site.get("slabThickness", 0.22))
        plenum_h = float(site.get("plenumHeight", 0.35))
        ch = float(r.get("ceilingHeight", site.get("defaultCeilingHeight", floor_h - slab_t - plenum_h)))
        if slab_t + plenum_h + ch > floor_h + 0.15:
            errors.append(f"Room {r['id']} vertical stack exceeds floorHeight {floor_h}m")

        # 建築基準法 居室採光監査 (窓面積 >= 床面積の 1/7)
        openings = r.get("openings", [])
        if openings and r.get("type") in ("public", "office", "meeting"):
            win_area = sum(
                float(op.get("width", 0.0)) * float(op.get("height", 0.0))
                for op in openings
                if op.get("type") == "window"
            )
            if win_area + 0.05 < (float(r["w"]) * float(r["d"])) / 7.0:
                errors.append(f"Room {r['id']} window area {win_area:.2f}m2 below 1/7 daylighting standard")

    # 3. 同一フロア内のAABB衝突チェック (Room vs Room, Room vs Core)
    for fl in range(1, floors + 1):
        fl_rooms = [r for r in rooms if int(r["floor"]) == fl]
        for i in range(len(fl_rooms)):
            r1 = fl_rooms[i]
            for c in cores:
                if check_aabb_collision(r1["x"], r1["z"], r1["w"], r1["d"], c["x"], c["z"], c["w"], c["d"]):
                    errors.append(f"Floor {fl}: Room {r1['id']} collides with Core {c['id']}")
            for j in range(i + 1, len(fl_rooms)):
                r2 = fl_rooms[j]
                if check_aabb_collision(r1["x"], r1["z"], r1["w"], r1["d"], r2["x"], r2["z"], r2["w"], r2["d"]):
                    errors.append(f"Floor {fl}: Room {r1['id']} collides with Room {r2['id']}")

    return len(errors) == 0, errors


def audit_jsonl_dataset(jsonl_path: Path) -> Tuple[int, int, Dict[str, Any]]:
    """JSONLデータセット全件を監査し、(合格件数, 総件数, 最初のサンプルのblueprint) を返す"""
    if not jsonl_path.exists():
        fallback_path = DEFAULT_DATASET_PATH
        if fallback_path.exists():
            jsonl_path = fallback_path
        else:
            print(f"[ERROR] Dataset file not found: {jsonl_path}")
            sys.exit(1)

    total = 0
    passed = 0
    first_bp: Dict[str, Any] = {}

    with jsonl_path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            line_str = line.strip()
            if not line_str:
                continue
            total += 1
            record = json.loads(line_str)
            messages = record.get("messages", [])
            assistant_msg = next((m["content"] for m in reversed(messages) if m.get("role") == "assistant"), "{}")
            bp = json.loads(assistant_msg)
            if not first_bp:
                first_bp = bp

            ok, errs = audit_single_blueprint(bp)
            if ok:
                passed += 1
            else:
                print(f"[WARN] Line {line_no} failed validation: {errs[0]}")

    return passed, total, first_bp


def render_svg_blueprint(bp: Dict[str, Any]) -> str:
    """
    StratumArchBIMSchema のJSONデータから、Claude風エディトリアル配色の
    全フロア横並び2D建築設計図（SVG文字列）を生成する。
    """
    site = bp["site"]
    sw = float(site["width"])
    sd = float(site["depth"])
    floors = int(site["floors"])
    scale = 34.0  # 1m = 34px (高精細CAD図面スケール)
    pad = 52.0

    panel_w = sw * scale + pad * 2.0
    panel_h = sd * scale + pad * 2.5
    total_w = panel_w * floors + pad
    total_h = panel_h + 76.0

    room_colors = {
        "public": ("#FBF7EE", "#6E6C67"),
        "wet": ("#EBF3F7", "#5A6E7F"),
        "office": ("#F6F4EE", "#6E6C67"),
        "meeting": ("#FBF8F1", "#6E6C67"),
        "service": ("#EFECE4", "#6E6C67"),
        "parking": ("#E8E6DF", "#5A574F"),
    }

    svg_lines: List[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_w:.1f} {total_h:.1f}" width="100%" height="100%">',
        '  <defs>',
        '    <pattern id="hatch-wood" width="40" height="5.5" patternUnits="userSpaceOnUse">',
        '      <line x1="0" y1="2.75" x2="40" y2="2.75" stroke="#D5D0C5" stroke-width="0.65" />',
        '    </pattern>',
        '    <pattern id="hatch-tile" width="14" height="14" patternUnits="userSpaceOnUse">',
        '      <path d="M 14 0 L 0 0 0 14" fill="none" stroke="#CBD4DC" stroke-width="0.6" />',
        '    </pattern>',
        '    <pattern id="hatch-closet" width="8" height="8" patternUnits="userSpaceOnUse">',
        '      <line x1="0" y1="8" x2="8" y2="0" stroke="#D2CEC4" stroke-width="0.6" />',
        '    </pattern>',
        '  </defs>',
        f'  <rect width="{total_w:.1f}" height="{total_h:.1f}" fill="#FAF9F5" />',
        f'  <text x="{pad:.1f}" y="36" font-family="Georgia, serif" font-size="18" font-weight="bold" fill="#1C1B18">',
        f'    Stratum Arch Studio — Professional Architectural CAD Plan ({sw:.1f}m x {sd:.1f}m, {floors}F)',
        '  </text>',
        f'  <line x1="{pad:.1f}" y1="48" x2="{total_w - pad:.1f}" y2="48" stroke="#D5D1C8" stroke-width="1" />'
    ]

    cores = bp.get("skeleton", {}).get("cores", [])
    columns = bp.get("skeleton", {}).get("columns", [])
    beams = bp.get("skeleton", {}).get("beams", [])
    shear_walls = bp.get("skeleton", {}).get("shearWalls", [])
    shafts = bp.get("mep", {}).get("shafts", [])
    rooms = bp.get("rooms", [])

    for fl in range(1, floors + 1):
        ox = pad / 2.0 + (fl - 1) * panel_w + pad + (sw * scale) / 2.0
        oz = 68.0 + pad + (sd * scale) / 2.0

        # フロアタイトル & 専有面積・坪数表記
        title_x = ox - (sw * scale) / 2.0
        title_y = oz - (sd * scale) / 2.0 - 14.0
        slab_t = float(site.get("slabThickness", 0.22))
        plenum_h = float(site.get("plenumHeight", 0.36))
        fl_rooms = [r for r in rooms if int(r["floor"]) == fl]
        fl_area = sum(float(r["w"]) * float(r["d"]) for r in fl_rooms)
        fl_tsubo = fl_area / 3.30578
        svg_lines.append(
            f'  <text x="{title_x:.1f}" y="{title_y:.1f}" font-family="monospace" font-size="11.5" font-weight="bold" fill="#1C1B18">'
            f'{fl}F ARCHITECTURAL PLAN — 床面積 {fl_area:.2f}㎡ (約{fl_tsubo:.2f}坪) / GL+{(fl - 1) * float(site["floorHeight"]):.1f}m / SLAB {slab_t:.2f}m</text>'
        )

        # 外周RC躯体フレーム（太いダークグレー外壁塗りと内壁）
        sx = ox - (sw * scale) / 2.0
        sz = oz - (sd * scale) / 2.0
        svg_lines.append(
            f'  <rect x="{sx:.1f}" y="{sz:.1f}" width="{sw * scale:.1f}" height="{sd * scale:.1f}" '
            f'fill="#F4F2EC" stroke="#6E6D68" stroke-width="6.5" />'
        )

        # Layer 1 (Background): Structural Grid Beams (大梁・小梁)
        for bm in beams:
            bx1 = ox + float(bm["x1"]) * scale
            bz1 = oz + float(bm["z1"]) * scale
            bx2 = ox + float(bm["x2"]) * scale
            bz2 = oz + float(bm["z2"]) * scale
            is_girder = bm.get("kind") == "girder"
            b_stroke = "#C2BDB2" if is_girder else "#D8D3C8"
            b_width = "1.1" if is_girder else "0.7"
            svg_lines.append(
                f'  <line x1="{bx1:.1f}" y1="{bz1:.1f}" x2="{bx2:.1f}" y2="{bz2:.1f}" '
                f'stroke="{b_stroke}" stroke-width="{b_width}" stroke-dasharray="3 3" />'
            )

        # Layer 3: Rooms (意匠・間取り層 + フローリング/タイルハッチング + 精密住宅設備CADシンボル + 開口部円弧)
        for r in fl_rooms:
            rx = ox + (float(r["x"]) - float(r["w"]) / 2.0) * scale
            rz = oz + (float(r["z"]) - float(r["d"]) / 2.0) * scale
            rw = float(r["w"]) * scale
            rd = float(r["d"]) * scale
            rtype = r.get("type", "office")
            rname = r.get("name", "")
            fill_col, stroke_col = room_colors.get(rtype, ("#F6F4EE", "#6E6C67"))

            # 1) 部屋ベース塗り + 間仕切り壁（ダブルライン風太線）
            svg_lines.append(
                f'  <rect x="{rx:.1f}" y="{rz:.1f}" width="{rw:.1f}" height="{rd:.1f}" '
                f'fill="{fill_col}" stroke="#6E6D68" stroke-width="3.6" />'
            )
            # 2) 床ハッチング（フローリング目地 or 磁気タイルグリッド）
            hatch_id = "hatch-tile" if rtype in ("wet", "service", "parking") else "hatch-wood"
            svg_lines.append(
                f'  <rect x="{rx + 2:.1f}" y="{rz + 2:.1f}" width="{max(0.0, rw - 4):.1f}" height="{max(0.0, rd - 4):.1f}" '
                f'fill="url(#{hatch_id})" pointer-events="none" />'
            )

            # 3) 精密住宅設備・家具CADシンボル描画 (fixtures)
            for fx in r.get("fixtures", []):
                fx_w = float(fx.get("w", 0.8)) * scale
                fx_d = float(fx.get("d", 0.8)) * scale
                fx_cx = ox + (float(r["x"]) + float(fx.get("localX", 0.0))) * scale
                fx_cz = oz + (float(r["z"]) + float(fx.get("localZ", 0.0))) * scale
                fx_x = fx_cx - fx_w / 2.0
                fx_z = fx_cz - fx_d / 2.0
                fx_type = fx.get("type", "")

                if fx_type == "unit_bath":
                    # ユニットバス (1620): 外枠 + 丸みのある内槽浴槽 + 排水口
                    svg_lines.append(
                        f'  <rect x="{fx_x:.1f}" y="{fx_z:.1f}" width="{fx_w:.1f}" height="{fx_d:.1f}" fill="#FFFFFF" stroke="#555" stroke-width="1.2" />'
                        f'  <rect x="{fx_x + 3:.1f}" y="{fx_z + 3:.1f}" width="{fx_w * 0.56:.1f}" height="{fx_d - 6:.1f}" rx="8" fill="#F4F9FC" stroke="#555" stroke-width="1.0" />'
                        f'  <circle cx="{fx_x + 3 + fx_w * 0.28:.1f}" cy="{fx_z + fx_d * 0.5:.1f}" r="2.2" fill="none" stroke="#555" stroke-width="0.8" />'
                    )
                elif fx_type == "toilet":
                    # トイレ: ロータンク + 楕円便器ボウル
                    svg_lines.append(
                        f'  <rect x="{fx_cx - fx_w * 0.38:.1f}" y="{fx_z + 2:.1f}" width="{fx_w * 0.76:.1f}" height="{fx_d * 0.28:.1f}" fill="#FFFFFF" stroke="#555" stroke-width="1.0" />'
                        f'  <ellipse cx="{fx_cx:.1f}" cy="{fx_z + fx_d * 0.62:.1f}" rx="{fx_w * 0.34:.1f}" ry="{fx_d * 0.32:.1f}" fill="#FFFFFF" stroke="#555" stroke-width="1.0" />'
                    )
                elif fx_type == "sink":
                    # 洗面化粧台 + 楕円ボウル
                    svg_lines.append(
                        f'  <rect x="{fx_x:.1f}" y="{fx_z:.1f}" width="{fx_w:.1f}" height="{fx_d:.1f}" fill="#FFFFFF" stroke="#555" stroke-width="1.0" />'
                        f'  <ellipse cx="{fx_cx:.1f}" cy="{fx_cz:.1f}" rx="{fx_w * 0.32:.1f}" ry="{fx_d * 0.28:.1f}" fill="#F4F9FC" stroke="#555" stroke-width="0.9" />'
                    )
                elif fx_type == "island_kitchen":
                    # システムキッチン: 3口コンロ + シンクボウル + 水栓
                    svg_lines.append(
                        f'  <rect x="{fx_x:.1f}" y="{fx_z:.1f}" width="{fx_w:.1f}" height="{fx_d:.1f}" fill="#FFFFFF" stroke="#555" stroke-width="1.2" />'
                        f'  <rect x="{fx_x + fx_w * 0.08:.1f}" y="{fx_z + fx_d * 0.18:.1f}" width="{fx_w * 0.26:.1f}" height="{fx_d * 0.64:.1f}" fill="#FAFAFA" stroke="#555" stroke-width="0.9" />'
                        f'  <circle cx="{fx_x + fx_w * 0.15:.1f}" cy="{fx_z + fx_d * 0.38:.1f}" r="2.8" fill="none" stroke="#444" stroke-width="0.9" />'
                        f'  <circle cx="{fx_x + fx_w * 0.27:.1f}" cy="{fx_z + fx_d * 0.38:.1f}" r="2.8" fill="none" stroke="#444" stroke-width="0.9" />'
                        f'  <circle cx="{fx_x + fx_w * 0.21:.1f}" cy="{fx_z + fx_d * 0.64:.1f}" r="2.2" fill="none" stroke="#444" stroke-width="0.9" />'
                        f'  <rect x="{fx_x + fx_w * 0.52:.1f}" y="{fx_z + fx_d * 0.16:.1f}" width="{fx_w * 0.36:.1f}" height="{fx_d * 0.68:.1f}" rx="3" fill="#F4F9FC" stroke="#555" stroke-width="0.9" />'
                    )
                elif fx_type == "bed":
                    # ベッド + 枕2つ + 掛け布団の折り返し曲線
                    svg_lines.append(
                        f'  <rect x="{fx_x:.1f}" y="{fx_z:.1f}" width="{fx_w:.1f}" height="{fx_d:.1f}" fill="#FFFFFF" stroke="#555" stroke-width="1.1" />'
                        f'  <rect x="{fx_x + 3:.1f}" y="{fx_z + 4:.1f}" width="{fx_w * 0.22:.1f}" height="{fx_d * 0.36:.1f}" rx="2" fill="#FAF9F5" stroke="#666" stroke-width="0.8" />'
                        f'  <rect x="{fx_x + 3:.1f}" y="{fx_z + fx_d * 0.56:.1f}" width="{fx_w * 0.22:.1f}" height="{fx_d * 0.36:.1f}" rx="2" fill="#FAF9F5" stroke="#666" stroke-width="0.8" />'
                        f'  <path d="M {fx_x + fx_w * 0.34:.1f} {fx_z:.1f} Q {fx_x + fx_w * 0.48:.1f} {fx_cz:.1f} {fx_x + fx_w * 0.32:.1f} {fx_z + fx_d:.1f}" fill="none" stroke="#555" stroke-width="1.0" />'
                    )
                else:
                    # ダイニングテーブル・デスク + 椅子シンボル
                    svg_lines.append(
                        f'  <rect x="{fx_x:.1f}" y="{fx_z:.1f}" width="{fx_w:.1f}" height="{fx_d:.1f}" fill="#FFFFFF" stroke="#555" stroke-width="1.0" rx="1" />'
                    )

            # 4) 開口部・建具 (openings: 二重線引違窓サッシ & 90度円弧開き戸)
            for op in r.get("openings", []):
                op_x = ox + float(op.get("x", r["x"])) * scale
                op_z = oz + float(op.get("z", r["z"])) * scale
                op_w = float(op.get("width", 0.9)) * scale
                wall = op.get("wall", "south")
                is_win = op.get("type") == "window"
                if is_win:
                    if wall in ("north", "south"):
                        svg_lines.append(
                            f'  <rect x="{op_x - op_w / 2.0:.1f}" y="{op_z - 2.6:.1f}" width="{op_w:.1f}" height="5.2" fill="#FFFFFF" stroke="#555" stroke-width="1.1" />'
                            f'  <line x1="{op_x - op_w / 2.0:.1f}" y1="{op_z:.1f}" x2="{op_x + op_w / 2.0:.1f}" y2="{op_z:.1f}" stroke="#4A7C9B" stroke-width="1.0" />'
                        )
                    else:
                        svg_lines.append(
                            f'  <rect x="{op_x - 2.6:.1f}" y="{op_z - op_w / 2.0:.1f}" width="5.2" height="{op_w:.1f}" fill="#FFFFFF" stroke="#555" stroke-width="1.1" />'
                            f'  <line x1="{op_x:.1f}" y1="{op_z - op_w / 2.0:.1f}" x2="{op_x:.1f}" y2="{op_z + op_w / 2.0:.1f}" stroke="#4A7C9B" stroke-width="1.0" />'
                        )
                else:
                    # 開き戸: 壁スリット消去 + ドアパネル線 + 90度円弧軌跡
                    dr = min(op_w, 26.0)
                    if wall in ("north", "south"):
                        sign_z = 1.0 if wall == "north" else -1.0
                        hx = op_x - dr / 2.0
                        hz = op_z
                        svg_lines.append(
                            f'  <rect x="{hx:.1f}" y="{hz - 2.5:.1f}" width="{dr:.1f}" height="5.0" fill="{fill_col}" />'
                            f'  <line x1="{hx:.1f}" y1="{hz:.1f}" x2="{hx:.1f}" y2="{hz + sign_z * dr:.1f}" stroke="#444" stroke-width="1.3" />'
                            f'  <path d="M {hx:.1f} {hz + sign_z * dr:.1f} A {dr:.1f} {dr:.1f} 0 0 {1 if sign_z > 0 else 0} {hx + dr:.1f} {hz:.1f}" fill="none" stroke="#666" stroke-width="0.85" />'
                        )
                    else:
                        sign_x = 1.0 if wall == "west" else -1.0
                        hx = op_x
                        hz = op_z - dr / 2.0
                        svg_lines.append(
                            f'  <rect x="{hx - 2.5:.1f}" y="{hz:.1f}" width="5.0" height="{dr:.1f}" fill="{fill_col}" />'
                            f'  <line x1="{hx:.1f}" y1="{hz:.1f}" x2="{hx + sign_x * dr:.1f}" y2="{hz:.1f}" stroke="#444" stroke-width="1.3" />'
                            f'  <path d="M {hx + sign_x * dr:.1f} {hz:.1f} A {dr:.1f} {dr:.1f} 0 0 {0 if sign_x > 0 else 1} {hx:.1f} {hz + dr:.1f}" fill="none" stroke="#666" stroke-width="0.85" />'
                        )

            # 5) 室名 & 畳数 (約XX.X畳) & 天井高表記
            cx = ox + float(r["x"]) * scale
            cz = oz + float(r["z"]) * scale
            tatami_j = (float(r["w"]) * float(r["d"])) / 1.62
            ch_val = float(r.get("ceilingHeight", site.get("defaultCeilingHeight", 2.5)))
            svg_lines.append(
                f'  <text x="{cx:.1f}" y="{cz - 4:.1f}" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="10" font-weight="bold" fill="#1C1B18">{rname}</text>'
            )
            svg_lines.append(
                f'  <text x="{cx:.1f}" y="{cz + 8:.1f}" text-anchor="middle" font-family="sans-serif" font-size="8.2" fill="#4A4843">(約{tatami_j:.1f}畳 / CH={ch_val:.2f}m)</text>'
            )

        # Layer 1: Cores, Shear Walls & Columns (構造スケルトン層)
        for sw_item in shear_walls:
            wx1 = ox + float(sw_item["x1"]) * scale
            wz1 = oz + float(sw_item["z1"]) * scale
            wx2 = ox + float(sw_item["x2"]) * scale
            wz2 = oz + float(sw_item["z2"]) * scale
            svg_lines.append(
                f'  <line x1="{wx1:.1f}" y1="{wz1:.1f}" x2="{wx2:.1f}" y2="{wz2:.1f}" stroke="#1C1B18" stroke-width="3.2" />'
            )

        for c in cores:
            cx_rect = ox + (float(c["x"]) - float(c["w"]) / 2.0) * scale
            cz_rect = oz + (float(c["z"]) - float(c["d"]) / 2.0) * scale
            cw = float(c["w"]) * scale
            cd = float(c["d"]) * scale
            svg_lines.append(
                f'  <rect x="{cx_rect:.1f}" y="{cz_rect:.1f}" width="{cw:.1f}" height="{cd:.1f}" '
                f'fill="#D5D1C8" stroke="#1C1B18" stroke-width="1.5" />'
            )
            svg_lines.append(
                f'  <text x="{ox + float(c["x"]) * scale:.1f}" y="{oz + float(c["z"]) * scale + 3:.1f}" '
                f'text-anchor="middle" font-family="monospace" font-size="8.5" font-weight="bold" fill="#1C1B18">{c["label"]}</text>'
            )

        for col in columns:
            cw_px = max(6.0, float(col.get("width", 0.5)) * scale)
            cd_px = max(6.0, float(col.get("depth", 0.5)) * scale)
            col_x = ox + float(col["x"]) * scale - cw_px / 2.0
            col_z = oz + float(col["z"]) * scale - cd_px / 2.0
            svg_lines.append(
                f'  <rect x="{col_x:.1f}" y="{col_z:.1f}" width="{cw_px:.1f}" height="{cd_px:.1f}" fill="#1C1B18" />'
            )

        # Layer 2: MEP Shafts (設備配管シャフト層 + 3.5m給排水カバー半径)
        for sh in shafts:
            sh_x = ox + float(sh["x"]) * scale
            sh_z = oz + float(sh["z"]) * scale
            sh_r = max(5.0, float(sh.get("radius", 0.35)) * scale)
            is_plumbing = sh.get("type") == "plumbing"
            col_mep = "#4A7C9B" if is_plumbing else "#5B7A5E"
            if is_plumbing:
                reach_r = 3.5 * scale
                svg_lines.append(
                    f'  <circle cx="{sh_x:.1f}" cy="{sh_z:.1f}" r="{reach_r:.1f}" '
                    f'fill="none" stroke="#4A7C9B" stroke-width="0.8" stroke-dasharray="3 3" opacity="0.65" />'
                )
            svg_lines.append(
                f'  <circle cx="{sh_x:.1f}" cy="{sh_z:.1f}" r="{sh_r:.1f}" fill="{col_mep}" stroke="#FAF9F5" stroke-width="1.2" />'
            )

    svg_lines.append("</svg>")
    return "\n".join(svg_lines)


def export_svg_blueprint(bp: Dict[str, Any], output_svg_path: Path) -> None:
    """StratumArchBIMSchema のJSONデータから2D建築設計図（SVG）をファイル出力する"""
    svg_content = render_svg_blueprint(bp)
    output_svg_path.parent.mkdir(parents=True, exist_ok=True)
    output_svg_path.write_text(svg_content, encoding="utf-8")


def test_live_api(api_url: str, prompt: str) -> Optional[Dict[str, Any]]:
    """起動中のFastAPIサーバー (/api/generate-blueprint) にリクエストを送り応答を検証する"""
    payload = json.dumps({"prompt": prompt}).encode("utf-8")
    req = urllib.request.Request(
        api_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            # レスポンスが直接スキーマか {"blueprint": ...} ラップかを吸収
            bp = body.get("blueprint", body) if isinstance(body, dict) else None
            return bp
    except urllib.error.URLError as e:
        print(f"[INFO] Live API server ({api_url}) is not running yet or unreachable: {e}")
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify Stratum BIM Dataset & Export 2D SVG Plan")
    parser.add_argument("--dataset", type=str, default=str(DEFAULT_DATASET_PATH), help="Path to JSONL dataset")
    parser.add_argument("--svg-out", type=str, default=str(DEFAULT_SVG_OUT_PATH), help="Output path for 2D SVG blueprint")
    parser.add_argument("--api-url", type=str, default="http://127.0.0.1:8000/api/generate-blueprint", help="FastAPI endpoint URL")
    args = parser.parse_args()

    dataset_path = Path(args.dataset)
    svg_out_path = Path(args.svg_out)

    print("=== [Step 1] Auditing Synthetic BIM Dataset ===")
    passed, total, sample_bp = audit_jsonl_dataset(dataset_path)
    pass_rate = (passed / total * 100.0) if total > 0 else 0.0
    print(f"Dataset Audit Result: {passed} / {total} passed ({pass_rate:.2f}%)")

    if sample_bp:
        print(f"=== [Step 2] Exporting 2D Editorial SVG Blueprint -> {svg_out_path} ===")
        export_svg_blueprint(sample_bp, svg_out_path)
        print(f"Saved SVG floor plan to: {svg_out_path}")

    print("=== [Step 3] Testing Live FastAPI Inference Endpoint ===")
    test_prompt = "敷地幅14m×奥行12m、3階建てのカフェ併用スタートアップオフィスビルを設計して。"
    api_bp = test_live_api(args.api_url, test_prompt)
    if api_bp and "site" in api_bp:
        ok, errs = audit_single_blueprint(api_bp)
        status_str = "PASSED all physical constraints" if ok else f"FAILED: {errs}"
        print(f"Live API Response Audit: {status_str}")
    else:
        print("Skipped live API audit (Start backend/server.py to test live HTTP inference).")


if __name__ == "__main__":
    main()

