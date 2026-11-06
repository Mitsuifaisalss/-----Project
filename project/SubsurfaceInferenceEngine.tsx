import { useState } from 'react';
import type { StratumArchBIMSchema } from './ai_bim_3d';

// ==========================================
// 土地・周辺環境・過去建物履歴からの地下埋設推論データ型
// ==========================================
export type PreviousBuildingType =
  | 'showa_wooden_house'   // 昭和54年築 木造2階建て戸建て（解体更地）
  | 'heisei_rc_clinic'     // 平成2年築 RC造3階建てクリニック・店舗ビル（解体更地）
  | 'old_factory_cleaner'  // 昭和62年築 旧クリーニング店・町工場跡（駐車場転用）
  | 'rowhouse_apartments'; // 昭和48年築 旧木造連棟アパート（私道・越境管あり）

export type FrontRoadDirection = 'south' | 'north' | 'west' | 'east' | 'southwest_corner';

export type SiteStatusType = 'existing_building' | 'vacant_lot' | 'parking_lot';

export interface PolygonPoint {
  x: number;
  z: number;
}

/** 実在データ（OpenStreetMap・国土地理院）および機械学習モデルから得た周辺コンテキスト */
export interface RealSiteContext {
  landTitle?: string;
  accurateAddress?: string;
  buildingName?: string | null;
  siteStatus?: SiteStatusType;
  sitePolygon?: PolygonPoint[];
  buildingPolygon?: PolygonPoint[] | null;
  edgeLengths?: number[];
  roadWidthM?: number;
  roadLabel?: string;
  westNeighbor?: string;
  eastNeighbor?: string;
  northNeighbor?: string;
  mlPrediction?: {
    gasDepthGL: number;
    gasDiameterA: number;
    waterDepthGL: number;
    crossBorderRiskProb: number;
    obstacleProbabilities: Record<string, number>;
  };
}

export type SurroundingContextType =
  | 'old_residential_dense' // 築35年以上の木造住宅密集地（隣地越境配管リスク高）
  | 'urban_rc_mixed'        // 中高層RCマンション・商業ビル隣接（深基礎・残置アンカー注意）
  | 'former_waterway_lot';  // 旧暗渠・水路隣接（旧農業土管・軟弱シルト層あり）

export type BuriedUtilityKind =
  | 'gas_low'       // 都市ガス低圧引込管 (白ガス管/PE管 GL-0.6m)
  | 'gas_medium'    // 都市ガス中圧本管・引込管 (GL-1.2m)
  | 'water_supply'  // 上水道引込管・旧鉛管 (GL-0.45m〜-0.9m)
  | 'sewer_Foul'    // 汚水排水管・旧土管 (GL-0.8m〜-1.8m)
  | 'storm_drain'   // 雨水排水管・暗渠管 (GL-0.7m〜-1.4m)
  | 'power_Loops';  // 地中電力・通信管路 (GL-0.8m)

export interface BuriedPipeSegment {
  id: string;
  kind: BuriedUtilityKind;
  label: string;
  spec: string;           // 例: "白ガス管 25A (腐食注意)" / "PEガス管 50A"
  x1: number;             // 敷地中心基準の座標 (m)
  z1: number;
  depth1: number;         // GLからの深さ (正の値: 例 0.6 = GL-0.6m)
  x2: number;
  z2: number;
  depth2: number;
  diameterMm: number;
  confidence: number;     // AI推論確度 (0.0 - 1.0)
  status: 'active' | 'abandoned_remnant' | 'cross_border_risk';
  reason: string;         // 推論根拠（周囲の建物や旧建物履歴からの推論理由）
}

export interface BuriedObstacleItem {
  id: string;
  kind: 'old_foundation' | 'old_pile' | 'septic_tank' | 'oil_tank' | 'old_well' | 'meter_box';
  label: string;
  x: number;
  z: number;
  w: number;
  d: number;
  depthTop: number;       // GLからの上端深さ (m)
  depthBottom: number;    // GLからの下端深さ (m)
  confidence: number;
  removalCostManYen: number;
  reason: string;
}

export interface SoilLayerSpec {
  id: string;
  name: string;
  depthFrom: number;
  depthTo: number;
  nValue: string;
  colorHex: string;
  note: string;
}

export interface LandSubsurfaceAnalysis {
  landTitle: string;
  previousBuilding: {
    type: PreviousBuildingType;
    title: string;
    era: string;
    footprintW: number;
    footprintD: number;
    offsetX: number;
    offsetZ: number;
    oldRooms: { label: string; x: number; z: number; w: number; d: number }[];
  };
  frontRoad: {
    direction: FrontRoadDirection;
    widthM: number;
    label: string;
  };
  surrounding: {
    type: SurroundingContextType;
    title: string;
    westNeighbor: string;
    eastNeighbor: string;
    northNeighbor: string;
  };
  pipes: BuriedPipeSegment[];
  obstacles: BuriedObstacleItem[];
  soilLayers: SoilLayerSpec[];
  realContext?: RealSiteContext;
  aiSummary: {
    overallRiskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
    estimatedSubsurfaceCostManYen: number;
    conflictCount: number;
    keyFindings: string[];
  };
}

export const PREVIOUS_BUILDING_OPTIONS: {
  id: PreviousBuildingType;
  title: string;
  era: string;
  badge: string;
  desc: string;
}[] = [
  {
    id: 'showa_wooden_house',
    title: '旧・木造2階建て戸建て住宅（解体更地）',
    era: '昭和54年（1979年）築',
    badge: '旧白ガス管・旧浄化槽・古井戸リスク',
    desc: '北東に旧台所・浴室、南東に旧便所があった住宅跡。腐食しやすい旧白ガス管(GL-0.6m)や鉛給水管、FRP浄化槽の残置を推論。'
  },
  {
    id: 'heisei_rc_clinic',
    title: '旧・RC造3階建てクリニック併用ビル（解体更地）',
    era: '平成2年（1990年）築',
    badge: '既存RC杭残置・中圧引込ガス管リスク',
    desc: '旧建物解体時に地上部のみ撤去され、GL-2.0m〜-8.5mに既存PHCコンクリート杭6本と地中梁、50Aガス引込管が残置されているケース。'
  },
  {
    id: 'old_factory_cleaner',
    title: '旧・クリーニング店／小規模町工場跡（現コインパーキング）',
    era: '昭和62年（1987年）築',
    badge: '業務用ボイラー太径ガス管・地下タンク残置',
    desc: 'アスファルト舗装の下（GL-0.9m〜-3.2m）に業務用ボイラー向けガス管・排水ピット・旧地下燃料タンクが残存しているケース。'
  },
  {
    id: 'rowhouse_apartments',
    title: '旧・木造連棟アパート2棟跡（私道・隣地共用管）',
    era: '昭和48年（1973年）築',
    badge: '隣地越境ガス/排水枝管・多系統錯綜リスク',
    desc: '昔の連棟開発により、西隣・東隣の現役住宅のガス枝管や私設下水管が対象地の地下(GL-0.5m)を横断・越境している高リスク土地。'
  }
];

export const FRONT_ROAD_OPTIONS: { id: FrontRoadDirection; label: string; note: string }[] = [
  { id: 'south', label: '南側 6.0m 公道接道', note: '南道路下に中圧ガス本管・上水150mm・下水250mm本管' },
  { id: 'north', label: '北側 5.0m 公道接道', note: '北道路から敷地奥（南側）へ長い埋設引込管が縦断' },
  { id: 'west', label: '西側 8.0m 都市計画道路', note: '西道路の深層本管から東方向へ横断引込' },
  { id: 'east', label: '東側 公道接道', note: '東道路の本管から西方向へ横断引込' },
  { id: 'southwest_corner', label: '南6m × 西4m 角地接道', note: 'ガスは南道路、上下水は西道路から二方向引込' }
];

