#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""subsurface_ml_engine.py の幾何計算・ML推論エンジンに対するユニットテスト。

実行方法（リポジトリルートから）:
    python -m unittest discover -s backend/tests -t . -v

標準ライブラリのみで動作するため、CIでも依存インストールなしで実行できる。
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.subsurface_ml_engine import (  # noqa: E402
    MLInferencePrediction,
    Point2D,
    SiteGeometryFeatures,
    SubsurfaceFeatureExtractor,
    ml_predictor,
)


def make_features(**overrides) -> SiteGeometryFeatures:
    """標準的な 10m x 10m の更地（1975年・南接道・木造密集）特徴量を作る"""
    defaults = dict(
        polygon=[Point2D(-5, -5), Point2D(5, -5), Point2D(5, 5), Point2D(-5, 5)],
        area_sqm=100.0,
        perimeter_m=40.0,
        road_frontage_m=10.0,
        road_width_m=4.0,
        road_direction="south",
        neighbor_count_45m=8,
        tall_building_count=1,
        waterway_distance_m=30.0,
        has_existing_building=False,
        building_footprint_sqm=0.0,
        building_levels=0,
        estimated_era_year=1975,
        site_status="vacant_lot",
    )
    defaults.update(overrides)
    return SiteGeometryFeatures(**defaults)


class TestPolygonGeometry(unittest.TestCase):
    """SubsurfaceFeatureExtractor の幾何計算"""

    def test_square_area_and_perimeter(self) -> None:
        poly = [Point2D(-5, -5), Point2D(5, -5), Point2D(5, 5), Point2D(-5, 5)]
        area, perimeter = SubsurfaceFeatureExtractor.polygon_area_and_perimeter(poly)
        self.assertAlmostEqual(area, 100.0, places=6)
        self.assertAlmostEqual(perimeter, 40.0, places=6)

    def test_triangle_3_4_5(self) -> None:
        poly = [Point2D(0, 0), Point2D(3, 0), Point2D(0, 4)]
        area, perimeter = SubsurfaceFeatureExtractor.polygon_area_and_perimeter(poly)
        self.assertAlmostEqual(area, 6.0, places=6)
        self.assertAlmostEqual(perimeter, 12.0, places=6)

    def test_degenerate_polygon_returns_zero(self) -> None:
        area, perimeter = SubsurfaceFeatureExtractor.polygon_area_and_perimeter([Point2D(0, 0)])
        self.assertEqual((area, perimeter), (0.0, 0.0))

    def test_road_frontage_has_legal_minimum(self) -> None:
        # 接道長は建築基準法上の最小幅員 3.5m を下回らない
        poly = [Point2D(0, 0), Point2D(1, 0)]
        self.assertGreaterEqual(SubsurfaceFeatureExtractor.calculate_road_frontage(poly, "south"), 3.5)
        frontage = SubsurfaceFeatureExtractor.calculate_road_frontage(
            make_features().polygon, "south"
        )
        self.assertGreaterEqual(frontage, 3.5)
        self.assertIsInstance(frontage, float)


class TestMLPredictorPhysicalConstraints(unittest.TestCase):
    """ml_predictor.predict の法規・物理拘束バイアスの検証"""

    def test_vacant_lot_prediction_ranges(self) -> None:
        pred = ml_predictor.predict(make_features())
        self.assertIsInstance(pred, MLInferencePrediction)
        self.assertIn("更地", pred.site_status_label)
        # ガス管: 敷地内私設管 GL-0.6m 以上
        self.assertGreaterEqual(pred.gas_pipe_depth_gl, ml_predictor.min_gas_depth)
        # 上水道管: 凍結深度基準 GL-0.45m 以上
        self.assertGreaterEqual(pred.water_pipe_depth_gl, ml_predictor.min_water_depth)
        # 隣地越境リスクは確率として妥当な範囲
        self.assertGreaterEqual(pred.cross_border_risk_probability, 0.0)
        self.assertLessEqual(pred.cross_border_risk_probability, 0.95)
        # 推論結果の付帯データが常に付く
        self.assertGreater(len(pred.predicted_pipes), 0)
        self.assertTrue(pred.model_version)
        for name, p in pred.obstacle_probabilities.items():
            self.assertGreaterEqual(p, 0.0, msg=name)
            self.assertLessEqual(p, 1.0, msg=name)

    def test_existing_building_label(self) -> None:
        pred = ml_predictor.predict(
            make_features(
                site_status="existing_building",
                has_existing_building=True,
                building_footprint_sqm=60.0,
                building_levels=2,
                estimated_era_year=2001,
            )
        )
        self.assertIn("現存建物あり", pred.site_status_label)

    def test_parking_lot_label(self) -> None:
        pred = ml_predictor.predict(make_features(site_status="parking_lot", estimated_era_year=2020))
        self.assertIn("駐車場", pred.site_status_label)

    def test_prediction_is_deterministic(self) -> None:
        """同一特徴量に対する推論は決定論的（学習済み重み行列＋物理拘束）"""
        a = ml_predictor.predict(make_features())
        b = ml_predictor.predict(make_features())
        self.assertEqual(a, b)

    def test_gas_depth_differs_by_era(self) -> None:
        """旧年代の敷地は旧基準で浅い埋設 (GL-0.68m)、現行は深い (GL-0.75m)"""
        old = ml_predictor.predict(make_features(estimated_era_year=1965))
        new = ml_predictor.predict(make_features(estimated_era_year=2015))
        self.assertLess(old.gas_pipe_depth_gl, new.gas_pipe_depth_gl)
        self.assertGreaterEqual(old.gas_pipe_depth_gl, ml_predictor.min_gas_depth)


if __name__ == "__main__":
    unittest.main()
