#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stratum Arch Studio - 建築3レイヤー合成データセット生成スクリプト (dataset_generator.py)

機能:
  - AIがプロンプトから「一般住宅（木造戸建て・4LDK・ガレージハウス・二世帯住宅）」と
    「非住宅・複合建築（カフェ併用オフィス、クリニック、コワーキング、研究ラボ等）」を自律判断できるよう、
    住宅専用の間取り分割アルゴリズム（LDK・玄関・浴室洗面・主寝室・子供部屋A/B・WIC・和室・バルコニー）と
    商業・オフィス用空間分割アルゴリズムの両方を搭載。
  - `schema/stratum_bim_schema.json` および4大物理・建築整合性ルールを100%満たす500件のChatML JSONLを生成。
"""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path
from typing import Any, Dict, List, Tuple


BASE_DIR = Path(__file__).resolve().parent.parent
SCHEMA_PATH = BASE_DIR / "schema" / "stratum_bim_schema.json"
DEFAULT_OUTPUT_PATH = BASE_DIR / "data" / "train_stratum_bim.jsonl"

SYSTEM_PROMPT = (
    "あなたは建築構造・設備・意匠の3レイヤー統合BIM設計AI「Stratum Arch SLM」です。\n"
    "ユーザーの自然言語による建築要件から、建物の種別（一般戸建て住宅・ガレージハウス・二世帯住宅、または"
    "オフィス・カフェ・クリニック・研究施設等の複合建築）を自律的に判断し、"
    "StratumArchBIMSchemaに厳密に準拠したJSONデータのみを出力してください。\n"
    "・一般住宅の場合は、玄関ホール・LDK・浴室洗面脱衣・トイレ・主寝室・子供部屋・和室・WIC・バルコニー等の"
    "住宅特有の部屋割りと室内階段コアを計画すること。\n"
    "・オフィス・商業建築の場合は、EV階段コア・執務空間・会議室・店舗ラウンジ等を計画すること。\n"
    "【必須物理制約】\n"
    "1. 敷地境界制約: すべての部屋およびコアは abs(x) + w/2 <= site.width/2 かつ abs(z) + d/2 <= site.depth/2 を満たすこと。\n"
    "2. 非重複制約(AABB): 同一フロア内の部屋同士、および部屋と階段/EVコア(skeleton.cores)が重ならないこと。\n"
    "3. 設備シャフト近接制約: needsPlumbing=true の部屋は mep.shafts(type='plumbing') からユークリッド距離3.5m以内に配置すること。\n"
    "4. 通し柱グリッド: skeleton.columns は1階から最上階まで貫通する構造グリッド座標とすること。"
)

ALLOWED_ROOM_TYPES = {"public", "service", "wet", "office", "meeting", "parking"}


# ==========================================
# 1. 一般住宅（戸建て・ガレージハウス・二世帯）テンプレート定義
# ==========================================
RESIDENTIAL_ARCHETYPES = [
    {
        "key": "detached_family_house",
        "title": "4LDK ファミリー戸建て住宅",
        "structure": ["木造軸組工法(在来工法)", "木造SE構法", "軽量鉄骨造"],
        "core_label": "室内階段ホール",
        "f1_wet": "浴室・洗面脱衣・1Fトイレ",
        "f1_entry": "玄関ホール・SIC(土間収納)",
        "f1_ldk": "南向きLDK(リビング・ダイニング・キッチン)",
        "f1_extra": ("和室(客間・タタミコーナー)", "meeting", False),
        "f2_wet": "2Fトイレ・洗面コーナー",
        "f2_master": "主寝室(マスターベッドルーム)",
        "f2_wic": "ウォークインクローゼット(WIC)・書斎",
        "f2_kids_a": "子供部屋A(南西洋室)",
        "f2_kids_b": "子供部屋B(南東洋室)",
        "f2_balcony": "南面ワイドバルコニー",
        "f3_main": "セカンドリビング・シアタールーム",
        "f3_sub": "ゲスト寝室・ワークルーム",
        "f3_terrace": "ルーフバルコニー・スカイテラス",
    },
    {
        "key": "garage_courtyard_house",
        "title": "ビルトインガレージ＆中庭テラスのある家",
        "structure": ["木造SE構法", "RC一部木造混構造", "重量鉄骨造"],
        "core_label": "吹抜スケルトン階段",
        "f1_wet": "1F バスルーム・ランドリー・トイレ",
        "f1_entry": "玄関土間・ツールストレージ",
        "f1_ldk": "趣味ラウンジ・ホビースタジオ",
        "f1_extra": ("ビルトインガレージ(愛車2台)", "parking", False),
        "f2_wet": "2F アイランドキッチン水回り・トイレ",
        "f2_master": "2F 大空間LDK(リビング・ダイニング)",
        "f2_wic": "パントリー・家事ユーティリティ",
        "f2_kids_a": "主寝室(マスタースイート)",
        "f2_kids_b": "ワーク書斎・スタディコーナー",
        "f2_balcony": "中庭アウトドアリビング(ウッドデッキ)",
        "f3_main": "子供部屋A・B(可動間仕切り洋室)",
        "f3_sub": "ファミリーライブラリー・収納",
        "f3_terrace": "南向きルーフテラス",
    },
    {
        "key": "two_generation_house",
        "title": "都市型二世帯住宅（親世帯・子世帯）",
        "structure": ["木造SE構法", "軽量鉄骨造", "RC造"],
        "core_label": "共用階段・ホームEVコア",
        "f1_wet": "1F 親世帯バリアフリー浴室・洗面・トイレ",
        "f1_entry": "共有玄関ホール・シューズクローク",
        "f1_ldk": "1F 親世帯LDK(ダイニング・居間)",
        "f1_extra": ("1F 親世帯寝室・本格和室", "meeting", False),
        "f2_wet": "2F 子世帯バス・サニタリー・キッチン水回り",
        "f2_master": "2F 子世帯メインLDK",
        "f2_wic": "パントリー・ファミリークローゼット",
        "f2_kids_a": "子世帯マスターベッドルーム",
        "f2_kids_b": "スタディールーム・家事室",
        "f2_balcony": "2F インナーバルコニー",
        "f3_main": "3F 子供部屋A・子供部屋B",
        "f3_sub": "テレワーク書斎・納戸",
        "f3_terrace": "3F ルーフガーデン",
    },
]


# ==========================================
# 2. 非住宅・商業・オフィス複合建築テンプレート定義
# ==========================================
BUILDING_ARCHETYPES = [
    {
        "key": "cafe_office",
        "title": "カフェ＆デザインオフィス複合ビル",
        "structure": ["鉄骨造(S造)", "RC造", "木質ハイブリッド構造"],
        "f1_main": [
            ("ロースタリーカフェ客席", "public", False),
            ("カフェラウンジ・ベーカリー", "public", False),
            ("コーヒースタンド＆ギャラリー", "public", False),
        ],
        "f1_sub": [
            ("ピロティ駐車場", "parking", False),
            ("搬入・駐輪ピロティ", "parking", False),
            ("焙煎・バックヤード", "service", True),
        ],
        "upper_main": [
            ("メイン執務スタジオ", "office", False),
            ("オープンプラン執務室", "office", False),
            ("デザインワークスペース", "office", False),
        ],
        "upper_sub": [
            ("ミーティングルームA", "meeting", False),
            ("クライアント会議室", "meeting", False),
            ("集中ブース・書庫", "service", False),
        ],
        "top_main": [
            ("デザインライブラリー＆ラウンジ", "public", False),
            ("エグゼクティブオフィス", "office", False),
        ],
        "top_sub": [
            ("ボードルーム", "meeting", False),
            ("クリエイティブサロン", "public", False),
        ],
        "wet_names": [
            "共用トイレ・洗面",
            "トイレ・給湯パントリー",
            "サニタリー・シャワー室",
        ],
    },
    {
        "key": "clinic_residence",
        "title": "都市型クリニック＆職住一体レジデンス",
        "structure": ["RC造", "重量鉄骨造"],
        "f1_main": [
            ("待合ラウンジ・受付ホール", "public", False),
            ("クリニック待合・キッズコーナー", "public", False),
        ],
        "f1_sub": [
            ("第一診察室・処置室", "office", True),
            ("調剤薬局カウンター", "service", True),
            ("来院者用ピロティ駐車場", "parking", False),
        ],
        "upper_main": [
            ("サウスリビング・ダイニング", "public", False),
            ("ファミリーラウンジ・LDK", "public", True),
        ],
        "upper_sub": [
            ("ワークアトリエ・書斎", "office", False),
            ("プライベート個室・寝室", "meeting", False),
            ("納戸・ユーティリティ", "service", False),
        ],
        "top_main": [
            ("ペントハウスラウンジ", "public", False),
            ("スカイリビング＆サンルーム", "public", False),
        ],
        "top_sub": [
            ("ゲストスイート", "meeting", False),
            ("ホームオフィス", "office", False),
        ],
        "wet_names": [
            "多目的トイレ・手洗室",
            "バス・サニタリー水回りコア",
            "ゲスト用バス・洗面室",
        ],
    },
    {
        "key": "coworking_hub",
        "title": "シェアオフィス＆コワーキングハブ",
        "structure": ["鉄骨造(S造)", "RC造"],
        "f1_main": [
            ("コワーキングラウンジ・レセプション", "public", False),
            ("イベント＆ピッチスペース", "public", False),
        ],
        "f1_sub": [
            ("シェアサイクル・駐車場", "parking", False),
            ("カフェバー＆サポートデスク", "service", True),
        ],
        "upper_main": [
            ("フレックス執務ゾーン", "office", False),
            ("スタートアップ専用デスク", "office", False),
        ],
        "upper_sub": [
            ("防音オンライン会議室", "meeting", False),
            ("プロジェクトルーム", "meeting", False),
            ("サーバー・コピー室", "service", False),
        ],
        "top_main": [
            ("メンバーズサロン＆ラウンジ", "public", False),
            ("コワーキングメインホール", "office", False),
        ],
        "top_sub": [
            ("カンファレンスルーム", "meeting", False),
            ("ポッドキャスト収録スタジオ", "service", False),
        ],
        "wet_names": [
            "1F 男女トイレ・パウダーコーナー",
            "リフレッシュ給湯・トイレ",
            "サニタリー・リフレッシュ水回り",
        ],
    },
    {
        "key": "research_lab",
        "title": "バイオ・マテリアルR&D研究棟",
        "structure": ["RC造", "SRC造", "重量鉄骨造"],
        "f1_main": [
            ("材料試験・プロトタイピングホール", "office", False),
            ("基礎実験ラボ・計測室", "office", True),
        ],
        "f1_sub": [
            ("大型機器搬入ローディングヤード", "parking", False),
            ("薬品保管・ボンベ庫", "service", False),
        ],
        "upper_main": [
            ("メインウェットラボ・解析室", "office", True),
            ("バイオクリーン実験室", "office", False),
        ],
        "upper_sub": [
            ("データ解析・シミュレーション室", "meeting", False),
            ("共同研究ディスカッション室", "meeting", False),
        ],
        "top_main": [
            ("恒温精密ラボ・クリーンルーム", "office", False),
            ("研究員オープンイノベーションホール", "public", False),
        ],
        "top_sub": [
            ("研究発表セミナールーム", "meeting", False),
            ("アーカイブ・サーバー室", "service", False),
        ],
        "wet_names": [
            "洗浄・廃液処理水回り室",
            "緊急シャワー・トイレ・給排水室",
            "純水装置・サニタリー室",
        ],
    },
]

ORIENTATION_PRESETS = [
    {"name": "北東コア集約", "x_sign": 1, "z_sign": -1},
    {"name": "北西コア集約", "x_sign": -1, "z_sign": -1},
    {"name": "南東コア集約", "x_sign": 1, "z_sign": 1},
    {"name": "南西コア集約", "x_sign": -1, "z_sign": 1},
]


def r1(val: float) -> float:
    """小数第2位までに丸めて浮動小数点誤差を防止する"""
    return round(float(val), 2)


def aabb_overlaps(
    x1: float, z1: float, w1: float, d1: float,
    x2: float, z2: float, w2: float, d2: float,
    eps: float = 1e-4
) -> bool:
    """中心座標 (x, z) と幅・奥行 (w, d) を持つ2つの矩形がAABB干渉するか判定"""
    overlap_x = (w1 + w2) / 2.0 - abs(x1 - x2)
    overlap_z = (d1 + d2) / 2.0 - abs(z1 - z2)
    return overlap_x > eps and overlap_z > eps


def is_within_site(x: float, z: float, w: float, d: float, site_w: float, site_d: float, eps: float = 1e-4) -> bool:
    """矩形が敷地境界 [-site_w/2, +site_w/2] x [-site_d/2, +site_d/2] に収まるか判定"""
    return (abs(x) + w / 2.0 <= site_w / 2.0 + eps) and (abs(z) + d / 2.0 <= site_d / 2.0 + eps)


def generate_column_grid(site_w: float, site_d: float, is_residential: bool = False) -> List[Dict[str, Any]]:
    """敷地サイズと建築モジュール（3.6m / 5.4mスパン等）に応じた1F〜最上階貫通の通し柱グリッドを生成"""
    margin = 0.45
    usable_w = site_w - margin * 2.0
    usable_d = site_d - margin * 2.0

    # 3.6m〜5.4mモジュールに収まるようスパン分割数を決定
    nx = 3 if site_w <= 12.5 else (4 if site_w <= 18.5 else 5)
    nz = 3 if site_d <= 12.5 else (4 if site_d <= 18.5 else 5)

    xs = [-site_w / 2.0 + margin + i * (usable_w / (nx - 1)) for i in range(nx)]
    zs = [-site_d / 2.0 + margin + j * (usable_d / (nz - 1)) for j in range(nz)]

    col_size = 0.40 if is_residential else 0.60

    columns: List[Dict[str, Any]] = []
    idx = 1
    for j, z in enumerate(zs):
        for i, x in enumerate(xs):
            columns.append({
                "id": f"C{idx}",
                "gridCode": f"X{i + 1}-Y{j + 1}",
                "x": r1(x),
                "z": r1(z),
                "width": col_size,
                "depth": col_size,
            })
            idx += 1
    return columns


def generate_beams_and_shear_walls(
    columns: List[Dict[str, Any]],
    cores: List[Dict[str, Any]],
    is_residential: bool = False,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, float]]:
    """
    柱グリッド座標から大梁 (girder)・小梁 (secondary) および耐力壁 (shearWalls) を自動生成する。
    あわせて基本構造スパン (spanX, spanZ) を算出して返す。
    """
    xs = sorted({float(c["x"]) for c in columns})
    zs = sorted({float(c["z"]) for c in columns})

    span_x = r1((xs[-1] - xs[0]) / max(1, len(xs) - 1)) if len(xs) >= 2 else 4.5
    span_z = r1((zs[-1] - zs[0]) / max(1, len(zs) - 1)) if len(zs) >= 2 else 4.5

    girder_w = 0.28 if is_residential else 0.40
    girder_d = 0.42 if is_residential else 0.60
    sec_w = 0.18 if is_residential else 0.25
    sec_d = 0.30 if is_residential else 0.42

    beams: List[Dict[str, Any]] = []
    b_idx = 1

    # X方向の大梁 (Girders along X)
    for z in zs:
        for i in range(len(xs) - 1):
            beams.append({
                "id": f"G{b_idx}",
                "kind": "girder",
                "x1": r1(xs[i]),
                "z1": r1(z),
                "x2": r1(xs[i + 1]),
                "z2": r1(z),
                "width": girder_w,
                "depth": girder_d,
            })
            b_idx += 1

    # Z方向の大梁 (Girders along Z)
    for x in xs:
        for j in range(len(zs) - 1):
            beams.append({
                "id": f"G{b_idx}",
                "kind": "girder",
                "x1": r1(x),
                "z1": r1(zs[j]),
                "x2": r1(x),
                "z2": r1(zs[j + 1]),
                "width": girder_w,
                "depth": girder_d,
            })
            b_idx += 1

    # 各グリッドスパン中央の小梁 (Secondary beams)
    s_idx = 1
    for j in range(len(zs) - 1):
        mid_z = r1((zs[j] + zs[j + 1]) / 2.0)
        for i in range(len(xs) - 1):
            beams.append({
                "id": f"B{s_idx}",
                "kind": "secondary",
                "x1": r1(xs[i]),
                "z1": mid_z,
                "x2": r1(xs[i + 1]),
                "z2": mid_z,
                "width": sec_w,
                "depth": sec_d,
            })
            s_idx += 1

    # 耐力壁 (Shear Walls): コア外周壁 + 北面/東西面の外周耐力壁
    wall_t = 0.18 if is_residential else 0.25
    shear_walls: List[Dict[str, Any]] = []
    w_idx = 1

    for core in cores:
        cx, cz, cw, cd = float(core["x"]), float(core["z"]), float(core["w"]), float(core["d"])
        # コアの北壁と東西壁を耐力壁として配置
        shear_walls.append({
            "id": f"SW{w_idx}",
            "x1": r1(cx - cw / 2.0),
            "z1": r1(cz - cd / 2.0),
            "x2": r1(cx + cw / 2.0),
            "z2": r1(cz - cd / 2.0),
            "thickness": wall_t,
        })
        w_idx += 1
        shear_walls.append({
            "id": f"SW{w_idx}",
            "x1": r1(cx + cw / 2.0),
            "z1": r1(cz - cd / 2.0),
            "x2": r1(cx + cw / 2.0),
            "z2": r1(cz + cd / 2.0),
            "thickness": wall_t,
        })
        w_idx += 1

    if len(xs) >= 2 and len(zs) >= 2:
        # 西面および東面の北寄りスパンに耐力壁を配置
        shear_walls.append({
            "id": f"SW{w_idx}",
            "x1": r1(xs[0]),
            "z1": r1(zs[0]),
            "x2": r1(xs[0]),
            "z2": r1(zs[1]),
            "thickness": wall_t,
        })
        w_idx += 1

    return beams, shear_walls, {"spanX": span_x, "spanZ": span_z}


def enrich_blueprint_details(bp: Dict[str, Any], is_residential: bool | None = None) -> Dict[str, Any]:
    """
    1. 構造グリッド（柱断面・大梁・小梁・耐力壁・スパン割）
    2. 開口部・建具（窓・ドア座標と採光・換気検証）
    3. 垂直方向（床スラブ厚・設備プレナム高・天井高）
    4. 部屋詳細プロパティ（仕上材 finishes・住宅設備/什器 fixtures）
    を一括で補完・精密化する。
    """
    site = bp.setdefault("site", {})
    site_w = float(site.get("width", 10.0))
    site_d = float(site.get("depth", 10.0))
    floor_h = float(site.get("floorHeight", 3.0))

    if is_residential is None:
        is_residential = floor_h <= 3.15 or any(
            "LDK" in r.get("name", "") or "寝室" in r.get("name", "") for r in bp.get("rooms", [])
        )

    # 3. 垂直方向（Z軸・高さ）の詳細パラメータ補完
    slab_t = r1(float(site.get("slabThickness", 0.22 if is_residential else 0.26)))
    plenum_h = r1(float(site.get("plenumHeight", 0.36 if is_residential else 0.58)))
    default_ch = r1(
        float(
            site.get(
                "defaultCeilingHeight",
                min(max(2.3, floor_h - slab_t - plenum_h), floor_h - 0.45),
            )
        )
    )
    site["slabThickness"] = slab_t
    site["plenumHeight"] = plenum_h
    site["defaultCeilingHeight"] = default_ch

    # 1. 構造グリッドとスパン割の精密化
    skeleton = bp.setdefault("skeleton", {})
    raw_cols = skeleton.get("columns", [])
    if not raw_cols:
        raw_cols = generate_column_grid(site_w, site_d, is_residential=is_residential)
        skeleton["columns"] = raw_cols
    else:
        col_sz = 0.40 if is_residential else 0.60
        xs_u = sorted({r1(float(c["x"])) for c in raw_cols})
        zs_u = sorted({r1(float(c["z"])) for c in raw_cols})
        for idx, c in enumerate(raw_cols, start=1):
            c.setdefault("id", f"C{idx}")
            c["x"] = r1(float(c["x"]))
            c["z"] = r1(float(c["z"]))
            c.setdefault("width", col_sz)
            c.setdefault("depth", col_sz)
            if "gridCode" not in c:
                xi = xs_u.index(c["x"]) + 1 if c["x"] in xs_u else idx
                zi = zs_u.index(c["z"]) + 1 if c["z"] in zs_u else 1
                c["gridCode"] = f"X{xi}-Y{zi}"

    cores = skeleton.get("cores", [])
    beams, shear_walls, mod_span = generate_beams_and_shear_walls(raw_cols, cores, is_residential=is_residential)
    if not skeleton.get("beams"):
        skeleton["beams"] = beams
    if not skeleton.get("shearWalls"):
        skeleton["shearWalls"] = shear_walls
    site.setdefault("structuralModule", mod_span)

    # 2 & 4. 各部屋の仕上材・設備什器・開口部（窓・ドア）の自動生成
    for r in bp.get("rooms", []):
        rtype = r.get("type", "office")
        rname = r.get("name", "")
        rx = float(r.get("x", 0.0))
        rz = float(r.get("z", 0.0))
        rw = float(r.get("w", 2.4))
        rd = float(r.get("d", 2.4))
        area = rw * rd

        # (a) 部屋別天井高 (水回りは床下排水勾配のため -0.1m)
        if "ceilingHeight" not in r:
            if rtype == "wet":
                r["ceilingHeight"] = r1(max(2.2, default_ch - 0.1))
            elif rtype == "public":
                r["ceilingHeight"] = r1(min(floor_h - slab_t - 0.25, default_ch + 0.05))
            else:
                r["ceilingHeight"] = default_ch

        # (b) 床・壁・天井の仕上材コード (finishes)
        if "finishes" not in r:
            if "和室" in rname or "タタミ" in rname:
                r["finishes"] = {"floor": "tatami_rush", "wall": "diatom_plaster", "ceiling": "cedar_veneer"}
            elif rtype == "wet":
                r["finishes"] = {"floor": "ceramic_tile", "wall": "moisture_board", "ceiling": "bath_panel"}
            elif rtype == "parking" or "土間" in rname or "ガレージ" in rname:
                r["finishes"] = {"floor": "mortar_exposed", "wall": "rc_exposed", "ceiling": "calcium_silicate"}
            elif "バルコニー" in rname or "テラス" in rname or "中庭" in rname:
                r["finishes"] = {"floor": "wood_deck_frp", "wall": "exterior_siding", "ceiling": "soffit_board"}
            elif rtype == "office":
                r["finishes"] = {"floor": "oa_carpet_tile", "wall": "vinyl_cloth", "ceiling": "acoustic_rockwool"}
            elif rtype == "public":
                r["finishes"] = {"floor": "oak_flooring", "wall": "plaster_paint", "ceiling": "oak_louver"}
            else:
                r["finishes"] = {"floor": "walnut_flooring", "wall": "acrylic_paint", "ceiling": "gypsum_cloth"}

        # (c) 部屋内の設備・什器ローカル座標 (fixtures)
        if "fixtures" not in r:
            fixtures: List[Dict[str, Any]] = []
            if rtype == "wet":
                fixtures.append({
                    "id": f"{r['id']}-FX1",
                    "type": "toilet",
                    "label": "タンクレストイレ",
                    "localX": r1(-rw * 0.26),
                    "localZ": r1(-rd * 0.24),
                    "w": 0.7,
                    "d": 0.8,
                })
                fixtures.append({
                    "id": f"{r['id']}-FX2",
                    "type": "sink",
                    "label": "洗面・給水シンク",
                    "localX": r1(rw * 0.24),
                    "localZ": r1(-rd * 0.24),
                    "w": 0.9,
                    "d": 0.65,
                })
                if "浴室" in rname or "バス" in rname:
                    fixtures.append({
                        "id": f"{r['id']}-FX3",
                        "type": "unit_bath",
                        "label": "1616ユニットバス",
                        "localX": r1(0.0),
                        "localZ": r1(rd * 0.22),
                        "w": r1(min(1.6, rw * 0.65)),
                        "d": r1(min(1.6, rd * 0.45)),
                    })
            elif "LDK" in rname or "キッチン" in rname or "カフェ" in rname:
                fixtures.append({
                    "id": f"{r['id']}-FX1",
                    "type": "island_kitchen",
                    "label": "アイランドキッチン・給排水シンク",
                    "localX": r1(-rw * 0.18),
                    "localZ": r1(-rd * 0.26),
                    "w": r1(min(2.4, rw * 0.52)),
                    "d": 0.95,
                })
                fixtures.append({
                    "id": f"{r['id']}-FX2",
                    "type": "meeting_table",
                    "label": "ダイニング・ラウンジテーブル",
                    "localX": r1(rw * 0.15),
                    "localZ": r1(rd * 0.18),
                    "w": r1(min(1.8, rw * 0.42)),
                    "d": 0.95,
                })
            elif "寝室" in rname or "子供部屋" in rname or "スイート" in rname:
                fixtures.append({
                    "id": f"{r['id']}-FX1",
                    "type": "bed",
                    "label": "ベッドフレーム",
                    "localX": r1(-rw * 0.12),
                    "localZ": r1(0.0),
                    "w": r1(min(1.6, rw * 0.55)),
                    "d": r1(min(2.0, rd * 0.55)),
                })
            elif rtype == "office":
                fixtures.append({
                    "id": f"{r['id']}-FX1",
                    "type": "lab_bench" if "ラボ" in rname or "実験" in rname else "counter_desk",
                    "label": "実験ドラフトベンチ" if "ラボ" in rname else "ワークデスクアイランド",
                    "localX": 0.0,
                    "localZ": 0.0,
                    "w": r1(min(2.8, rw * 0.58)),
                    "d": r1(min(1.4, rd * 0.45)),
                })
            elif rtype == "meeting":
                fixtures.append({
                    "id": f"{r['id']}-FX1",
                    "type": "tatami_mat" if "和室" in rname else "meeting_table",
                    "label": "琉球畳ユニット" if "和室" in rname else "ミーティングテーブル",
                    "localX": 0.0,
                    "localZ": 0.0,
                    "w": r1(min(2.4, rw * 0.6)),
                    "d": r1(min(1.6, rd * 0.55)),
                })
            r["fixtures"] = fixtures

        # (d) 開口部・建具 (openings: 窓 window & ドア door)
        if "openings" not in r:
            openings: List[Dict[str, Any]] = []
            # 室内側の壁にドアを配置 (南側の部屋なら北壁、北側の部屋なら南壁)
            door_wall = "north" if rz >= 0 else "south"
            door_z = r1(rz - rd / 2.0) if door_wall == "north" else r1(rz + rd / 2.0)
            door_w = r1(min(0.85, max(0.7, rw * 0.35)))
            openings.append({
                "id": f"{r['id']}-DR1",
                "type": "door",
                "wall": door_wall,
                "x": r1(rx - rw * 0.2),
                "z": door_z,
                "width": door_w,
                "height": 2.0,
                "sillHeight": 0.0,
            })

            # 外周に近い壁面に採光・換気窓 (window) を配置
            # 建築基準法：居室 (public, office, meeting) は床面積の 1/7 (約14.3%) 以上の有効採光面積を確保
            is_habitable = rtype in ("public", "office", "meeting")
            win_h = 1.8 if is_habitable else 0.7
            required_win_area = (area / 6.2) if is_habitable else 0.45
            target_win_w = required_win_area / win_h

            # 南壁または北壁にメイン窓
            ext_wall_z = "south" if rz >= 0 else "north"
            win1_z = r1(rz + rd / 2.0) if ext_wall_z == "south" else r1(rz - rd / 2.0)
            win1_w = r1(min(max(0.9, rw * 0.72), max(1.1, target_win_w)))
            openings.append({
                "id": f"{r['id']}-WN1",
                "type": "window",
                "wall": ext_wall_z,
                "x": r1(rx),
                "z": win1_z,
                "width": win1_w,
                "height": win_h,
                "sillHeight": 0.4 if is_habitable else 1.2,
            })

            # 大面積の居室で1面の窓だけでは採光面積1/7に満たない場合、東西面にもセカンド窓を配置
            current_win_area = win1_w * win_h
            if is_habitable and current_win_area < area / 7.0:
                rem_area = (area / 6.5) - current_win_area
                ext_wall_x = "west" if rx <= 0 else "east"
                win2_x = r1(rx - rw / 2.0) if ext_wall_x == "west" else r1(rx + rw / 2.0)
                win2_w = r1(min(max(0.9, rd * 0.72), max(0.9, rem_area / win_h)))
                openings.append({
                    "id": f"{r['id']}-WN2",
                    "type": "window",
                    "wall": ext_wall_x,
                    "x": win2_x,
                    "z": r1(rz),
                    "width": win2_w,
                    "height": win_h,
                    "sillHeight": 0.6,
                })

            r["openings"] = openings

    return bp


# ==========================================
# 一般住宅（戸建て・ガレージハウス・二世帯）専用ジェネレータ
# ==========================================
def generate_residential_blueprint(
    seed_idx: int,
    rng: random.Random,
    archetype_idx: int | None = None,
    override_w: float | None = None,
    override_d: float | None = None,
    override_floors: int | None = None,
    orient_idx: int | None = None,
    ldk_ratio: float = 0.60,
) -> Tuple[str, Dict[str, Any]]:
    """
    一般住宅らしい細かい部屋割り（1F: 玄関・浴室洗面トイレ・LDK・和室/ガレージ、
    2F: 主寝室・WIC/書斎・子供部屋A・子供部屋B・2Fトイレ・南面バルコニー）を
    3ゾーン（北サービス帯・中央居室帯・南居室/バルコニー帯）で衝突なく生成する。
    """
    arch = RESIDENTIAL_ARCHETYPES[
        (archetype_idx if archetype_idx is not None else seed_idx) % len(RESIDENTIAL_ARCHETYPES)
    ]
    # 住宅は南採光を確保するため、階段・水回りは常に北側（北東 or 北西）に集約する
    orient = ORIENTATION_PRESETS[(orient_idx if orient_idx is not None else seed_idx // 3) % 2]
    struct_label = rng.choice(arch["structure"])

    site_w = r1(override_w if override_w is not None else rng.choice([8.5, 9.0, 10.0, 10.5, 11.0, 12.0, 13.0]))
    site_d = r1(override_d if override_d is not None else rng.choice([8.5, 9.0, 9.5, 10.0, 11.0, 12.0]))
    floors = override_floors if override_floors is not None else rng.choice([2, 2, 2, 3])
    floor_height = r1(rng.choice([2.8, 2.9, 3.0, 3.1]))

    half_w = site_w / 2.0
    half_d = site_d / 2.0
    pad = 0.25
    gap = 0.04

    usable_w = site_w - 2.0 * pad
    usable_d = site_d - 2.0 * pad

    # Z方向を北側サービス帯 (Row N) と南側生活帯 (Row S) に分割
    row_n_d = r1(min(max(2.3, usable_d * 0.31), 3.2))
    row_s_d = r1(usable_d - row_n_d - gap)

    row_n_z = r1(-half_d + pad + row_n_d / 2.0)
    row_s_z = r1(half_d - pad - row_s_d / 2.0)

    # Row N（北側帯）を3分割: [室内階段コア] + [浴室/トイレ水回り] + [玄関ホール / WIC・書斎]
    core_w = r1(min(max(1.8, usable_w * 0.22), 2.4))
    wet_w = r1(min(max(2.2, usable_w * 0.32), 3.4))
    entry_w = r1(usable_w - core_w - wet_w - 2.0 * gap)

    if orient["x_sign"] > 0:
        # 北東に階段コア、中央北に水回り、北西に玄関/WIC
        core_x = r1(half_w - pad - core_w / 2.0)
        wet_x = r1(core_x - core_w / 2.0 - gap - wet_w / 2.0)
        entry_x = r1(-half_w + pad + entry_w / 2.0)
    else:
        # 北西に階段コア、中央北に水回り、北東に玄関/WIC
        core_x = r1(-half_w + pad + core_w / 2.0)
        wet_x = r1(core_x + core_w / 2.0 + gap + wet_w / 2.0)
        entry_x = r1(half_w - pad - entry_w / 2.0)

    cores = [
        {
            "id": "CORE-STAIR",
            "label": arch["core_label"],
            "x": core_x,
            "z": row_n_z,
            "w": core_w,
            "d": row_n_d,
        }
    ]

    # 給排水縦シャフト(PS-1)は北側水回り室の南寄り（1F/2F水回りとLDKキッチンの両方から3.5m以内）に配置
    ps_x = r1(wet_x)
    ps_z = r1(row_n_z + row_n_d * 0.25)
    ds_x = r1(wet_x + (0.45 if orient["x_sign"] < 0 else -0.45))
    ds_z = r1(row_n_z)

    shafts = [
        {
            "id": "PS-1",
            "type": "plumbing",
            "label": "住宅給排水縦管(PS)",
            "x": ps_x,
            "z": ps_z,
            "radius": 0.28,
        },
        {
            "id": "DS-1",
            "type": "hvac",
            "label": "全館空調・換気縦管(DS)",
            "x": ds_x,
            "z": ds_z,
            "radius": 0.28,
        },
    ]

    rooms: List[Dict[str, Any]] = []

    # ------------------------------------------
    # 1F の間取り（玄関ホール + 浴室洗面トイレ + LDK + 和室/ビルトインガレージ）
    # ------------------------------------------
    rooms.append({
        "id": "R101",
        "floor": 1,
        "name": arch["f1_wet"],
        "type": "wet",
        "x": wet_x,
        "z": row_n_z,
        "w": wet_w,
        "d": row_n_d,
        "needsPlumbing": True,
    })

    if entry_w >= 1.4:
        rooms.append({
            "id": "R102",
            "floor": 1,
            "name": arch["f1_entry"],
            "type": "service",
            "x": entry_x,
            "z": row_n_z,
            "w": entry_w,
            "d": row_n_d,
            "needsPlumbing": False,
        })

    # 1F 南側生活帯: LDK (約62%) + 和室またはガレージ (約38%)
    ldk_w = r1((usable_w - gap) * ldk_ratio)
    extra_w = r1(usable_w - gap - ldk_w)
    if orient["x_sign"] > 0:
        ldk_x = r1(-half_w + pad + ldk_w / 2.0)
        extra_x = r1(half_w - pad - extra_w / 2.0)
    else:
        ldk_x = r1(half_w - pad - ldk_w / 2.0)
        extra_x = r1(-half_w + pad + extra_w / 2.0)

    ldk_dist_ps = math.hypot(ldk_x - ps_x, row_s_z - ps_z)
    rooms.append({
        "id": "R103",
        "floor": 1,
        "name": arch["f1_ldk"],
        "type": "public",
        "x": ldk_x,
        "z": row_s_z,
        "w": ldk_w,
        "d": row_s_d,
        "needsPlumbing": bool(ldk_dist_ps <= 3.4),
    })

    ex_name, ex_type, _ = arch["f1_extra"]
    rooms.append({
        "id": "R104",
        "floor": 1,
        "name": ex_name,
        "type": ex_type,
        "x": extra_x,
        "z": row_s_z,
        "w": extra_w,
        "d": row_s_d,
        "needsPlumbing": False,
    })

    # ------------------------------------------
    # 2F の間取り（2Fトイレ洗面 + WIC/書斎 + 主寝室 + 子供部屋A/B + 南面バルコニー）
    # ------------------------------------------
    if floors >= 2:
        rooms.append({
            "id": "R201",
            "floor": 2,
            "name": arch["f2_wet"],
            "type": "wet",
            "x": wet_x,
            "z": row_n_z,
            "w": wet_w,
            "d": row_n_d,
            "needsPlumbing": True,
        })

        if entry_w >= 1.4:
            rooms.append({
                "id": "R202",
                "floor": 2,
                "name": arch["f2_wic"],
                "type": "service",
                "x": entry_x,
                "z": row_n_z,
                "w": entry_w,
                "d": row_n_d,
                "needsPlumbing": False,
            })

        # 2F 南側帯をさらに「居室ゾーン(北側)」と「南面バルコニー(南端)」に分割（奥行に余裕がある場合）
        has_balcony = row_s_d >= 3.8
        balcony_d = r1(1.35) if has_balcony else 0.0
        beds_d = r1(row_s_d - balcony_d - gap) if has_balcony else row_s_d
        beds_z = r1(row_n_z + row_n_d / 2.0 + gap + beds_d / 2.0)
        balcony_z = r1(half_d - pad - balcony_d / 2.0)

        # 居室ゾーンを2室または3室（主寝室 + 子供部屋A + 子供部屋B）に分割
        if usable_w >= 9.2:
            w_master = r1((usable_w - 2.0 * gap) * 0.40)
            w_kid_a = r1((usable_w - 2.0 * gap) * 0.30)
            w_kid_b = r1(usable_w - 2.0 * gap - w_master - w_kid_a)

            x_master = r1(-half_w + pad + w_master / 2.0)
            x_kid_a = r1(x_master + w_master / 2.0 + gap + w_kid_a / 2.0)
            x_kid_b = r1(half_w - pad - w_kid_b / 2.0)

            rooms.append({
                "id": "R203",
                "floor": 2,
                "name": arch["f2_master"],
                "type": "public" if "LDK" in arch["f2_master"] else "meeting",
                "x": x_master,
                "z": beds_z,
                "w": w_master,
                "d": beds_d,
                "needsPlumbing": False,
            })
            rooms.append({
                "id": "R204",
                "floor": 2,
                "name": arch["f2_kids_a"],
                "type": "meeting",
                "x": x_kid_a,
                "z": beds_z,
                "w": w_kid_a,
                "d": beds_d,
                "needsPlumbing": False,
            })
            rooms.append({
                "id": "R205",
                "floor": 2,
                "name": arch["f2_kids_b"],
                "type": "office" if "書斎" in arch["f2_kids_b"] else "meeting",
                "x": x_kid_b,
                "z": beds_z,
                "w": w_kid_b,
                "d": beds_d,
                "needsPlumbing": False,
            })
        else:
            w_master = r1((usable_w - gap) * 0.54)
            w_kid_a = r1(usable_w - gap - w_master)
            x_master = r1(-half_w + pad + w_master / 2.0)
            x_kid_a = r1(half_w - pad - w_kid_a / 2.0)

            rooms.append({
                "id": "R203",
                "floor": 2,
                "name": arch["f2_master"],
                "type": "meeting",
                "x": x_master,
                "z": beds_z,
                "w": w_master,
                "d": beds_d,
                "needsPlumbing": False,
            })
            rooms.append({
                "id": "R204",
                "floor": 2,
                "name": arch["f2_kids_a"],
                "type": "meeting",
                "x": x_kid_a,
                "z": beds_z,
                "w": w_kid_a,
                "d": beds_d,
                "needsPlumbing": False,
            })

        if has_balcony:
            rooms.append({
                "id": "R206",
                "floor": 2,
                "name": arch["f2_balcony"],
                "type": "service",
                "x": 0.0,
                "z": balcony_z,
                "w": usable_w,
                "d": balcony_d,
                "needsPlumbing": False,
            })

    # ------------------------------------------
    # 3F の間取り（3階建て住宅の場合: 3Fトイレ洗面 + セカンドリビング/子供部屋 + ルーフバルコニー）
    # ------------------------------------------
    for fl in range(3, floors + 1):
        rooms.append({
            "id": f"R{fl}01",
            "floor": fl,
            "name": f"{fl}F トイレ・洗面室",
            "type": "wet",
            "x": wet_x,
            "z": row_n_z,
            "w": wet_w,
            "d": row_n_d,
            "needsPlumbing": True,
        })
        if entry_w >= 1.4:
            rooms.append({
                "id": f"R{fl}02",
                "floor": fl,
                "name": f"{fl}F 納戸・ファミリークローゼット",
                "type": "service",
                "x": entry_x,
                "z": row_n_z,
                "w": entry_w,
                "d": row_n_d,
                "needsPlumbing": False,
            })

        w_3main = r1((usable_w - gap) * 0.56)
        w_3terrace = r1(usable_w - gap - w_3main)
        x_3main = r1(-half_w + pad + w_3main / 2.0)
        x_3terrace = r1(half_w - pad - w_3terrace / 2.0)

        rooms.append({
            "id": f"R{fl}03",
            "floor": fl,
            "name": arch["f3_main"],
            "type": "meeting",
            "x": x_3main,
            "z": row_s_z,
            "w": w_3main,
            "d": row_s_d,
            "needsPlumbing": False,
        })
        rooms.append({
            "id": f"R{fl}04",
            "floor": fl,
            "name": arch["f3_terrace"],
            "type": "service",
            "x": x_3terrace,
            "z": row_s_z,
            "w": w_3terrace,
            "d": row_s_d,
            "needsPlumbing": False,
        })

    columns = generate_column_grid(site_w, site_d, is_residential=True)
    blueprint: Dict[str, Any] = {
        "site": {
            "width": site_w,
            "depth": site_d,
            "floors": floors,
            "floorHeight": floor_height,
        },
        "skeleton": {
            "columns": columns,
            "cores": cores,
        },
        "mep": {
            "shafts": shafts,
        },
        "rooms": rooms,
    }
    enrich_blueprint_details(blueprint, is_residential=True)

    prompt_templates = [
        (
            f"敷地{site_w:.0f}m×{site_d:.0f}m、{floors}階建て（{struct_label}・階高{floor_height}m）の"
            f"一般住宅「{arch['title']}」を設計してください。"
            f"1階は{arch['f1_entry']}・{arch['f1_ldk']}・{arch['f1_extra'][0]}・{arch['f1_wet']}、"
            f"2階は{arch['f2_master']}・{arch['f2_kids_a']}・{arch['f2_kids_b']}・{arch['f2_balcony']}を配置し、"
            f"{orient['name']}で室内階段と給排水シャフト(PS)を上下階で揃えた住宅間取りにしてください。"
        ),
        (
            f"【住宅設計】{site_w:.0f}m×{site_d:.0f}mの敷地に{floors}階建てのマイホーム（{arch['title']}、{struct_label}）を建てたい。"
            f"オフィスビルではなく一般の家として、南向きの明るいLDKや主寝室、子供部屋、WIC、バルコニーを設け、"
            f"浴室・洗面・トイレの水回りを給排水縦管の3.5m以内に集約した3レイヤーBIMデータを生成して。"
        ),
        (
            f"家族で暮らす{floors}階建ての{arch['title']}（敷地幅{site_w:.0f}m×奥行{site_d:.0f}m、{struct_label}）。"
            f"1Fに{arch['f1_ldk']}と{arch['f1_extra'][0]}、2Fに{arch['f2_master']}や{arch['f2_kids_a']}・{arch['f2_balcony']}を設け、"
            f"室内階段ホールと水回りシャフトが干渉しない住宅プランを作成せよ。"
        ),
    ]
    prompt = prompt_templates[seed_idx % len(prompt_templates)]
    return prompt, blueprint


# ==========================================
# 非住宅（カフェ・オフィス・クリニック・ラボ）ジェネレータ
# ==========================================
def generate_commercial_blueprint(
    seed_idx: int,
    rng: random.Random,
    archetype_idx: int | None = None,
    orient_idx: int | None = None,
    override_w: float | None = None,
    override_d: float | None = None,
    override_floors: int | None = None,
    main_ratio: float | None = None,
) -> Tuple[str, Dict[str, Any]]:
    archetype = BUILDING_ARCHETYPES[
        (archetype_idx if archetype_idx is not None else seed_idx) % len(BUILDING_ARCHETYPES)
    ]
    orient = ORIENTATION_PRESETS[
        (orient_idx if orient_idx is not None else seed_idx // len(BUILDING_ARCHETYPES)) % len(ORIENTATION_PRESETS)
    ]
    struct_label = rng.choice(archetype["structure"])

    site_w = r1(override_w if override_w is not None else rng.choice([10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0, 18.0, 20.0, 22.0]))
    site_d = r1(override_d if override_d is not None else rng.choice([9.0, 10.0, 11.0, 12.0, 14.0, 16.0, 18.0]))
    floors = override_floors if override_floors is not None else rng.choice([2, 3, 3, 4, 5])
    floor_height = r1(rng.choice([3.4, 3.5, 3.6, 3.8, 4.0]))

    half_w = site_w / 2.0
    half_d = site_d / 2.0
    pad = 0.25
    gap = 0.04

    band_a_d = r1(min(max(2.4, site_d * 0.32), 4.2))
    band_b_d = r1(site_d - 2.0 * pad - band_a_d - gap)

    if orient["z_sign"] < 0:
        band_a_z = r1(-half_d + pad + band_a_d / 2.0)
        band_b_z = r1(half_d - pad - band_b_d / 2.0)
    else:
        band_a_z = r1(half_d - pad - band_a_d / 2.0)
        band_b_z = r1(-half_d + pad + band_b_d / 2.0)

    usable_w = site_w - 2.0 * pad
    core_w = r1(min(max(2.0, usable_w * 0.24), 3.4))
    wet_w = r1(min(max(2.0, usable_w * 0.28), 3.6))
    rem_band_a_w = r1(usable_w - core_w - wet_w - 2.0 * gap)

    if orient["x_sign"] > 0:
        core_x = r1(half_w - pad - core_w / 2.0)
        wet_x = r1(core_x - core_w / 2.0 - gap - wet_w / 2.0)
    else:
        core_x = r1(-half_w + pad + core_w / 2.0)
        wet_x = r1(core_x + core_w / 2.0 + gap + wet_w / 2.0)

    cores = [
        {
            "id": "CORE-EV",
            "label": "EV・階段コア",
            "x": core_x,
            "z": band_a_z,
            "w": core_w,
            "d": band_a_d,
        }
    ]

    ps_z_offset = (band_a_d * 0.28) * (1 if band_b_z > band_a_z else -1)
    ps_x = r1(wet_x)
    ps_z = r1(band_a_z + ps_z_offset)
    ds_x = r1(wet_x + (0.6 if orient["x_sign"] < 0 else -0.6))
    ds_z = r1(band_a_z)

    shafts = [
        {
            "id": "PS-1",
            "type": "plumbing",
            "label": "給排水縦シャフト(PS)",
            "x": ps_x,
            "z": ps_z,
            "radius": 0.35,
        },
        {
            "id": "DS-1",
            "type": "hvac",
            "label": "空調縦ダクト(DS)",
            "x": ds_x,
            "z": ds_z,
            "radius": 0.35,
        },
    ]

    rooms: List[Dict[str, Any]] = []
    for fl in range(1, floors + 1):
        wet_name = archetype["wet_names"][(fl - 1) % len(archetype["wet_names"])]
        rooms.append({
            "id": f"R{fl}01",
            "floor": fl,
            "name": f"{fl}F {wet_name}",
            "type": "wet",
            "x": wet_x,
            "z": band_a_z,
            "w": wet_w,
            "d": band_a_d,
            "needsPlumbing": True,
        })

        if rem_band_a_w >= 1.6:
            sub_a_room_w = r1(rem_band_a_w)
            if orient["x_sign"] > 0:
                sub_a_center_x = r1(-half_w + pad + sub_a_room_w / 2.0)
            else:
                sub_a_center_x = r1(half_w - pad - sub_a_room_w / 2.0)

            rooms.append({
                "id": f"R{fl}02",
                "floor": fl,
                "name": f"{fl}F 倉庫・機械ユーティリティ" if fl == 1 else f"{fl}F 集中ブース・書庫",
                "type": "service",
                "x": sub_a_center_x,
                "z": band_a_z,
                "w": sub_a_room_w,
                "d": band_a_d,
                "needsPlumbing": False,
            })

        split_ratio = main_ratio if main_ratio is not None else rng.uniform(0.54, 0.66)
        main_w = r1((usable_w - gap) * split_ratio)
        sub_b_w = r1(usable_w - gap - main_w)

        if sub_b_w < 1.6:
            main_w = r1(usable_w)
            sub_b_w = 0.0

        if orient["x_sign"] > 0:
            main_x = r1(-half_w + pad + main_w / 2.0)
            sub_b_x = r1(half_w - pad - sub_b_w / 2.0)
        else:
            main_x = r1(half_w - pad - main_w / 2.0)
            sub_b_x = r1(-half_w + pad + sub_b_w / 2.0)

        if fl == 1:
            m_name, m_type, m_plumb = rng.choice(archetype["f1_main"])
            s_name, s_type, s_plumb = rng.choice(archetype["f1_sub"])
        elif fl == floors and floors >= 3:
            m_name, m_type, m_plumb = rng.choice(archetype["top_main"])
            s_name, s_type, s_plumb = rng.choice(archetype["top_sub"])
        else:
            m_name, m_type, m_plumb = rng.choice(archetype["upper_main"])
            s_name, s_type, s_plumb = rng.choice(archetype["upper_sub"])

        dist_main_ps = math.hypot(main_x - ps_x, band_b_z - ps_z)
        main_needs_plumb = bool(m_plumb and dist_main_ps <= 3.4)

        rooms.append({
            "id": f"R{fl}03",
            "floor": fl,
            "name": m_name,
            "type": m_type,
            "x": main_x,
            "z": band_b_z,
            "w": main_w,
            "d": band_b_d,
            "needsPlumbing": main_needs_plumb,
        })

        if sub_b_w >= 1.6:
            dist_sub_ps = math.hypot(sub_b_x - ps_x, band_b_z - ps_z)
            sub_needs_plumb = bool(s_plumb and dist_sub_ps <= 3.4)
            rooms.append({
                "id": f"R{fl}04",
                "floor": fl,
                "name": s_name,
                "type": s_type,
                "x": sub_b_x,
                "z": band_b_z,
                "w": sub_b_w,
                "d": band_b_d,
                "needsPlumbing": sub_needs_plumb,
            })

    columns = generate_column_grid(site_w, site_d, is_residential=False)
    blueprint: Dict[str, Any] = {
        "site": {
            "width": site_w,
            "depth": site_d,
            "floors": floors,
            "floorHeight": floor_height,
        },
        "skeleton": {
            "columns": columns,
            "cores": cores,
        },
        "mep": {
            "shafts": shafts,
        },
        "rooms": rooms,
    }
    enrich_blueprint_details(blueprint, is_residential=False)

    f1_desc = "・".join(r["name"] for r in rooms if r["floor"] == 1 and r["type"] != "wet")
    upper_desc = "・".join(r["name"] for r in rooms if r["floor"] == 2 and r["type"] != "wet")
    prompt = (
        f"敷地{site_w:.0f}m×{site_d:.0f}m、{floors}階建て（階高{floor_height}m・{struct_label}）の"
        f"「{archetype['title']}」を設計してください。1階には{f1_desc}、2階以上には{upper_desc}を配置し、"
        f"{orient['name']}でEV階段コアと給排水縦シャフト(PS)・各階水回りを上下階で整合させてください。"
    )
    return prompt, blueprint


def generate_single_blueprint(seed_idx: int, rng: random.Random) -> Tuple[str, Dict[str, Any]]:
    """
    偶数インデックスは「一般住宅（4LDK戸建て・ガレージハウス・二世帯住宅）」、
    奇数インデックスは「商業・オフィス・クリニック・研究ラボ」を生成し、
    AIがプロンプトの文脈から住宅かオフィスかを自律判断できるようバランス良く学習データを構築する。
    """
    if seed_idx % 2 == 0:
        return generate_residential_blueprint(seed_idx // 2, rng)
    return generate_commercial_blueprint(seed_idx // 2, rng)


def validate_blueprint(blueprint: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    `schema/stratum_bim_schema.json` および `ANTIGRAVITY_HANDOFF.md` の4大物理制約を厳密検証する。
    """
    errors: List[str] = []

    site = blueprint.get("site", {})
    site_w = float(site.get("width", 0))
    site_d = float(site.get("depth", 0))
    floors = int(site.get("floors", 0))
    floor_h = float(site.get("floorHeight", 0))

    if not (6.0 <= site_w <= 30.0):
        errors.append(f"site.width ({site_w}) out of range [6, 30]")
    if not (6.0 <= site_d <= 30.0):
        errors.append(f"site.depth ({site_d}) out of range [6, 30]")
    if not (1 <= floors <= 5):
        errors.append(f"site.floors ({floors}) out of range [1, 5]")
    if not (2.8 <= floor_h <= 4.5):
        errors.append(f"site.floorHeight ({floor_h}) out of range [2.8, 4.5]")

    skeleton = blueprint.get("skeleton", {})
    columns = skeleton.get("columns", [])
    cores = skeleton.get("cores", [])
    if not columns:
        errors.append("skeleton.columns is empty")

    for c in cores:
        if not is_within_site(c["x"], c["z"], c["w"], c["d"], site_w, site_d):
            errors.append(f"Core {c['id']} exceeds site boundary")

    mep = blueprint.get("mep", {})
    shafts = mep.get("shafts", [])
    plumbing_shafts = [s for s in shafts if s.get("type") == "plumbing"]
    if not plumbing_shafts:
        errors.append("No plumbing shaft found in mep.shafts")

    rooms = blueprint.get("rooms", [])
    if not rooms:
        errors.append("rooms array is empty")

    for r in rooms:
        rid = r.get("id", "?")
        fl = r.get("floor", 0)
        rtype = r.get("type", "")
        rw, rd = float(r.get("w", 0)), float(r.get("d", 0))
        rx, rz = float(r.get("x", 0)), float(r.get("z", 0))

        if rtype not in ALLOWED_ROOM_TYPES:
            errors.append(f"Room {rid} has invalid type '{rtype}'")
        if not (1 <= fl <= floors):
            errors.append(f"Room {rid} floor {fl} out of range [1, {floors}]")
        if rw < 1.2 or rd < 1.2:
            errors.append(f"Room {rid} dimensions ({rw}x{rd}) below minimum 1.2m")

        if not is_within_site(rx, rz, rw, rd, site_w, site_d):
            errors.append(
                f"Room {rid} (x={rx}, z={rz}, w={rw}, d={rd}) exceeds site ({site_w}x{site_d})"
            )

        for core in cores:
            if aabb_overlaps(rx, rz, rw, rd, core["x"], core["z"], core["w"], core["d"]):
                errors.append(f"Room {rid} on {fl}F overlaps with core {core['id']}")

        if r.get("needsPlumbing"):
            min_dist = min(
                math.hypot(rx - ps["x"], rz - ps["z"]) for ps in plumbing_shafts
            ) if plumbing_shafts else 999.0
            if min_dist > 3.5 + 1e-4:
                errors.append(
                    f"Room {rid} (needsPlumbing=True) is {min_dist:.2f}m from nearest PS (> 3.5m)"
                )

        # 5. 垂直方向（天井高・床スラブ・設備プレナム）の整合性チェック
        slab_t = float(site.get("slabThickness", 0.22))
        plenum_h = float(site.get("plenumHeight", 0.35))
        ch = float(r.get("ceilingHeight", site.get("defaultCeilingHeight", floor_h - slab_t - plenum_h)))
        if slab_t + plenum_h + ch > floor_h + 0.15:
            errors.append(
                f"Room {rid} vertical stack (slab {slab_t}m + plenum {plenum_h}m + ceiling {ch}m) exceeds floorHeight {floor_h}m"
            )

        # 6. 開口部（窓・採光基準）の整合性チェック
        openings = r.get("openings", [])
        if openings and rtype in ("public", "office", "meeting"):
            win_area = sum(
                float(op.get("width", 0)) * float(op.get("height", 0))
                for op in openings
                if op.get("type") == "window"
            )
            min_req_area = (rw * rd) / 7.0
            if win_area + 0.05 < min_req_area:
                errors.append(
                    f"Room {rid} window area ({win_area:.2f}m2) below 1/7 daylighting requirement ({min_req_area:.2f}m2)"
                )

    for fl in range(1, floors + 1):
        fl_rooms = [r for r in rooms if r.get("floor") == fl]
        for i in range(len(fl_rooms)):
            for j in range(i + 1, len(fl_rooms)):
                a, b = fl_rooms[i], fl_rooms[j]
                if aabb_overlaps(a["x"], a["z"], a["w"], a["d"], b["x"], b["z"], b["w"], b["d"]):
                    errors.append(f"AABB collision on {fl}F between {a['id']} and {b['id']}")

    return len(errors) == 0, errors


def generate_dataset(num_samples: int = 500, seed: int = 42, output_path: Path = DEFAULT_OUTPUT_PATH) -> None:
    rng = random.Random(seed)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    records: List[Dict[str, Any]] = []
    idx = 0

    while len(records) < num_samples:
        prompt, blueprint = generate_single_blueprint(idx, rng)
        idx += 1

        is_valid, errs = validate_blueprint(blueprint)
        if not is_valid:
            raise RuntimeError(f"Generated sample failed validation: {errs}")

        chatml_entry = {
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
                {"role": "assistant", "content": json.dumps(blueprint, ensure_ascii=False, separators=(",", ":"))},
            ]
        }
        records.append(chatml_entry)

    with output_path.open("w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print(f"[OK] Generated {len(records)} verified ChatML samples (250 Residential Houses + 250 Commercial/Office)")
    print(f"[FILE] Output path: {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic 3-layer BIM dataset in ChatML JSONL format.")
    parser.add_argument("--count", type=int, default=500, help="Number of samples to generate (default: 500)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed (default: 42)")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH, help="Output JSONL file path")
    args = parser.parse_args()

    generate_dataset(num_samples=args.count, seed=args.seed, output_path=args.output)


if __name__ == "__main__":
    main()