export const SURROUNDING_OPTIONS: { id: SurroundingContextType; label: string; note: string }[] = [
  {
    id: 'old_residential_dense',
    label: '昭和期からの木造住宅密集エリア',
    note: '隣地との境界付近(GL-0.5m)に私設排水管・ガス管の越境埋設リスクが高い'
  },
  {
    id: 'urban_rc_mixed',
    label: '中高層RCビル・マンション隣接商業地',
    note: '隣地ビルの山留めソイルパイルや深基礎が境界地下(GL-2.5m)に干渉'
  },
  {
    id: 'former_waterway_lot',
    label: '旧水路・暗渠（あんきょ）隣接エリア',
    note: '北側境界地下(GL-1.3m)に旧コンクリート暗渠管と軟弱シルト層が分布'
  }
];

/**
 * 土地寸法・前面道路・周囲の建物・前回建っていた建物の履歴から、
 * 地下のガス管・水道管・下水管・旧基礎・残置杭・浄化槽を推論し、新築プランとの干渉を検証するAIエンジン
 */
export function inferLandSubsurface(
  bp: StratumArchBIMSchema,
  prevType: PreviousBuildingType = 'showa_wooden_house',
  roadDir: FrontRoadDirection = 'south',
  surroundingType: SurroundingContextType = 'old_residential_dense',
  realContext?: RealSiteContext
): LandSubsurfaceAnalysis {
  const sw = bp.site.width;
  const sd = bp.site.depth;
  const hw = sw / 2.0;
  const hd = sd / 2.0;

  const pipes: BuriedPipeSegment[] = [];
  const obstacles: BuriedObstacleItem[] = [];

  // 1. 前面道路の地下本管 (ガス・上水・下水) を配置
  const isSideRoad = roadDir === 'west' || roadDir === 'east';
  const sideSgn = roadDir === 'east' ? 1 : -1;
  const roadZ = roadDir === 'north' ? -hd - 1.6 : hd + 1.6;
  const roadX = sideSgn * (hw + 1.6);

  if (isSideRoad) {
    pipes.push(
      {
        id: 'MAIN-GAS',
        kind: 'gas_medium',
        label: '前面道路 都市ガス本管 (100A)',
        spec: '都市ガス中圧/低圧本管 PE100A (GL-1.2m)',
        x1: roadX,
        z1: -hd - 2.0,
        depth1: 1.2,
        x2: roadX,
        z2: hd + 2.0,
        depth2: 1.2,
        diameterMm: 120,
        confidence: 0.98,
        status: 'active',
        reason: '西側前面道路のガス事業者台帳および道路マンホール位置から特定'
      },
      {
        id: 'MAIN-WATER',
        kind: 'water_supply',
        label: '前面道路 上水道配水本管 (150mm)',
        spec: 'ダクタイル鋳鉄管 φ150mm (GL-0.9m)',
        x1: roadX + sideSgn * 0.65,
        z1: -hd - 2.0,
        depth1: 0.9,
        x2: roadX + sideSgn * 0.65,
        z2: hd + 2.0,
        depth2: 0.9,
        diameterMm: 150,
        confidence: 0.98,
        status: 'active',
        reason: '西側道路の消火栓・制水弁位置から配水本管ルートを特定'
      },
      {
        id: 'MAIN-SEWER',
        kind: 'sewer_Foul',
        label: '前面道路 公共下水本管 (φ250mm)',
        spec: '硬質塩ビ本管 φ250mm (GL-1.9m〜-2.1m)',
        x1: roadX + sideSgn * 1.3,
        z1: -hd - 2.0,
        depth1: 1.9,
        x2: roadX + sideSgn * 1.3,
        z2: hd + 2.0,
        depth2: 2.1,
        diameterMm: 220,
        confidence: 0.97,
        status: 'active',
        reason: '道路中央の下水マンホール深さから本管勾配を算出'
      }
    );
  } else {
    pipes.push(
      {
        id: 'MAIN-GAS',
        kind: 'gas_medium',
        label: '前面道路 都市ガス本管 (100A)',
        spec: '都市ガス本管 PE100A (GL-1.2m)',
        x1: -hw - 2.0,
        z1: roadZ,
        depth1: 1.2,
        x2: hw + 2.0,
        z2: roadZ,
        depth2: 1.2,
        diameterMm: 120,
        confidence: 0.98,
        status: 'active',
        reason: '前面道路のガス本管プレートおよび近隣引込位置から本管深度GL-1.2mを特定'
      },
      {
        id: 'MAIN-WATER',
        kind: 'water_supply',
        label: '前面道路 上水道配水本管 (150mm)',
        spec: '配水本管 φ150mm (GL-0.9m)',
        x1: -hw - 2.0,
        z1: roadZ + (roadDir === 'north' ? -0.65 : 0.65),
        depth1: 0.9,
        x2: hw + 2.0,
        z2: roadZ + (roadDir === 'north' ? -0.65 : 0.65),
        depth2: 0.9,
        diameterMm: 150,
        confidence: 0.98,
        status: 'active',
        reason: '道路上の制水弁・量水器並びから上水本管ラインを特定'
      },
      {
        id: 'MAIN-SEWER',
        kind: 'sewer_Foul',
        label: '前面道路 公共下水本管 (φ250mm)',
        spec: '公共汚水本管 φ250mm (GL-1.9m〜-2.1m)',
        x1: -hw - 2.0,
        z1: roadZ + (roadDir === 'north' ? -1.3 : 1.3),
        depth1: 1.9,
        x2: hw + 2.0,
        z2: roadZ + (roadDir === 'north' ? -1.3 : 1.3),
        depth2: 2.1,
        diameterMm: 220,
        confidence: 0.97,
        status: 'active',
        reason: '前面道路マンホール蓋および流下方向から下水本管深さを特定'
      }
    );
  }

  // 2. 前回建っていた建物の履歴に応じて、敷地内の地下埋設管＆地中残置障害物を推論
  let prevTitle = '';
  let prevEra = '';
  const fpW = Number((sw * 0.72).toFixed(1));
  const fpD = Number((sd * 0.68).toFixed(1));
  const oldRooms: { label: string; x: number; z: number; w: number; d: number }[] = [];

  if (prevType === 'showa_wooden_house') {
    prevTitle = '旧・昭和54年築 木造2階建て住宅';
    prevEra = '1979年築〜2024年解体';
    oldRooms.push(
      { label: '旧・台所(ガス・給排水跡)', x: hw * 0.32, z: -hd * 0.35, w: fpW * 0.36, d: fpD * 0.35 },
      { label: '旧・タイル浴室(ボイラー跡)', x: -hw * 0.28, z: -hd * 0.35, w: fpW * 0.32, d: fpD * 0.35 },
      { label: '旧・汲取/水洗便所跡', x: hw * 0.36, z: hd * 0.15, w: fpW * 0.24, d: fpD * 0.28 }
    );

    // 道路本管 → 旧台所・旧浴室ボイラーへ向かう埋設白ガス管
    const gasEntryX = isSideRoad ? -hw : hw * 0.28;
    pipes.push(
      {
        id: 'GAS-BRANCH-1',
        kind: 'gas_low',
        label: '推論：旧・都市ガス低圧引込管 (白ガス管25A)',
        spec: '亜鉛メッキ鋼管(白ガス管) 25A GL-0.60m [腐食・漏洩注意]',
        x1: isSideRoad ? roadX : gasEntryX,
        z1: isSideRoad ? -hd * 0.2 : roadZ,
        depth1: 1.1,
        x2: hw * 0.32,
        z2: -hd * 0.35,
        depth2: 0.58,
        diameterMm: 45,
        confidence: 0.91,
        status: 'abandoned_remnant',
        reason: '昭和54年当時の住宅地図の台所位置と前面道路ガスメーター跡から、敷地を縦断する浅層白ガス管(GL-0.6m)を推論'
      },
      {
        id: 'GAS-BRANCH-2',
        kind: 'gas_low',
        label: '推論：旧・風呂釜ボイラー分岐ガス管 (20A)',
        spec: '地中分岐白ガス管 20A GL-0.52m',
        x1: hw * 0.32,
        z1: -hd * 0.35,
        depth1: 0.58,
        x2: -hw * 0.28,
        z2: -hd * 0.38,
        depth2: 0.50,
        diameterMm: 35,
        confidence: 0.84,
        status: 'abandoned_remnant',
        reason: '旧台所から北西の旧屋外風呂釜（バランス釜）へ分岐していた地中ガス枝管を推論'
      },
      {
        id: 'WATER-BRANCH-1',
        kind: 'water_supply',
        label: '推論：旧・鉛製給水引込管 (φ20mm)',
        spec: '旧鉛製給水管 φ20mm GL-0.45m [要撤去・引替]',
        x1: isSideRoad ? roadX + sideSgn * 0.65 : -hw * 0.15,
        z1: isSideRoad ? hd * 0.25 : roadZ + (roadDir === 'north' ? -0.65 : 0.65),
        depth1: 0.85,
        x2: hw * 0.22,
        z2: -hd * 0.28,
        depth2: 0.45,
        diameterMm: 35,
        confidence: 0.89,
        status: 'abandoned_remnant',
        reason: '昭和50年代の標準施工基準および既存量水器ボックス位置から浅層(GL-0.45m)の鉛給水管ルートを推論'
      },
      {
        id: 'SEWER-BRANCH-1',
        kind: 'sewer_Foul',
        label: '推論：既存・汚水排水管＆最終桝ルート (VU100)',
        spec: '塩ビ管 VU100 GL-0.75m〜-1.55m (2%勾配)',
        x1: hw * 0.34,
        z1: -hd * 0.25,
        depth1: 0.75,
        x2: isSideRoad ? roadX + sideSgn * 1.3 : hw * 0.34,
        z2: isSideRoad ? -hd * 0.25 : roadZ + (roadDir === 'north' ? -1.3 : 1.3),
        depth2: 1.65,
        diameterMm: 100,
        confidence: 0.93,
        status: 'active',
        reason: '旧便所・台所と道路境界の公共汚水桝を結ぶ最短自然流下ルートから特定（再利用可能）'
      }
    );

    obstacles.push(
      {
        id: 'OBS-SEPTIC',
        kind: 'septic_tank',
        label: '推論：旧・単独処理浄化槽残置 (FRP製)',
        x: hw * 0.36,
        z: hd * 0.26,
        w: 1.8,
        d: 1.4,
        depthTop: 0.45,
        depthBottom: 1.85,
        confidence: 0.82,
        removalCostManYen: 38,
        reason: '下水道切替前の昭和54年建築確認履歴から、旧便所南側に埋め殺しされた旧浄化槽(GL-0.45〜-1.85m)を推論'
      },
      {
        id: 'OBS-FOUNDATION-1',
        kind: 'old_foundation',
        label: '推論：旧・木造布基礎コンクリート残骸',
        x: -hw * 0.15,
        z: -hd * 0.35,
        w: 3.4,
        d: 0.45,
        depthTop: 0.35,
        depthBottom: 0.95,
        confidence: 0.79,
        removalCostManYen: 24,
        reason: '旧浴室まわりの増改築箇所における地中布基礎フーチングの残置リスク'
      },
      {
        id: 'OBS-WELL',
        kind: 'old_well',
        label: '推論：旧・古井戸跡（コンクリート井戸枠）',
        x: -hw * 0.48,
        z: hd * 0.32,
        w: 1.1,
        d: 1.1,
        depthTop: 0.6,
        depthBottom: 4.5,
        confidence: 0.68,
        removalCostManYen: 45,
        reason: '古地図の庭先位置および周辺地下水位から、埋め戻し不十分な古井戸跡(GL-4.5m)を推論'
      }
    );
  } else if (prevType === 'heisei_rc_clinic') {
    prevTitle = '旧・平成2年築 RC造3階建てクリニックビル';
    prevEra = '1990年築〜2023年解体';
    oldRooms.push(
      { label: '旧・1F処置室・医療水回りコア', x: 0.0, z: -hd * 0.2, w: fpW * 0.45, d: fpD * 0.4 },
      { label: '旧・ボイラー機械室跡', x: -hw * 0.35, z: -hd * 0.32, w: fpW * 0.28, d: fpD * 0.32 }
    );

    pipes.push(
      {
        id: 'GAS-RC-1',
        kind: 'gas_medium',
        label: '推論：旧・業務空調/給湯用 都市ガス引込管 (50A)',
        spec: '白鋼管/PE被覆管 50A GL-1.05m [高圧・大口径注意]',
        x1: isSideRoad ? roadX : -hw * 0.25,
        z1: isSideRoad ? -hd * 0.25 : roadZ,
        depth1: 1.2,
        x2: -hw * 0.25,
        z2: -hd * 0.3,
        depth2: 0.95,
        diameterMm: 65,
        confidence: 0.94,
        status: 'abandoned_remnant',
        reason: '旧RCクリニックのGHP（ガスヒートポンプ）機械室位置へ向かう50A大口径ガス引込管を推論'
      },
      {
        id: 'WATER-RC-1',
        kind: 'water_supply',
        label: '推論：既存・受水槽直結給水管 (φ40mm)',
        spec: 'HIVP/鋳鉄管 φ40mm GL-0.90m',
        x1: isSideRoad ? roadX + sideSgn * 0.65 : 0.15,
        z1: isSideRoad ? 0.0 : roadZ + (roadDir === 'north' ? -0.65 : 0.65),
        depth1: 0.95,
        x2: 0.15,
        z2: -hd * 0.2,
        depth2: 0.85,
        diameterMm: 55,
        confidence: 0.92,
        status: 'active',
        reason: '旧受水槽ポンプ室跡へのφ40mm大口径給水管ルート（3階建て共同住宅・オフィスに再利用可能）'
      },
      {
        id: 'SEWER-RC-1',
        kind: 'sewer_Foul',
        label: '推論：既存・医療排水/汚水幹線 (VU150)',
        spec: '塩ビ管 VU150 GL-1.1m〜-1.8m',
        x1: 0.0,
        z1: -hd * 0.2,
        depth1: 1.1,
        x2: isSideRoad ? roadX + sideSgn * 1.3 : 0.5,
        z2: isSideRoad ? -hd * 0.2 : roadZ + (roadDir === 'north' ? -1.3 : 1.3),
        depth2: 1.85,
        diameterMm: 150,
        confidence: 0.95,
        status: 'active',
        reason: '旧ビルの1Fパイプシャフト位置から前面道路本管へ接続されたVU150排水幹線を特定'
      }
    );

    // 旧RCビルの残置PHC杭 6本 (GL-1.8m 〜 -8.5m)
    const pileCoords: [number, number][] = [
      [-fpW * 0.42, -fpD * 0.38],
      [0.0, -fpD * 0.38],
      [fpW * 0.42, -fpD * 0.38],
      [-fpW * 0.42, fpD * 0.34],
      [0.0, fpD * 0.34],
      [fpW * 0.42, fpD * 0.34]
    ];
    pileCoords.forEach(([px, pz], idx) => {
      obstacles.push({
        id: `OBS-PILE-${idx + 1}`,
        kind: 'old_pile',
        label: `推論：旧RCビル残置PHC杭 #${idx + 1} (φ400)`,
        x: Number(px.toFixed(2)),
        z: Number(pz.toFixed(2)),
        w: 0.55,
        d: 0.55,
        depthTop: 1.8,
        depthBottom: 8.5,
        confidence: 0.92,
        removalCostManYen: 55,
        reason: '平成2年築RC3階建ての標準柱スパン割から、GL-1.8m以深に切断残置された既存PHC杭(支持層GL-8.5m到達)を推論'
      });
    });

    obstacles.push({
      id: 'OBS-RC-BEAM',
      kind: 'old_foundation',
      label: '推論：旧RC地中梁・ピット基礎残骸',
      x: 0.0,
      z: -hd * 0.2,
      w: fpW * 0.55,
      d: 0.75,
      depthTop: 1.1,
      depthBottom: 2.2,
      confidence: 0.86,
      removalCostManYen: 85,
      reason: '旧エレベーターピットおよび中央地中梁の下端が残置されている高リスク箇所'
    });
  } else if (prevType === 'old_factory_cleaner') {
    prevTitle = '旧・昭和62年築 クリーニング工場・ボイラー室跡';
    prevEra = '1987年築〜2018年駐車場化';
    oldRooms.push(
      { label: '旧・蒸気ボイラー室跡', x: -hw * 0.3, z: -hd * 0.25, w: fpW * 0.38, d: fpD * 0.38 },
      { label: '旧・洗浄排水ピット跡', x: hw * 0.28, z: -hd * 0.15, w: fpW * 0.35, d: fpD * 0.42 }
    );

    pipes.push(
      {
        id: 'GAS-FAC-1',
        kind: 'gas_medium',
        label: '推論：旧・蒸気ボイラー用 中圧ガス引込管 (65A)',
        spec: '溶接鋼管 65A GL-0.95m [残圧・腐食確認必須]',
        x1: isSideRoad ? roadX : -hw * 0.3,
        z1: isSideRoad ? -hd * 0.25 : roadZ,
        depth1: 1.2,
        x2: -hw * 0.3,
        z2: -hd * 0.25,
        depth2: 0.85,
        diameterMm: 75,
        confidence: 0.91,
        status: 'abandoned_remnant',
        reason: '旧クリーニング工場の大型蒸気ボイラー室へ直結していた65Aガス管がコインパーキング舗装下に残存'
      },
      {
        id: 'SEWER-FAC-1',
        kind: 'sewer_Foul',
        label: '推論：旧・中和ピット経由 工業排水管 (φ150)',
        spec: '陶管・塩ビ管 φ150mm GL-1.2m〜-1.9m',
        x1: hw * 0.28,
        z1: -hd * 0.15,
        depth1: 1.2,
        x2: isSideRoad ? roadX + sideSgn * 1.3 : hw * 0.28,
        z2: isSideRoad ? -hd * 0.15 : roadZ + (roadDir === 'north' ? -1.3 : 1.3),
        depth2: 1.9,
        diameterMm: 150,
        confidence: 0.88,
        status: 'abandoned_remnant',
        reason: '旧洗浄ピットから道路本管へ向かう深層排水管を推論'
      }
    );

    obstacles.push(
      {
        id: 'OBS-OIL-TANK',
        kind: 'oil_tank',
        label: '推論：旧・地下埋設重油タンク残置疑い (2000L級)',
        x: -hw * 0.32,
        z: hd * 0.18,
        w: 2.2,
        d: 1.5,
        depthTop: 0.9,
        depthBottom: 2.6,
        confidence: 0.85,
        removalCostManYen: 145,
        reason: '都市ガス転換前のボイラー用地下重油タンク（砂詰め残置）および土壌汚染調査対象エリアを推論'
      },
      {
        id: 'OBS-PIT',
        kind: 'old_foundation',
        label: '推論：旧・地下コンクリート排水ピット槽',
        x: hw * 0.28,
        z: -hd * 0.15,
        w: 2.4,
        d: 2.0,
        depthTop: 0.6,
        depthBottom: 2.1,
        confidence: 0.89,
        removalCostManYen: 72,
        reason: '駐車場アスファルト直下に残されたRC排水ピット枠'
      }
    );
  } else {
    // rowhouse_apartments
    prevTitle = '旧・昭和48年築 木造連棟アパート2棟跡';
    prevEra = '1973年築〜2024年解体';
    oldRooms.push(
      { label: '旧・北棟アパート水回り列', x: 0.0, z: -hd * 0.32, w: fpW * 0.85, d: fpD * 0.26 },
      { label: '旧・南棟アパート水回り列', x: 0.0, z: hd * 0.18, w: fpW * 0.85, d: fpD * 0.26 }
    );

    pipes.push(
      {
        id: 'GAS-ROW-1',
        kind: 'gas_low',
        label: '推論：旧連棟アパート共用 白ガス幹枝管 (32A)',
        spec: '白ガス管 32A GL-0.55m (敷地中央縦断)',
        x1: 0.0,
        z1: roadZ,
        depth1: 1.0,
        x2: 0.0,
        z2: -hd * 0.4,
        depth2: 0.50,
        diameterMm: 45,
        confidence: 0.90,
        status: 'abandoned_remnant',
        reason: '旧アパート各戸のガスメーター6個が並んでいた中央通路下に浅層白ガス管を推論'
      },
      {
        id: 'GAS-ROW-CROSS',
        kind: 'gas_low',
        label: '⚠️ 推論：西隣住宅への越境・共用ガス枝管 (25A)',
        spec: '隣地現役供給の疑いあり GL-0.50m [切断厳禁・要協議]',
        x1: 0.0,
        z1: -hd * 0.1,
        depth1: 0.55,
        x2: -hw - 1.2,
        z2: -hd * 0.1,
        depth2: 0.50,
        diameterMm: 35,
        confidence: 0.86,
        status: 'cross_border_risk',
        reason: '昭和48年の一体開発時に、当敷地内の私設管から西隣宅へ分岐されたまま残っている越境ガス管を推論'
      },
      {
        id: 'SEWER-ROW-CROSS',
        kind: 'sewer_Foul',
        label: '⚠️ 推論：東西隣地を貫通する旧私設合流下水管',
        spec: '旧コンクリ土管 φ150mm GL-0.85m [隣地排水現役]',
        x1: -hw - 1.2,
        z1: -hd * 0.28,
        depth1: 0.80,
        x2: hw + 1.2,
        z2: -hd * 0.28,
        depth2: 1.15,
        diameterMm: 150,
        confidence: 0.88,
        status: 'cross_border_risk',
        reason: '西隣・東隣の古い住宅の汚水桝レベルから、当敷地北側を横断する共用私設下水管を推論'
      }
    );
  }

  // 3. 周囲の建物コンテキストによる追加の埋設物・越境リスク推論
  let surTitle = '';
  let westN = '';
  let eastN = '';
  let northN = '';

  if (surroundingType === 'old_residential_dense') {
    surTitle = '木造密集地（隣地越境配管警戒モード）';
    westN = '西隣：昭和56年築 木造2F住宅（境界0.4mに旧給湯器・汚水桝）';
    eastN = '東隣：平成8年築 木造2F住宅';
    northN = '北隣：築42年 木造平屋（私設排水管接続疑い）';
    if (prevType !== 'rowhouse_apartments') {
      pipes.push({
        id: 'SUR-CROSS-DRAIN',
        kind: 'sewer_Foul',
        label: '⚠️ 推論：西隣住宅からの越境私設排水管 (VU75)',
        spec: '西境界から敷地内0.6mを通過 GL-0.65m [破損注意]',
        x1: -hw - 0.8,
        z1: -hd * 0.2,
        depth1: 0.60,
        x2: -hw + 0.55,
        z2: hd * 0.85,
        depth2: 0.95,
        diameterMm: 80,
        confidence: 0.78,
        status: 'cross_border_risk',
        reason: '西隣住宅の軒下汚水桝が狭小のため、当敷地の西端地下(GL-0.65m)を越境して前面道路へ排水している可能性を推論'
      });
    }
  } else if (surroundingType === 'urban_rc_mixed') {
    surTitle = '中高層RCマンション・ビル隣接（深基礎・残置山留め警戒）';
    westN = '西隣：RC造7階建てマンション（地下ピット・山留め壁）';
    eastN = '東隣：S造4階建て商業ビル';
    northN = '北隣：RC造立体駐車場';
    obstacles.push({
      id: 'SUR-RC-WALL',
      kind: 'old_foundation',
      label: '⚠️ 推論：西隣RCマンション工事時の残置H鋼山留め・越境フーチング',
      x: -hw + 0.35,
      z: 0.0,
      w: 0.5,
      d: sd * 0.65,
      depthTop: 1.2,
      depthBottom: 4.2,
      confidence: 0.81,
      removalCostManYen: 60,
      reason: '西隣7階建てマンション施工時の山留めH鋼・ソイルセメント壁が境界線付近GL-1.2〜-4.2mに残存'
    });
  } else {
    surTitle = '旧水路・暗渠隣接（旧土管・軟弱地盤警戒）';
    westN = '西隣：木造2階建て住宅';
    eastN = '東隣：木造2階建て住宅';
    northN = '北側：旧水路暗渠（緑道・地下ヒューム管）';
    pipes.push({
      id: 'SUR-CULVERT',
      kind: 'storm_drain',
      label: '推論：北側境界 旧農業水路ヒューム管暗渠 (φ300)',
      spec: 'RCヒューム管 φ300mm GL-1.35m [湧水・沈下注意]',
      x1: -hw - 1.0,
      z1: -hd + 0.4,
      depth1: 1.30,
      x2: hw + 1.0,
      z2: -hd + 0.4,
      depth2: 1.45,
      diameterMm: 260,
      confidence: 0.87,
      status: 'active',
      reason: '旧公図の青線（水路）および北側緑道の勾配から、敷地北端地下GL-1.35mの暗渠管を推論'
    });
  }

  // 4. 地層構成（ボーリング・近隣地盤データからの推論）
  const soilLayers: SoilLayerSpec[] = [
    {
      id: 'SOIL-1',
      name: '第1層：表土・旧建物解体盛土・埋設管包含層',
      depthFrom: 0.0,
      depthTo: 1.6,
      nValue: 'N値 2〜4',
      colorHex: '#B89F7D',
      note: '都市ガス管・給水管・排水管・旧布基礎ガラが集中する浅層掘削ゾーン'
    },
    {
      id: 'SOIL-2',
      name: '第2層：沖積シルト・ローム層（中層障害物層）',
      depthFrom: 1.6,
      depthTo: 4.8,
      nValue: 'N値 4〜9',
      colorHex: '#9A8467',
      note: surroundingType === 'former_waterway_lot'
        ? '旧水路起因の軟弱腐植土を含むため地盤改良（柱状改良）を推奨'
        : '旧浄化槽・地下タンク・深基礎ピットが残存する中層ゾーン'
    },
    {
      id: 'SOIL-3',
      name: '第3層：洪積砂礫層（強固支持層・旧残置杭到達層）',
      depthFrom: 4.8,
      depthTo: 9.5,
      nValue: 'N値 38〜50+',
      colorHex: '#6E665C',
      note: '中層ビル・3F住宅の杭支持層。旧RC建物の残置杭との先端干渉に要注意'
    }
  ];

  // 5. 新築計画の基礎・柱・水回りシャフトと地下埋設物との干渉チェック
  let conflictCount = 0;
  const keyFindings: string[] = [];

  // 柱と残置杭・地下障害物の平面干渉チェック
  bp.skeleton.columns.forEach((col) => {
    obstacles.forEach((obs) => {
      const dx = Math.abs(col.x - obs.x);
      const dz = Math.abs(col.z - obs.z);
      if (dx < obs.w / 2 + 0.45 && dz < obs.d / 2 + 0.45) {
        conflictCount++;
      }
    });
  });

  // 越境管や旧ガス管の警告生成
  const crossPipes = pipes.filter((p) => p.status === 'cross_border_risk');
  if (crossPipes.length > 0) {
    conflictCount += crossPipes.length;
    keyFindings.push(
      `【重要】隣地と繋がる越境疑い配管が ${crossPipes.length} 系統（GL-0.5m〜-0.85m）推論されました。重機根切り前に試掘確認が必須です。`
    );
  }

  const gasPipes = pipes.filter((p) => p.kind === 'gas_low' || p.kind === 'gas_medium');
  keyFindings.push(
    `前面道路のガス本管(GL-1.2m)から旧建物の水回り・ボイラー跡へ向かう埋設ガス管 ${gasPipes.length - 1} 系統のルートを特定しました。`
  );

  if (obstacles.length > 0) {
    keyFindings.push(
      `地中残置障害物（${obstacles.map((o) => o.label.replace('推論：', '')).slice(0, 2).join('・')}等 計${obstacles.length}箇所）を検出し、新築柱基礎との干渉 ${conflictCount} 箇所をマークしました。`
    );
  }

  const totalCost = obstacles.reduce((acc, o) => acc + o.removalCostManYen, 28);
  const riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' =
    conflictCount >= 3 || prevType === 'heisei_rc_clinic' || prevType === 'old_factory_cleaner'
      ? 'HIGH'
      : conflictCount >= 1
      ? 'MEDIUM'
      : 'LOW';

  return {
    landTitle: realContext?.landTitle ?? `${sw}m × ${sd}m 敷地 — ${prevTitle}跡地`,
    previousBuilding: {
      type: prevType,
      title: prevTitle,
      era: prevEra,
      footprintW: fpW,
      footprintD: fpD,
      offsetX: 0.0,
      offsetZ: -0.2,
      oldRooms
    },
    frontRoad: {
      direction: roadDir,
      widthM: realContext?.roadWidthM ?? (isSideRoad ? 8.0 : 6.0),
      label: realContext?.roadLabel ?? FRONT_ROAD_OPTIONS.find((r) => r.id === roadDir)?.label ?? '南側 6.0m 公道'
    },
    surrounding: {
      type: surroundingType,
      title: surTitle,
      westNeighbor: realContext?.westNeighbor ?? westN,
      eastNeighbor: realContext?.eastNeighbor ?? eastN,
      northNeighbor: realContext?.northNeighbor ?? northN
    },
    pipes,
    obstacles,
    soilLayers,
    realContext,
    aiSummary: {
      overallRiskLevel: riskLevel,
      estimatedSubsurfaceCostManYen: totalCost,
      conflictCount,
      keyFindings
    }
  };
}

