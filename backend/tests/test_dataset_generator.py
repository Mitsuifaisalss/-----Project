#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dataset_generator.py の物理制約エンジンに対するユニットテスト。

実行方法（リポジトリルートから）:
    python -m unittest discover -s backend/tests -t . -v

3層BIM学習データ生成器の純関数（AABB干渉判定・敷地境界判定・通し柱グリッド生成）と、
生成されたブループリントが4大物理制約を満たすことを保証する round-trip 性質テストを含む。
"""

from __future__ import annotations

import json
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.dataset_generator import (  # noqa: E402
    BUILDING_ARCHETYPES,
    SYSTEM_PROMPT,
    aabb_overlaps,
    generate_column_grid,
    generate_commercial_blueprint,
    generate_residential_blueprint,
    generate_single_blueprint,
    is_within_site,
    r1,
    validate_blueprint,
)


class TestR1(unittest.TestCase):
    """小数第2位丸めヘルパー"""

    def test_rounds_to_2_decimal_places(self) -> None:
        self.assertEqual(r1(3.14159), 3.14)
        self.assertEqual(r1(1.23456), 1.23)
        self.assertEqual(r1(3.999), 4.0)

    def test_accepts_int_and_returns_float(self) -> None:
        self.assertEqual(r1(2), 2.0)
        self.assertIsInstance(r1(2), float)


class TestAABBOverlaps(unittest.TestCase):
    """同一階の部屋同士 AABB 干渉判定"""

    def test_identical_rects_overlap(self) -> None:
        self.assertTrue(aabb_overlaps(0, 0, 4, 4, 0, 0, 4, 4))

    def test_distant_rects_do_not_overlap(self) -> None:
        self.assertFalse(aabb_overlaps(-10, 0, 4, 4, 10, 0, 4, 4))

    def test_x_overlap_only_is_not_collision(self) -> None:
        # x方向は重なるが z方向が離れている場合は非干渉
        self.assertFalse(aabb_overlaps(0, -5, 4, 4, 0, 5, 4, 4))

    def test_edge_touching_is_not_collision(self) -> None:
        # 辺ぴったり接触（隙間ゼロ）は干渉とみなさない仕様
        x1 = 0.0
        x2 = (4.0 + 4.0) / 2.0  # x1 + (w1 + w2) / 2
        self.assertFalse(aabb_overlaps(x1, 0, 4, 4, x2, 0, 4, 4))


class TestIsWithinSite(unittest.TestCase):
    """敷地境界 [-w/2, +w/2] x [-d/2, +d/2] 内包判定"""

    def test_inside(self) -> None:
        self.assertTrue(is_within_site(0, 0, 4, 4, 10, 10))

    def test_outside_x(self) -> None:
        self.assertFalse(is_within_site(4, 0, 4, 4, 10, 10))

    def test_outside_z(self) -> None:
        self.assertFalse(is_within_site(0, 4, 4, 4, 10, 10))

    def test_boundary_edge_is_within_eps(self) -> None:
        # |x| + w/2 == site_w/2 の境界接触は eps 許容で収まる
        self.assertTrue(is_within_site(3, 0, 4, 4, 10, 10))


class TestGenerateColumnGrid(unittest.TestCase):
    """通し柱グリッド生成（1F〜最上階貫通）"""

    def test_small_site_3x3_grid(self) -> None:
        cols = generate_column_grid(10.0, 9.0, is_residential=True)
        self.assertEqual(len(cols), 9)  # nx=3, nz=3
        for c in cols:
            self.assertTrue(
                is_within_site(c["x"], c["z"], c["width"], c["depth"], 10.0, 9.0),
                msg=f"column {c['id']} out of site: x={c['x']} z={c['z']}",
            )
            self.assertEqual(c["width"], 0.40)
            self.assertEqual(c["depth"], 0.40)
        ids = [c["id"] for c in cols]
        self.assertEqual(len(set(ids)), len(ids), "column ids must be unique")

    def test_large_site_5x4_grid_non_residential(self) -> None:
        cols = generate_column_grid(20.0, 16.0, is_residential=False)
        self.assertEqual(len(cols), 20)  # nx=5, nz=4
        for c in cols:
            self.assertEqual(c["width"], 0.60)
            self.assertTrue(is_within_site(c["x"], c["z"], c["width"], c["depth"], 20.0, 16.0))

    def test_ids_are_sequential(self) -> None:
        cols = generate_column_grid(12.0, 10.0)
        self.assertEqual([c["id"] for c in cols], [f"C{i}" for i in range(1, len(cols) + 1)])


class TestBlueprintRoundTrip(unittest.TestCase):
    """生成器 → バリデータの round-trip 性質テスト（回帰安全網）"""

    def test_generated_residential_blueprints_validate(self) -> None:
        for seed in range(8):
            with self.subTest(seed=seed):
                _, bp = generate_residential_blueprint(seed, random.Random(100 + seed))
                ok, errors = validate_blueprint(bp)
                self.assertTrue(ok, msg=f"residential seed={seed}: {errors}")

    def test_generated_commercial_blueprints_validate(self) -> None:
        for seed in range(8):
            with self.subTest(seed=seed):
                _, bp = generate_commercial_blueprint(seed, random.Random(200 + seed))
                ok, errors = validate_blueprint(bp)
                self.assertTrue(ok, msg=f"commercial seed={seed}: {errors}")

    def test_generated_single_blueprints_validate(self) -> None:
        for seed in range(16):
            with self.subTest(seed=seed):
                _, bp = generate_single_blueprint(seed, random.Random(300 + seed))
                ok, errors = validate_blueprint(bp)
                self.assertTrue(ok, msg=f"single seed={seed}: {errors}")

    def test_generation_is_deterministic_for_same_seed(self) -> None:
        _, a = generate_residential_blueprint(3, random.Random(42))
        _, b = generate_residential_blueprint(3, random.Random(42))
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))
        _, c = generate_commercial_blueprint(3, random.Random(42))
        _, d = generate_commercial_blueprint(3, random.Random(42))
        self.assertEqual(json.dumps(c, sort_keys=True), json.dumps(d, sort_keys=True))


class TestValidateBlueprintNegatives(unittest.TestCase):
    """バリデータの不合格検出（不正データを確実に弾くこと）"""

    @staticmethod
    def _valid_blueprint() -> dict:
        _, bp = generate_residential_blueprint(0, random.Random(1))
        return json.loads(json.dumps(bp))  # deep copy

    def test_site_width_out_of_range_detected(self) -> None:
        bp = self._valid_blueprint()
        bp["site"]["width"] = 50.0
        ok, errors = validate_blueprint(bp)
        self.assertFalse(ok)
        self.assertTrue(any("site.width" in e for e in errors), msg=str(errors))

    def test_empty_columns_detected(self) -> None:
        bp = self._valid_blueprint()
        bp["skeleton"]["columns"] = []
        ok, errors = validate_blueprint(bp)
        self.assertFalse(ok)
        self.assertTrue(any("columns" in e for e in errors), msg=str(errors))

    def test_floors_out_of_range_detected(self) -> None:
        bp = self._valid_blueprint()
        bp["site"]["floors"] = 9
        ok, errors = validate_blueprint(bp)
        self.assertFalse(ok)
        self.assertTrue(any("floors" in e for e in errors), msg=str(errors))


class TestDatasetConstants(unittest.TestCase):
    """学習データ生成に必要な定数の健全性"""

    def test_system_prompt_is_nonempty_text(self) -> None:
        self.assertIsInstance(SYSTEM_PROMPT, str)
        self.assertGreater(len(SYSTEM_PROMPT), 100)

    def test_building_archetypes_have_structure_labels(self) -> None:
        self.assertGreater(len(BUILDING_ARCHETYPES), 0)
        for arch in BUILDING_ARCHETYPES:
            self.assertIn("structure", arch)


if __name__ == "__main__":
    unittest.main()