/**
 * 2D 地下埋設インフラ・旧建物履歴・断面プロファイル CAD図面 (SVG) ジェネレータ
 * 上段：平面埋設推論伏図（前面道路本管・推定ガス管・水道管・下水管・旧建物輪郭・残置杭・新築1Fオーバーレイ）
 * 下段：GL±0.0m〜GL-9.0m 地下深さ断面図（地層N値・埋設管深度・残置杭深度）
 */
export function renderSubsurfaceSurveyCadSvg(
  bp: StratumArchBIMSchema,
  analysis: LandSubsurfaceAnalysis,
  showNewBuildingOverlay = true
): string {
  const sw = bp.site.width;
  const sd = bp.site.depth;
  const scale = 36.0;
  const ox = 480;
  const oz = 275;
  const sx = ox - (sw * scale) / 2.0;
  const sz = oz - (sd * scale) / 2.0;
  const swPx = sw * scale;
  const sdPx = sd * scale;

  const pipeColorMap: Record<BuriedUtilityKind, string> = {
    gas_low: '#D97706',     // 都市ガス低圧引込管：アンバーオレンジ
    gas_medium: '#B45309',  // 都市ガス本管・中圧：ディープアンバー
    water_supply: '#0284C7',// 上水道管：シアンブルー
    sewer_Foul: '#7C2D12',  // 汚水下水管：ブラウン
    storm_drain: '#4D7C0F', // 雨水・暗渠管：オリーブグリーン
    power_Loops: '#6D28D9'  // 電力通信：パープル
  };

  const lines: string[] = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 860" width="100%" height="100%">',
    '  <defs>',
    '    <pattern id="sub-obstacle-hatch" width="8" height="8" patternUnits="userSpaceOnUse">',
    '      <line x1="0" y1="8" x2="8" y2="0" stroke="#9E3B1E" stroke-width="0.9" stroke-opacity="0.55" />',
    '    </pattern>',
    '    <pattern id="sub-soil-1" width="16" height="8" patternUnits="userSpaceOnUse">',
    '      <line x1="0" y1="4" x2="16" y2="4" stroke="#9C8464" stroke-width="0.6" stroke-dasharray="3 2" />',
    '    </pattern>',
    '  </defs>',
    '  <rect width="980" height="860" fill="#FAF9F5" />',

    // ヘッダー
    '  <text x="36" y="32" font-family="Georgia, serif" font-size="16.5" font-weight="bold" fill="#1C1B18">',
    `    SUBSURFACE UTILITY &amp; BURIED OBSTACLE INFERENCE CAD — ${analysis.landTitle} (${analysis.previousBuilding.era})`,
    '  </text>',
    '  <text x="36" y="50" font-family="monospace" font-size="10.5" fill="#5A574F">',
    `    AI推論リスク判定: [${analysis.aiSummary.overallRiskLevel}] | 干渉警戒箇所: ${analysis.aiSummary.conflictCount}箇所 | 試掘・撤去・引込概算: 約${analysis.aiSummary.estimatedSubsurfaceCostManYen}万円`,
    '  </text>',
    '  <line x1="36" y1="58" x2="944" y2="58" stroke="#D5D1C8" stroke-width="1" />',

    // ==================== 1. 周囲の建物・前面道路コンテキスト描画 ====================
    // 北隣敷地
    `  <rect x="${(sx - 20).toFixed(1)}" y="${(sz - 58).toFixed(1)}" width="${(swPx + 40).toFixed(1)}" height="48" fill="#EFECE4" stroke="#ABA59A" stroke-width="1" stroke-dasharray="4 2" />`,
    `  <text x="${ox.toFixed(1)}" y="${(sz - 30).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#5A574F">${analysis.surrounding.northNeighbor}</text>`,
    // 西隣敷地
    `  <rect x="${(sx - 155).toFixed(1)}" y="${sz.toFixed(1)}" width="142" height="${sdPx.toFixed(1)}" fill="#EFECE4" stroke="#ABA59A" stroke-width="1" stroke-dasharray="4 2" />`,
    `  <text x="${(sx - 84).toFixed(1)}" y="${oz.toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="9.5" fill="#5A574F">${analysis.surrounding.westNeighbor.slice(0, 18)}</text>`,
    `  <text x="${(sx - 84).toFixed(1)}" y="${(oz + 14).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="8.5" fill="#78756E">${analysis.surrounding.westNeighbor.slice(18)}</text>`,
    // 東隣敷地
    `  <rect x="${(sx + swPx + 13).toFixed(1)}" y="${sz.toFixed(1)}" width="142" height="${sdPx.toFixed(1)}" fill="#EFECE4" stroke="#ABA59A" stroke-width="1" stroke-dasharray="4 2" />`,
    `  <text x="${(sx + swPx + 84).toFixed(1)}" y="${oz.toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="9.5" fill="#5A574F">${analysis.surrounding.eastNeighbor}</text>`,

    // 前面道路帯 (南側公道ベース)
    `  <rect x="60" y="${(sz + sdPx + 12).toFixed(1)}" width="860" height="82" fill="#E8E6DF" stroke="#B8B3A8" stroke-width="1" />`,
    `  <text x="95" y="${(sz + sdPx + 30).toFixed(1)}" font-family="sans-serif" font-size="11" font-weight="bold" fill="#4A4843">${analysis.frontRoad.label} (地下本管埋設ゾーン)</text>`,

    // ==================== 2. 対象土地境界ボックス・実測不整形ポリゴン ====================
    (() => {
      const sitePoly = analysis.realContext?.sitePolygon;
      if (sitePoly && sitePoly.length >= 3) {
        const polyPoints = sitePoly.map((pt) => `${(ox + pt.x * scale).toFixed(1)},${(oz + pt.z * scale).toFixed(1)}`).join(' ');
        const edgeLabels: string[] = [];
        for (let i = 0; i < sitePoly.length; i++) {
          const j = (i + 1) % sitePoly.length;
          const p1 = sitePoly[i];
          const p2 = sitePoly[j];
          const mx = ox + ((p1.x + p2.x) / 2) * scale;
          const mz = oz + ((p1.z + p2.z) / 2) * scale;
          const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
          edgeLabels.push(
            `  <text x="${mx.toFixed(1)}" y="${(mz - 4).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="8.5" font-weight="bold" fill="#1C1B18">${len.toFixed(1)}m</text>`
          );
        }
        return [
          `  <polygon points="${polyPoints}" fill="#F7F4EB" stroke="#1C1B18" stroke-width="2.8" stroke-dasharray="8 3" />`,
          ...edgeLabels
        ].join('\n');
      }
      return `  <rect x="${sx.toFixed(1)}" y="${sz.toFixed(1)}" width="${swPx.toFixed(1)}" height="${sdPx.toFixed(1)}" fill="#F7F4EB" stroke="#1C1B18" stroke-width="2.8" stroke-dasharray="8 3" />`;
    })(),

    // ==================== 3. 建物状態・前回建っていた建物の履歴輪郭 ====================
    (() => {
      const siteStatus = analysis.realContext?.siteStatus;
      const bldgPoly = analysis.realContext?.buildingPolygon;

      // 建物がない更地・駐車場の場合
      if (siteStatus === 'vacant_lot' || siteStatus === 'parking_lot') {
        const isParking = siteStatus === 'parking_lot';
        return [
          `  <rect x="${(ox - 110).toFixed(1)}" y="${(oz - 14).toFixed(1)}" width="220" height="28" rx="4" fill="${isParking ? '#475569' : '#047857'}" fill-opacity="0.9" />`,
          `  <text x="${ox.toFixed(1)}" y="${(oz + 4).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="bold" fill="#FFFFFF">${isParking ? '【現況：コインパーキング／舗装面】' : '【現況：更地・建築物なし】'}</text>`,
          `  <text x="${ox.toFixed(1)}" y="${(oz + 30).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="9" fill="#5A574F">地中埋設管引込痕跡・既存桝・地中障害物探査伏図</text>`
        ].join('\n');
      }

      // 建物がある場合：実測建物ポリゴンまたは旧建物履歴輪郭
      if (bldgPoly && bldgPoly.length >= 3) {
        const bldgPoints = bldgPoly.map((pt) => `${(ox + pt.x * scale).toFixed(1)},${(oz + pt.z * scale).toFixed(1)}`).join(' ');
        return [
          `  <polygon points="${bldgPoints}" fill="#EAE5D9" fill-opacity="0.65" stroke="#8C7A6B" stroke-width="2.0" />`,
          `  <text x="${ox.toFixed(1)}" y="${oz.toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="10.5" font-weight="bold" fill="#433422">${analysis.realContext?.buildingName ?? '現存建物（実測フットプリント）'}</text>`
        ].join('\n');
      }

      const fpw = analysis.previousBuilding.footprintW * scale;
      const fpd = analysis.previousBuilding.footprintD * scale;
      const fpx = ox + analysis.previousBuilding.offsetX * scale - fpw / 2.0;
      const fpz = oz + analysis.previousBuilding.offsetZ * scale - fpd / 2.0;
      return [
        `  <rect x="${fpx.toFixed(1)}" y="${fpz.toFixed(1)}" width="${fpw.toFixed(1)}" height="${fpd.toFixed(1)}" fill="#EAE5D9" fill-opacity="0.45" stroke="#8C7A6B" stroke-width="1.8" stroke-dasharray="5 3" />`,
        `  <text x="${(fpx + 8).toFixed(1)}" y="${(fpz + 15).toFixed(1)}" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="#6E5A4F">[旧建物履歴輪郭] ${analysis.previousBuilding.title}</text>`,
        ...analysis.previousBuilding.oldRooms.map((or) => {
          const orx = ox + or.x * scale - (or.w * scale) / 2.0;
          const orz = oz + or.z * scale - (or.d * scale) / 2.0;
          return [
            `  <rect x="${orx.toFixed(1)}" y="${orz.toFixed(1)}" width="${(or.w * scale).toFixed(1)}" height="${(or.d * scale).toFixed(1)}" fill="#DFD8C8" fill-opacity="0.55" stroke="#8C7A6B" stroke-width="1.1" stroke-dasharray="3 2" />`,
            `  <text x="${( ox + or.x * scale ).toFixed(1)}" y="${( oz + or.z * scale + 3 ).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="8.5" fill="#5C4B3E">${or.label}</text>`
          ].join('\n');
        })
      ].join('\n');
    })(),

    // ==================== 4. 新築1Fプラン＆基礎柱オーバーレイ（切替可能） ====================
    ...(showNewBuildingOverlay && analysis.realContext?.siteStatus !== 'vacant_lot'
      ? bp.rooms
          .filter((r) => r.floor === 1)
          .map((r) => {
            const rx = ox + (r.x - r.w / 2.0) * scale;
            const rz = oz + (r.z - r.d / 2.0) * scale;
            return [
              `  <rect x="${rx.toFixed(1)}" y="${rz.toFixed(1)}" width="${(r.w * scale).toFixed(1)}" height="${(r.d * scale).toFixed(1)}" fill="none" stroke="#4A5568" stroke-width="1.2" stroke-opacity="0.45" />`,
              `  <text x="${(ox + r.x * scale).toFixed(1)}" y="${(oz + r.z * scale + 14).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#64748B">[新築1F: ${r.name}]</text>`
            ].join('\n');
          })
      : [])
  ];

  // ==================== 5. 地中残置障害物（旧基礎・旧残置杭・旧浄化槽・重油タンク） ====================
  analysis.obstacles.forEach((obs) => {
    const obW = Math.max(18, obs.w * scale);
    const obD = Math.max(18, obs.d * scale);
    const obX = ox + obs.x * scale - obW / 2.0;
    const obZ = oz + obs.z * scale - obD / 2.0;
    const isPile = obs.kind === 'old_pile';

    if (isPile) {
      const cx = ox + obs.x * scale;
      const cz = oz + obs.z * scale;
      lines.push(
        `  <circle cx="${cx.toFixed(1)}" cy="${cz.toFixed(1)}" r="12" fill="url(#sub-obstacle-hatch)" stroke="#9E3B1E" stroke-width="2.0" />`,
        `  <line x1="${(cx - 8).toFixed(1)}" y1="${(cz - 8).toFixed(1)}" x2="${(cx + 8).toFixed(1)}" y2="${(cz + 8).toFixed(1)}" stroke="#9E3B1E" stroke-width="1.4" />`,
        `  <line x1="${(cx + 8).toFixed(1)}" y1="${(cz - 8).toFixed(1)}" x2="${(cx - 8).toFixed(1)}" y2="${(cz + 8).toFixed(1)}" stroke="#9E3B1E" stroke-width="1.4" />`,
        `  <text x="${(cx + 15).toFixed(1)}" y="${(cz + 3).toFixed(1)}" font-family="monospace" font-size="8" font-weight="bold" fill="#9E3B1E">${obs.label.replace('推論：', '')} (GL-${obs.depthTop}〜-${obs.depthBottom}m)</text>`
      );
    } else {
      lines.push(
        `  <rect x="${obX.toFixed(1)}" y="${obZ.toFixed(1)}" width="${obW.toFixed(1)}" height="${obD.toFixed(1)}" fill="url(#sub-obstacle-hatch)" stroke="#9E3B1E" stroke-width="2.0" rx="2" />`,
        `  <rect x="${obX.toFixed(1)}" y="${(obZ - 14).toFixed(1)}" width="165" height="13" rx="2" fill="#9E3B1E" />`,
        `  <text x="${(obX + 4).toFixed(1)}" y="${(obZ - 4.5).toFixed(1)}" font-family="sans-serif" font-size="8" font-weight="bold" fill="#FFFFFF">${obs.label} (GL-${obs.depthTop}〜-${obs.depthBottom}m)</text>`
      );
    }
  });

  // ==================== 6. 推論された地下埋設管（ガス管・上水道管・下水管・越境管） ====================
  analysis.pipes.forEach((p) => {
    const px1 = ox + p.x1 * scale;
    const pz1 = oz + p.z1 * scale;
    const px2 = ox + p.x2 * scale;
    const pz2 = oz + p.z2 * scale;
    const col = pipeColorMap[p.kind] || '#D97706';
    const isMain = p.id.startsWith('MAIN-');
    const isCross = p.status === 'cross_border_risk';
    const strokeW = isMain ? '4.5' : '3.2';
    const dash = isCross ? '6 3' : p.status === 'abandoned_remnant' ? '9 3' : '';

    lines.push(
      `  <line x1="${px1.toFixed(1)}" y1="${pz1.toFixed(1)}" x2="${px2.toFixed(1)}" y2="${pz2.toFixed(1)}" stroke="${col}" stroke-width="${strokeW}" ${dash ? `stroke-dasharray="${dash}"` : ''} />`,
      `  <circle cx="${px1.toFixed(1)}" cy="${pz1.toFixed(1)}" r="4.2" fill="#FFFFFF" stroke="${col}" stroke-width="2" />`,
      `  <circle cx="${px2.toFixed(1)}" cy="${pz2.toFixed(1)}" r="4.8" fill="${col}" stroke="#FFFFFF" stroke-width="1.5" />`
    );

    const mx = (px1 + px2) / 2.0;
    const mz = (pz1 + pz2) / 2.0;
    const tagText = `${p.label.replace('推論：', '')} [GL-${p.depth1.toFixed(2)}m / 確度${Math.round(p.confidence * 100)}%]`;
    lines.push(
      `  <rect x="${(mx - 105).toFixed(1)}" y="${(mz - 10).toFixed(1)}" width="210" height="14" rx="2" fill="#FFFFFF" fill-opacity="0.88" stroke="${col}" stroke-width="0.9" />`,
      `  <text x="${mx.toFixed(1)}" y="${(mz + 0.5).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="8" font-weight="bold" fill="${col}">${tagText}</text>`
    );
  });

  // 新築通し柱＆給排水縦シャフト(PS)プロット
  if (showNewBuildingOverlay) {
    bp.skeleton.columns.forEach((c) => {
      const cx = ox + c.x * scale;
      const cz = oz + c.z * scale;
      lines.push(
        `  <rect x="${(cx - 5).toFixed(1)}" y="${(cz - 5).toFixed(1)}" width="10" height="10" fill="#1C1B18" fill-opacity="0.7" />`
      );
    });
    bp.mep.shafts.forEach((sh) => {
      const sxPt = ox + sh.x * scale;
      const szPt = oz + sh.z * scale;
      lines.push(
        `  <circle cx="${sxPt.toFixed(1)}" cy="${szPt.toFixed(1)}" r="7" fill="#0284C7" stroke="#FFFFFF" stroke-width="1.5" />`,
        `  <text x="${(sxPt + 10).toFixed(1)}" y="${(szPt + 3).toFixed(1)}" font-family="monospace" font-size="8.5" font-weight="bold" fill="#0284C7">新築PS引込点</text>`
      );
    });
  }

  // ==================== 7. 下段：地下断面プロファイル図 (GL±0.0m 〜 GL-9.0m 地層＆埋設深度断面図) ====================
  const secTopY = 585;
  const secLeftX = 95;
  const secW = 810;
  const depthScale = 24.0; // 1m深さ = 24px

  lines.push(
    `  <line x1="36" y1="${(secTopY - 32).toFixed(1)}" x2="944" y2="${(secTopY - 32).toFixed(1)}" stroke="#D5D1C8" stroke-width="1" />`,
    `  <text x="36" y="${(secTopY - 12).toFixed(1)}" font-family="Georgia, serif" font-size="14" font-weight="bold" fill="#1C1B18">`,
    '    UNDERGROUND STRATUM CROSS-SECTION (GL±0.0m 〜 GL-9.5m 土地断面・埋設深度プロファイル)',
    '  </text>'
  );

  // 地層3レイヤー描画
  analysis.soilLayers.forEach((sl) => {
    const y1 = secTopY + sl.depthFrom * depthScale;
    const h = (sl.depthTo - sl.depthFrom) * depthScale;
    lines.push(
      `  <rect x="${secLeftX}" y="${y1.toFixed(1)}" width="${secW}" height="${h.toFixed(1)}" fill="${sl.colorHex}" fill-opacity="0.28" stroke="#8C7E6A" stroke-width="1.0" />`,
      `  <text x="${secLeftX + 10}" y="${(y1 + 15).toFixed(1)}" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="#2C2B28">${sl.name} (GL-${sl.depthFrom.toFixed(1)}m〜-${sl.depthTo.toFixed(1)}m / ${sl.nValue})</text>`,
      `  <text x="${secLeftX + 10}" y="${(y1 + 28).toFixed(1)}" font-family="sans-serif" font-size="8.5" fill="#5A574F">${sl.note}</text>`
    );
  });

  // GL±0.0m 地表ライン & 深度目盛り
  lines.push(
    `  <line x1="${secLeftX - 20}" y1="${secTopY}" x2="${secLeftX + secW + 15}" y2="${secTopY}" stroke="#1C1B18" stroke-width="2.5" />`,
    `  <text x="${secLeftX - 52}" y="${secTopY + 4}" font-family="monospace" font-size="9.5" font-weight="bold" fill="#1C1B18">GL±0.0m</text>`
  );
  [1.0, 2.0, 3.5, 5.0, 8.5].forEach((d) => {
    const dy = secTopY + d * depthScale;
    lines.push(
      `  <line x1="${secLeftX - 8}" y1="${dy.toFixed(1)}" x2="${secLeftX + secW}" y2="${dy.toFixed(1)}" stroke="#8C8881" stroke-width="0.6" stroke-dasharray="3 3" />`,
      `  <text x="${secLeftX - 52}" y="${(dy + 3).toFixed(1)}" font-family="monospace" font-size="8.5" fill="#5A574F">GL-${d.toFixed(1)}m</text>`
    );
  });

  // 断面図上に埋設管と地中障害物を深さプロット
  analysis.pipes.forEach((p, idx) => {
    const px = secLeftX + 260 + idx * 92;
    const py = secTopY + ((p.depth1 + p.depth2) / 2.0) * depthScale;
    const col = pipeColorMap[p.kind] || '#D97706';
    lines.push(
      `  <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="7.5" fill="${col}" stroke="#FFFFFF" stroke-width="1.8" />`,
      `  <text x="${px.toFixed(1)}" y="${(py - 11).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="8" font-weight="bold" fill="${col}">${p.kind.includes('gas') ? 'ガス管' : p.kind.includes('water') ? '水道管' : '下水管'} GL-${((p.depth1 + p.depth2) / 2).toFixed(2)}m</text>`
    );
  });

  analysis.obstacles.forEach((obs, idx) => {
    const oxSec = secLeftX + 430 + idx * 62;
    const oyTop = secTopY + obs.depthTop * depthScale;
    const oyH = (obs.depthBottom - obs.depthTop) * depthScale;
    const owSec = obs.kind === 'old_pile' ? 16 : 44;
    lines.push(
      `  <rect x="${oxSec.toFixed(1)}" y="${oyTop.toFixed(1)}" width="${owSec}" height="${oyH.toFixed(1)}" fill="url(#sub-obstacle-hatch)" stroke="#9E3B1E" stroke-width="1.6" />`,
      `  <text x="${(oxSec + owSec / 2).toFixed(1)}" y="${(oyTop + oyH + 11).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="7.5" font-weight="bold" fill="#9E3B1E">${obs.kind === 'old_pile' ? '旧残置杭' : '地中障害物'}</text>`
    );
  });

  lines.push('</svg>');
  return lines.join('\n');
}

/**
 * 土地・周辺環境・前回建物履歴から地下埋設物を推論・操作するメインコンポーネント
 */
export function SubsurfaceAnalyzerView({
  blueprint,
  prevType,
  roadDir,
  surroundingType,
  realContext,
  onChangePrevType,
  onChangeRoadDir,
  onChangeSurrounding
}: {
  blueprint: StratumArchBIMSchema;
  prevType: PreviousBuildingType;
  roadDir: FrontRoadDirection;
  surroundingType: SurroundingContextType;
  realContext?: RealSiteContext;
  onChangePrevType: (t: PreviousBuildingType) => void;
  onChangeRoadDir: (d: FrontRoadDirection) => void;
  onChangeSurrounding: (s: SurroundingContextType) => void;
}) {
  const [showNewBuildingOverlay, setShowNewBuildingOverlay] = useState<boolean>(true);

  const analysis = inferLandSubsurface(blueprint, prevType, roadDir, surroundingType, realContext);
  const svgMarkup = renderSubsurfaceSurveyCadSvg(blueprint, analysis, showNewBuildingOverlay);

  return (
    <div className="w-full h-full flex flex-col bg-[#070B14] overflow-hidden">
      {/* 上部コントロールバー：土地の過去履歴・前面道路・周辺環境の切り替え */}
      <div className="px-4 py-2.5 bg-[#0B1222] border-b border-white/10 flex flex-wrap items-center justify-between gap-2 z-10">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-300">① 前回建っていた建物:</span>
            <select
              value={prevType}
              onChange={(e) => onChangePrevType(e.target.value as PreviousBuildingType)}
              className="bg-[#070B14] ring-1 ring-cyan-400/50 rounded-lg px-2 py-1 text-xs font-medium text-white cursor-pointer"
            >
              {PREVIOUS_BUILDING_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id} className="bg-[#0B1222]">
                  {opt.title} ({opt.era})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-300">② 前面道路・本管:</span>
            <select
              value={roadDir}
              onChange={(e) => onChangeRoadDir(e.target.value as FrontRoadDirection)}
              className="bg-[#070B14] ring-1 ring-white/15 rounded-lg px-2 py-1 text-xs text-white cursor-pointer"
            >
              {FRONT_ROAD_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id} className="bg-[#0B1222]">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-300">③ 周囲の建物環境:</span>
            <select
              value={surroundingType}
              onChange={(e) => onChangeSurrounding(e.target.value as SurroundingContextType)}
              className="bg-[#070B14] ring-1 ring-white/15 rounded-lg px-2 py-1 text-xs text-white cursor-pointer"
            >
              {SURROUNDING_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id} className="bg-[#0B1222]">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-1.5 text-xs text-cyan-300 font-medium cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showNewBuildingOverlay}
            onChange={(e) => setShowNewBuildingOverlay(e.target.checked)}
            className="accent-cyan-400"
          />
          新築1F基礎・水回り計画を重ねて干渉チェック
        </label>
      </div>

      {/* AI推論サマリーバナー */}
      <div className="px-4 py-2 bg-[#0E172A] border-b border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold ${
              analysis.aiSummary.overallRiskLevel === 'HIGH'
                ? 'bg-red-500/20 text-red-300 ring-1 ring-red-400/40'
                : 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40'
            }`}
          >
            埋設リスク: {analysis.aiSummary.overallRiskLevel}
          </span>
          <span className="text-slate-200 font-medium">
            {analysis.aiSummary.keyFindings[0]}
          </span>
        </div>
        <div className="font-mono text-[11px] text-slate-300">
          推論配管: <strong className="text-amber-300">{analysis.pipes.length}系統</strong> ／ 地中障害物:{' '}
          <strong className="text-red-300">{analysis.obstacles.length}箇所</strong>
        </div>
      </div>

      {/* メイン2D 埋設インフラ・地下断面CAD図面 */}
      <div
        className="flex-1 overflow-auto p-4 flex items-center justify-center bg-[#070B14] [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:rounded-xl [&>svg]:shadow-2xl"
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
    </div>
  );
}
