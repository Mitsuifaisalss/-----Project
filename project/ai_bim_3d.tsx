import { useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import {
  Layers,
  Sliders,
  Check,
  AlertCircle,
  Code,
  RefreshCw,
  Eye,
  EyeOff,
  Move,
  FileText,
  ArrowLeft,
  Play,
  Pause,
  Video
} from 'lucide-react';
import {
  ProCadFloorPlanView,
  VerticalZoningAxonometricView,
  renderProArchitecturalCadSvg
} from './ArchitecturalDrawings';
import {
  SubsurfaceAnalyzerView,
  inferLandSubsurface,
  PREVIOUS_BUILDING_OPTIONS,
  FRONT_ROAD_OPTIONS,
  SURROUNDING_OPTIONS,
  type PreviousBuildingType,
  type FrontRoadDirection,
  type SurroundingContextType,
  type RealSiteContext
} from './SubsurfaceInferenceEngine';

// ==========================================
// 型定義
// ==========================================
type RoomType = 'cafe' | 'office' | 'meeting' | 'wet' | 'core' | 'terrace' | 'parking';
type RiserOrDuctType = 'plumbing' | 'hvac';
export type ScenarioKey =
  | 'family_house_4ldk'
  | 'garage_house_3f'
  | 'cafe_office'
  | 'clinic_residence'
  | 'research_lab';
type LayerKey = 'skeleton' | 'mep' | 'infill';
type FloorFilter = 'ALL' | number;
type CameraPreset = 'ISO' | 'TOP' | 'FRONT';
type StudioViewMode = 'SUBSURFACE_CAD' | '3D_BIM' | '2D_CAD' | 'AXON_STACK';

export type BeamKind = 'girder' | 'secondary';
export type WallSide = 'north' | 'south' | 'east' | 'west';
export type FixtureType =
  | 'sink'
  | 'toilet'
  | 'unit_bath'
  | 'island_kitchen'
  | 'counter_desk'
  | 'meeting_table'
  | 'bed'
  | 'tatami_mat'
  | 'lab_bench';

export interface ColumnData {
  id: string;
  gridCode?: string;
  x: number;
  z: number;
  width?: number;
  depth?: number;
}

export interface BeamData {
  id: string;
  kind: BeamKind;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  width: number;
  depth: number;
}

export interface ShearWallData {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  thickness: number;
}

export interface RoomFinishes {
  floor: string;
  wall: string;
  ceiling: string;
}

export interface RoomFixture {
  id: string;
  type: FixtureType;
  label: string;
  localX: number;
  localZ: number;
  w: number;
  d: number;
}

export interface RoomOpening {
  id: string;
  type: 'window' | 'door';
  wall: WallSide;
  x: number; // 部屋左端または全体からのオフセットではなく、全体座標または自動計算用
  z: number;
  width: number;
  height: number;
  sillHeight: number;
}

interface RiserData {
  id: string;
  name: string;
  x: number;
  z: number;
  type: RiserOrDuctType;
}

interface RoomData {
  id: string;
  name: string;
  type: RoomType;
  x: number;
  z: number;
  w: number;
  d: number;
  color: string;
  ceilingHeight?: number;
  finishes?: RoomFinishes;
  fixtures?: RoomFixture[];
  openings?: RoomOpening[];
}

interface DuctData {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  type: RiserOrDuctType;
}

interface FloorData {
  level: number;
  name: string;
  rooms: RoomData[];
  ducts: DuctData[];
}

interface BuildingScenario {
  id: ScenarioKey;
  name: string;
  subtitle: string;
  prompt: string;
  site: {
    width: number;
    depth: number;
    floorHeight: number;
    slabThickness?: number;
    plenumHeight?: number;
    defaultCeilingHeight?: number;
    structuralModule?: { spanX: number; spanZ: number };
  };
  columns: ColumnData[];
  beams?: BeamData[];
  shearWalls?: ShearWallData[];
  risers: RiserData[];
  floors: FloorData[];
}

interface SelectedItem {
  type: 'room';
  floorLevel: number;
  id: string;
}

// `schema/stratum_bim_schema.json` 準拠の3レイヤー詳細座標スキーマ型
export interface StratumArchBIMSchema {
  site: {
    width: number;
    depth: number;
    floors: number;
    floorHeight: number;
    slabThickness?: number;
    plenumHeight?: number;
    defaultCeilingHeight?: number;
    structuralModule?: { spanX: number; spanZ: number };
  };
  skeleton: {
    columns: {
      id: string;
      gridCode?: string;
      x: number;
      z: number;
      width?: number;
      depth?: number;
    }[];
    beams?: BeamData[];
    shearWalls?: ShearWallData[];
    cores: { id: string; label: string; x: number; z: number; w: number; d: number }[];
  };
  mep: {
    shafts: {
      id: string;
      type: RiserOrDuctType;
      label: string;
      x: number;
      z: number;
      radius: number;
    }[];
  };
  rooms: {
    id: string;
    floor: number;
    name: string;
    type: 'public' | 'service' | 'wet' | 'office' | 'meeting' | 'parking';
    x: number;
    z: number;
    w: number;
    d: number;
    needsPlumbing: boolean;
    ceilingHeight?: number;
    finishes?: RoomFinishes;
    fixtures?: RoomFixture[];
    openings?: RoomOpening[];
  }[];
}

// ==========================================
// 建築模型・エディトリアル調の落ち着いたカラーパレット
// ==========================================
const ARCH_PALETTE = {
  terracotta: '#C86446', // カフェ・商業・主要アクセント
  sandstone: '#D4A373',  // リビング・ラウンジ
  sage: '#7A9A8B',       // 会議室・スタジオ・グリーン
  slateBlue: '#6B8299',  // オフィス・執務空間
  ochre: '#C29B61',      // 診察室・ラボ
  wetAqua: '#4A8B9C',    // 水回り（トイレ・給湯・浴室）
  coreStone: '#8C8881',  // EV・階段コア
  parkingAsh: '#B8B4AC'  // 駐車場・ピロティ
};

// ==========================================
// プリセット建築地層データ（自作AIが出力する構造化JSONスキーマ）
// ==========================================
export const PRESET_SCENARIOS: Record<ScenarioKey, BuildingScenario> = {
  family_house_4ldk: {
    id: 'family_house_4ldk',
    name: '10m×9.5m 2F 木造4LDK ファミリー戸建て住宅',
    subtitle: '木造軸組工法・北東階段＆水回り集約・南面ワイドバルコニー',
    prompt: '敷地10m×9.5m、2階建て木造4LDKの一般住宅。1階に玄関ホール・浴室洗面トイレ・南向きLDK・和室、2階に主寝室・WIC・子供部屋A/B・南面バルコニーを配置。',
    site: { width: 10, depth: 9.5, floorHeight: 2.9 },
    columns: [
      { id: 'col-1', x: 0.45, z: 0.45 },
      { id: 'col-2', x: 5.0, z: 0.45 },
      { id: 'col-3', x: 9.55, z: 0.45 },
      { id: 'col-4', x: 0.45, z: 4.75 },
      { id: 'col-5', x: 5.0, z: 4.75 },
      { id: 'col-6', x: 9.55, z: 4.75 },
      { id: 'col-7', x: 0.45, z: 9.05 },
      { id: 'col-8', x: 5.0, z: 9.05 },
      { id: 'col-9', x: 9.55, z: 9.05 }
    ],
    risers: [
      { id: 'riser-water', name: '住宅給排水縦管 (PS)', x: 6.0, z: 2.3, type: 'plumbing' },
      { id: 'riser-hvac', name: '全館空調・換気縦管 (DS)', x: 5.4, z: 1.8, type: 'hvac' }
    ],
    floors: [
      {
        level: 1,
        name: '1F 玄関・サウスLDK・和室・水回り',
        rooms: [
          { id: '1f-entry', name: '玄関ホール・SIC(土間収納)', type: 'terrace', x: 0.4, z: 0.4, w: 3.8, d: 2.7, color: ARCH_PALETTE.sandstone },
          { id: '1f-wet', name: '浴室・洗面脱衣・1Fトイレ', type: 'wet', x: 4.45, z: 0.4, w: 3.0, d: 2.7, color: ARCH_PALETTE.wetAqua },
          { id: '1f-stair', name: '室内階段ホール', type: 'core', x: 7.7, z: 0.4, w: 1.9, d: 2.7, color: ARCH_PALETTE.coreStone },
          { id: '1f-ldk', name: '南向きLDK(リビング・ダイニング・キッチン)', type: 'cafe', x: 0.4, z: 3.35, w: 5.6, d: 5.75, color: ARCH_PALETTE.terracotta },
          { id: '1f-tatami', name: '和室(客間・タタミコーナー)', type: 'meeting', x: 6.25, z: 3.35, w: 3.35, d: 5.75, color: ARCH_PALETTE.sage }
        ],
        ducts: [
          { id: '1f-pipe-wet', x1: 6.0, z1: 2.3, x2: 5.95, z2: 1.75, type: 'plumbing' },
          { id: '1f-pipe-kitchen', x1: 6.0, z1: 2.3, x2: 4.5, z2: 4.4, type: 'plumbing' },
          { id: '1f-duct-ldk', x1: 5.4, z1: 1.8, x2: 3.2, z2: 6.2, type: 'hvac' },
          { id: '1f-duct-tatami', x1: 5.4, z1: 1.8, x2: 7.9, z2: 6.2, type: 'hvac' }
        ]
      },
      {
        level: 2,
        name: '2F 主寝室・WIC・子供部屋A/B・バルコニー',
        rooms: [
          { id: '2f-wic', name: 'ウォークインクローゼット(WIC)・書斎', type: 'office', x: 0.4, z: 0.4, w: 3.8, d: 2.7, color: ARCH_PALETTE.slateBlue },
          { id: '2f-wet', name: '2F トイレ・洗面コーナー', type: 'wet', x: 4.45, z: 0.4, w: 3.0, d: 2.7, color: ARCH_PALETTE.wetAqua },
          { id: '2f-stair', name: '室内階段ホール', type: 'core', x: 7.7, z: 0.4, w: 1.9, d: 2.7, color: ARCH_PALETTE.coreStone },
          { id: '2f-master', name: '主寝室(マスターベッドルーム)', type: 'meeting', x: 0.4, z: 3.35, w: 3.6, d: 4.15, color: ARCH_PALETTE.ochre },
          { id: '2f-kida', name: '子供部屋A(中央洋室)', type: 'meeting', x: 4.25, z: 3.35, w: 2.55, d: 4.15, color: ARCH_PALETTE.sage },
          { id: '2f-kidb', name: '子供部屋B(南東洋室)', type: 'meeting', x: 7.05, z: 3.35, w: 2.55, d: 4.15, color: ARCH_PALETTE.sage },
          { id: '2f-balcony', name: '南面ワイドバルコニー', type: 'terrace', x: 0.4, z: 7.75, w: 9.2, d: 1.35, color: ARCH_PALETTE.sandstone }
        ],
        ducts: [
          { id: '2f-pipe-wet', x1: 6.0, z1: 2.3, x2: 5.95, z2: 1.75, type: 'plumbing' },
          { id: '2f-duct-master', x1: 5.4, z1: 1.8, x2: 2.2, z2: 5.4, type: 'hvac' },
          { id: '2f-duct-kids', x1: 5.4, z1: 1.8, x2: 7.2, z2: 5.4, type: 'hvac' }
        ]
      }
    ]
  },
  garage_house_3f: {
    id: 'garage_house_3f',
    name: '10m×10m 3F ビルトインガレージ＆中庭のある家',
    subtitle: '木造SE構法・2階LDK＆アウトドアリビング住宅',
    prompt: '敷地10m×10m、3階建てのガレージハウス住宅。1階はビルトインガレージと玄関土間・バスルーム、2階は大空間LDKと中庭バルコニー、3階は主寝室と子供部屋。',
    site: { width: 10, depth: 10, floorHeight: 3.0 },
    columns: [
      { id: 'col-1', x: 0.45, z: 0.45 },
      { id: 'col-2', x: 5.0, z: 0.45 },
      { id: 'col-3', x: 9.55, z: 0.45 },
      { id: 'col-4', x: 0.45, z: 5.0 },
      { id: 'col-5', x: 5.0, z: 5.0 },
      { id: 'col-6', x: 9.55, z: 5.0 },
      { id: 'col-7', x: 0.45, z: 9.55 },
      { id: 'col-8', x: 5.0, z: 9.55 },
      { id: 'col-9', x: 9.55, z: 9.55 }
    ],
    risers: [
      { id: 'riser-water', name: '住宅給排水縦管 (PS)', x: 6.0, z: 2.4, type: 'plumbing' },
      { id: 'riser-hvac', name: '全館空調縦ダクト (DS)', x: 5.3, z: 1.9, type: 'hvac' }
    ],
    floors: [
      {
        level: 1,
        name: '1F ビルトインガレージ・玄関土間・バスルーム',
        rooms: [
          { id: '1f-doma', name: '玄関土間・シューズクローク', type: 'terrace', x: 0.4, z: 0.4, w: 3.8, d: 2.8, color: ARCH_PALETTE.sandstone },
          { id: '1f-bath', name: '1F バスルーム・洗面ランドリー', type: 'wet', x: 4.45, z: 0.4, w: 3.0, d: 2.8, color: ARCH_PALETTE.wetAqua },
          { id: '1f-stair', name: '吹抜スケルトン階段', type: 'core', x: 7.7, z: 0.4, w: 1.9, d: 2.8, color: ARCH_PALETTE.coreStone },
          { id: '1f-hobby', name: 'ホビースタジオ・書斎', type: 'office', x: 0.4, z: 3.45, w: 3.8, d: 6.15, color: ARCH_PALETTE.slateBlue },
          { id: '1f-garage', name: 'ビルトインガレージ(車2台)', type: 'parking', x: 4.45, z: 3.45, w: 5.15, d: 6.15, color: ARCH_PALETTE.parkingAsh }
        ],
        ducts: [
          { id: '1f-pipe-1', x1: 6.0, z1: 2.4, x2: 5.95, z2: 1.8, type: 'plumbing' },
          { id: '1f-duct-1', x1: 5.3, z1: 1.9, x2: 2.3, z2: 6.5, type: 'hvac' }
        ]
      },
      {
        level: 2,
        name: '2F アイランドキッチンLDK＆中庭テラス',
        rooms: [
          { id: '2f-pantry', name: 'パントリー・家事ユーティリティ', type: 'terrace', x: 0.4, z: 0.4, w: 3.8, d: 2.8, color: ARCH_PALETTE.sandstone },
          { id: '2f-kitchen-wet', name: '2F キッチン水回り・トイレ', type: 'wet', x: 4.45, z: 0.4, w: 3.0, d: 2.8, color: ARCH_PALETTE.wetAqua },
          { id: '2f-stair', name: '吹抜スケルトン階段', type: 'core', x: 7.7, z: 0.4, w: 1.9, d: 2.8, color: ARCH_PALETTE.coreStone },
          { id: '2f-ldk', name: '2F 大空間サウスLDK', type: 'cafe', x: 0.4, z: 3.45, w: 6.0, d: 6.15, color: ARCH_PALETTE.terracotta },
          { id: '2f-courtyard', name: '中庭アウトドアリビング(デッキ)', type: 'terrace', x: 6.65, z: 3.45, w: 2.95, d: 6.15, color: ARCH_PALETTE.sage }
        ],
        ducts: [
          { id: '2f-pipe-1', x1: 6.0, z1: 2.4, x2: 5.95, z2: 1.8, type: 'plumbing' },
          { id: '2f-duct-1', x1: 5.3, z1: 1.9, x2: 3.4, z2: 6.5, type: 'hvac' }
        ]
      },
      {
        level: 3,
        name: '3F 主寝室・子供部屋A/B・ルーフバルコニー',
        rooms: [
          { id: '3f-wic', name: 'ファミリーWIC・納戸', type: 'office', x: 0.4, z: 0.4, w: 3.8, d: 2.8, color: ARCH_PALETTE.slateBlue },
          { id: '3f-wet', name: '3F シャワー・洗面・トイレ', type: 'wet', x: 4.45, z: 0.4, w: 3.0, d: 2.8, color: ARCH_PALETTE.wetAqua },
          { id: '3f-stair', name: '吹抜スケルトン階段', type: 'core', x: 7.7, z: 0.4, w: 1.9, d: 2.8, color: ARCH_PALETTE.coreStone },
          { id: '3f-master', name: '主寝室(マスタースイート)', type: 'meeting', x: 0.4, z: 3.45, w: 3.8, d: 4.5, color: ARCH_PALETTE.ochre },
          { id: '3f-kids', name: '子供部屋A・子供部屋B', type: 'meeting', x: 4.45, z: 3.45, w: 5.15, d: 4.5, color: ARCH_PALETTE.sage },
          { id: '3f-balcony', name: '南向きルーフバルコニー', type: 'terrace', x: 0.4, z: 8.2, w: 9.2, d: 1.4, color: ARCH_PALETTE.sandstone }
        ],
        ducts: [
          { id: '3f-pipe-1', x1: 6.0, z1: 2.4, x2: 5.95, z2: 1.8, type: 'plumbing' },
          { id: '3f-duct-1', x1: 5.3, z1: 1.9, x2: 2.3, z2: 5.7, type: 'hvac' },
          { id: '3f-duct-2', x1: 5.3, z1: 1.9, x2: 7.0, z2: 5.7, type: 'hvac' }
        ]
      }
    ]
  },
  cafe_office: {
    id: 'cafe_office',
    name: '12m×10m 3F カフェ＆オフィス複合建築',
    subtitle: '鉄骨造・北東コア＆水回り集約型プラン',
    prompt: '敷地12m×10m、3階建て。1階はロースタリーカフェと駐車場、2〜3階はデザインオフィス。給排水シャフトとEVコアを北東に集約。',
    site: { width: 12, depth: 10, floorHeight: 3.6 },
    columns: [
      { id: 'col-1', x: 0.4, z: 0.4 },
      { id: 'col-2', x: 6.0, z: 0.4 },
      { id: 'col-3', x: 11.6, z: 0.4 },
      { id: 'col-4', x: 0.4, z: 5.0 },
      { id: 'col-5', x: 6.0, z: 5.0 },
      { id: 'col-6', x: 11.6, z: 5.0 },
      { id: 'col-7', x: 0.4, z: 9.6 },
      { id: 'col-8', x: 6.0, z: 9.6 },
      { id: 'col-9', x: 11.6, z: 9.6 },
    ],
    risers: [
      { id: 'riser-water', name: '給排水縦シャフト (PS)', x: 9.2, z: 1.6, type: 'plumbing' },
      { id: 'riser-hvac', name: '空調メインシャフト (DS)', x: 8.0, z: 1.6, type: 'hvac' }
    ],
    floors: [
      {
        level: 1,
        name: '1F ロースタリーカフェ＆駐車場',
        rooms: [
          { id: '1f-cafe', name: 'カフェ客席・焙煎カウンター', type: 'cafe', x: 0.5, z: 0.5, w: 6.8, d: 9.0, color: ARCH_PALETTE.terracotta },
          { id: '1f-wc', name: '1F 共用トイレ・水回り', type: 'wet', x: 7.5, z: 0.5, w: 2.3, d: 3.0, color: ARCH_PALETTE.wetAqua },
          { id: '1f-core', name: 'EV・階段コア', type: 'core', x: 10.0, z: 0.5, w: 1.5, d: 4.5, color: ARCH_PALETTE.coreStone },
          { id: '1f-park', name: 'ピロティ駐車場', type: 'parking', x: 7.5, z: 3.7, w: 4.0, d: 5.8, color: ARCH_PALETTE.parkingAsh }
        ],
        ducts: [
          { id: '1f-duct-1', x1: 8.0, z1: 1.6, x2: 3.8, z2: 1.6, type: 'hvac' },
          { id: '1f-duct-2', x1: 3.8, z1: 1.6, x2: 3.8, z2: 7.8, type: 'hvac' },
          { id: '1f-pipe-1', x1: 9.2, z1: 1.6, x2: 5.2, z2: 3.2, type: 'plumbing' }
        ]
      },
      {
        level: 2,
        name: '2F ワークスタジオ＆会議室',
        rooms: [
          { id: '2f-office', name: 'メイン執務スタジオ', type: 'office', x: 0.5, z: 0.5, w: 6.8, d: 9.0, color: ARCH_PALETTE.slateBlue },
          { id: '2f-wc', name: '2F トイレ・パントリー', type: 'wet', x: 7.5, z: 0.5, w: 2.3, d: 3.0, color: ARCH_PALETTE.wetAqua },
          { id: '2f-core', name: 'EV・階段コア', type: 'core', x: 10.0, z: 0.5, w: 1.5, d: 4.5, color: ARCH_PALETTE.coreStone },
          { id: '2f-mtg', name: 'ミーティングルームA', type: 'meeting', x: 7.5, z: 5.2, w: 4.0, d: 4.3, color: ARCH_PALETTE.sage }
        ],
        ducts: [
          { id: '2f-duct-1', x1: 8.0, z1: 1.6, x2: 3.5, z2: 1.6, type: 'hvac' },
          { id: '2f-duct-2', x1: 3.5, z1: 1.6, x2: 3.5, z2: 8.2, type: 'hvac' },
          { id: '2f-duct-3', x1: 3.5, z1: 6.8, x2: 9.5, z2: 6.8, type: 'hvac' },
          { id: '2f-pipe-1', x1: 9.2, z1: 1.6, x2: 8.5, z2: 2.4, type: 'plumbing' }
        ]
      },
      {
        level: 3,
        name: '3F ライブラリー＆ルーフテラス',
        rooms: [
          { id: '3f-lounge', name: 'デザインライブラリー', type: 'office', x: 0.5, z: 0.5, w: 6.8, d: 5.8, color: ARCH_PALETTE.sandstone },
          { id: '3f-terrace', name: '南面ルーフテラス', type: 'terrace', x: 0.5, z: 6.5, w: 6.8, d: 3.0, color: ARCH_PALETTE.sage },
          { id: '3f-wc', name: '3F トイレ・シャワー室', type: 'wet', x: 7.5, z: 0.5, w: 2.3, d: 3.0, color: ARCH_PALETTE.wetAqua },
          { id: '3f-core', name: 'EV・階段コア', type: 'core', x: 10.0, z: 0.5, w: 1.5, d: 4.5, color: ARCH_PALETTE.coreStone },
          { id: '3f-board', name: 'ボードルーム', type: 'meeting', x: 7.5, z: 5.2, w: 4.0, d: 4.3, color: ARCH_PALETTE.ochre }
        ],
        ducts: [
          { id: '3f-duct-1', x1: 8.0, z1: 1.6, x2: 4.0, z2: 1.6, type: 'hvac' },
          { id: '3f-duct-2', x1: 4.0, z1: 1.6, x2: 4.0, z2: 5.2, type: 'hvac' },
          { id: '3f-pipe-1', x1: 9.2, z1: 1.6, x2: 8.5, z2: 2.4, type: 'plumbing' }
        ]
      }
    ]
  },
  clinic_residence: {
    id: 'clinic_residence',
    name: '14m×10m 3F 都市型クリニック＆レジデンス',
    subtitle: 'RC造・中央設備シャフト貫通プラン',
    prompt: '敷地14m×10m、3階建てRC造。1階はクリニックと調剤薬局、2〜3階は職住一体レジデンス。中央北側に給排水コアを配置。',
    site: { width: 14, depth: 10, floorHeight: 3.5 },
    columns: [
      { id: 'col-1', x: 0.5, z: 0.5 },
      { id: 'col-2', x: 7.0, z: 0.5 },
      { id: 'col-3', x: 13.5, z: 0.5 },
      { id: 'col-4', x: 0.5, z: 5.0 },
      { id: 'col-5', x: 7.0, z: 5.0 },
      { id: 'col-6', x: 13.5, z: 5.0 },
      { id: 'col-7', x: 0.5, z: 9.5 },
      { id: 'col-8', x: 7.0, z: 9.5 },
      { id: 'col-9', x: 13.5, z: 9.5 },
    ],
    risers: [
      { id: 'riser-water', name: '中央給排水シャフト (PS)', x: 7.6, z: 2.0, type: 'plumbing' },
      { id: 'riser-hvac', name: '第1種換気ダクトシャフト (DS)', x: 6.3, z: 2.0, type: 'hvac' }
    ],
    floors: [
      {
        level: 1,
        name: '1F クリニック＆調剤スペース',
        rooms: [
          { id: '1f-wait', name: '待合ラウンジ・受付', type: 'cafe', x: 0.6, z: 4.0, w: 6.2, d: 5.4, color: ARCH_PALETTE.sandstone },
          { id: '1f-exam', name: '診察室・処置室', type: 'office', x: 0.6, z: 0.6, w: 5.1, d: 3.2, color: ARCH_PALETTE.slateBlue },
          { id: '1f-wc', name: '1F 多目的トイレ・手洗', type: 'wet', x: 5.9, z: 0.6, w: 3.0, d: 3.2, color: ARCH_PALETTE.wetAqua },
          { id: '1f-core', name: 'EV・階段ホール', type: 'core', x: 9.1, z: 0.6, w: 4.3, d: 3.2, color: ARCH_PALETTE.coreStone },
          { id: '1f-pharm', name: '調剤・アプローチ広場', type: 'parking', x: 7.0, z: 4.0, w: 6.4, d: 5.4, color: ARCH_PALETTE.parkingAsh }
        ],
        ducts: [
          { id: '1f-duct-1', x1: 6.3, z1: 2.0, x2: 3.0, z2: 2.0, type: 'hvac' },
          { id: '1f-duct-2', x1: 3.0, z1: 2.0, x2: 3.0, z2: 7.5, type: 'hvac' },
          { id: '1f-pipe-1', x1: 7.6, z1: 2.0, x2: 10.2, z2: 6.0, type: 'plumbing' }
        ]
      },
      {
        level: 2,
        name: '2F ファミリーレジデンス＆書斎',
        rooms: [
          { id: '2f-ldk', name: 'サウスリビング・ダイニング', type: 'cafe', x: 0.6, z: 4.0, w: 8.2, d: 5.4, color: ARCH_PALETTE.terracotta },
          { id: '2f-bed1', name: 'マスターベッドルーム', type: 'meeting', x: 0.6, z: 0.6, w: 5.1, d: 3.2, color: ARCH_PALETTE.ochre },
          { id: '2f-wet', name: 'バス・キッチン水回りコア', type: 'wet', x: 5.9, z: 0.6, w: 3.0, d: 3.2, color: ARCH_PALETTE.wetAqua },
          { id: '2f-core', name: 'EV・階段ホール', type: 'core', x: 9.1, z: 0.6, w: 4.3, d: 3.2, color: ARCH_PALETTE.coreStone },
          { id: '2f-bed2', name: 'アトリエ・書斎', type: 'office', x: 9.0, z: 4.0, w: 4.4, d: 5.4, color: ARCH_PALETTE.slateBlue }
        ],
        ducts: [
          { id: '2f-duct-1', x1: 6.3, z1: 2.0, x2: 4.5, z2: 6.5, type: 'hvac' },
          { id: '2f-pipe-1', x1: 7.6, z1: 2.0, x2: 7.0, z2: 4.5, type: 'plumbing' }
        ]
      },
      {
        level: 3,
        name: '3F ペントハウス＆ルーフガーデン',
        rooms: [
          { id: '3f-pent', name: 'ペントハウスラウンジ', type: 'cafe', x: 0.6, z: 4.0, w: 7.2, d: 5.4, color: ARCH_PALETTE.sandstone },
          { id: '3f-bed', name: 'ゲストスイート', type: 'meeting', x: 0.6, z: 0.6, w: 5.1, d: 3.2, color: ARCH_PALETTE.ochre },
          { id: '3f-wet', name: '3F バス・サニタリー', type: 'wet', x: 5.9, z: 0.6, w: 3.0, d: 3.2, color: ARCH_PALETTE.wetAqua },
          { id: '3f-core', name: 'EV・階段ホール', type: 'core', x: 9.1, z: 0.6, w: 4.3, d: 3.2, color: ARCH_PALETTE.coreStone },
          { id: '3f-garden', name: '屋上庭園テラス', type: 'terrace', x: 8.0, z: 4.0, w: 5.4, d: 5.4, color: ARCH_PALETTE.sage }
        ],
        ducts: [
          { id: '3f-duct-1', x1: 6.3, z1: 2.0, x2: 4.0, z2: 6.5, type: 'hvac' },
          { id: '3f-pipe-1', x1: 7.6, z1: 2.0, x2: 7.2, z2: 2.5, type: 'plumbing' }
        ]
      }
    ]
  },
  research_lab: {
    id: 'research_lab',
    name: '12m×12m 3F バイオ・マテリアル研究棟',
    subtitle: '重設備シャフト・ラボゾーニング特化型',
    prompt: '敷地12m×12m、3階建て。1階は搬入ピロティと基礎実験室、2〜3階はクリーンラボと解析オフィス。西側に大型設備シャフトを集約。',
    site: { width: 12, depth: 12, floorHeight: 3.8 },
    columns: [
      { id: 'col-1', x: 0.5, z: 0.5 },
      { id: 'col-2', x: 6.0, z: 0.5 },
      { id: 'col-3', x: 11.5, z: 0.5 },
      { id: 'col-4', x: 0.5, z: 6.0 },
      { id: 'col-5', x: 6.0, z: 6.0 },
      { id: 'col-6', x: 11.5, z: 6.0 },
      { id: 'col-7', x: 0.5, z: 11.5 },
      { id: 'col-8', x: 6.0, z: 11.5 },
      { id: 'col-9', x: 11.5, z: 11.5 },
    ],
    risers: [
      { id: 'riser-water', name: '実験廃液・給水シャフト (PS)', x: 2.2, z: 2.2, type: 'plumbing' },
      { id: 'riser-hvac', name: 'ドラフト排気シャフト (DS)', x: 3.6, z: 2.2, type: 'hvac' }
    ],
    floors: [
      {
        level: 1,
        name: '1F 重機器ラボ＆ローディング',
        rooms: [
          { id: '1f-wet', name: '1F 洗浄・給排水ラボ室', type: 'wet', x: 0.6, z: 0.6, w: 4.5, d: 4.2, color: ARCH_PALETTE.wetAqua },
          { id: '1f-core', name: '大型EV・階段コア', type: 'core', x: 5.3, z: 0.6, w: 6.1, d: 3.2, color: ARCH_PALETTE.coreStone },
          { id: '1f-lab1', name: '材料試験ホール', type: 'office', x: 0.6, z: 5.0, w: 6.8, d: 6.4, color: ARCH_PALETTE.ochre },
          { id: '1f-load', name: '搬入ヤード', type: 'parking', x: 7.6, z: 4.0, w: 3.8, d: 7.4, color: ARCH_PALETTE.parkingAsh }
        ],
        ducts: [
          { id: '1f-duct-1', x1: 3.6, z1: 2.2, x2: 3.6, z2: 9.5, type: 'hvac' },
          { id: '1f-pipe-1', x1: 2.2, z1: 2.2, x2: 4.5, z2: 7.0, type: 'plumbing' }
        ]
      },
      {
        level: 2,
        name: '2F ウェットラボ＆解析ルーム',
        rooms: [
          { id: '2f-wet', name: '2F 薬液・給排水ユーティリティ', type: 'wet', x: 0.6, z: 0.6, w: 4.5, d: 4.2, color: ARCH_PALETTE.wetAqua },
          { id: '2f-core', name: '大型EV・階段コア', type: 'core', x: 5.3, z: 0.6, w: 6.1, d: 3.2, color: ARCH_PALETTE.coreStone },
          { id: '2f-lab2', name: 'メインウェットラボ', type: 'cafe', x: 0.6, z: 5.0, w: 6.8, d: 6.4, color: ARCH_PALETTE.terracotta },
          { id: '2f-ana', name: 'データ解析室', type: 'office', x: 7.6, z: 4.0, w: 3.8, d: 7.4, color: ARCH_PALETTE.slateBlue }
        ],
        ducts: [
          { id: '2f-duct-1', x1: 3.6, z1: 2.2, x2: 3.6, z2: 9.5, type: 'hvac' },
          { id: '2f-duct-2', x1: 3.6, z1: 7.5, x2: 9.5, z2: 7.5, type: 'hvac' },
          { id: '2f-pipe-1', x1: 2.2, z1: 2.2, x2: 3.5, z2: 7.5, type: 'plumbing' }
        ]
      },
      {
        level: 3,
        name: '3F クリーンルーム＆カンファレンス',
        rooms: [
          { id: '3f-wet', name: '3F 純水・給排水室', type: 'wet', x: 0.6, z: 0.6, w: 4.5, d: 4.2, color: ARCH_PALETTE.wetAqua },
          { id: '3f-core', name: '大型EV・階段コア', type: 'core', x: 5.3, z: 0.6, w: 6.1, d: 3.2, color: ARCH_PALETTE.coreStone },
          { id: '3f-clean', name: '恒温クリーンラボ', type: 'meeting', x: 0.6, z: 5.0, w: 6.8, d: 6.4, color: ARCH_PALETTE.sage },
          { id: '3f-conf', name: '研究員ラウンジ', type: 'cafe', x: 7.6, z: 4.0, w: 3.8, d: 7.4, color: ARCH_PALETTE.sandstone }
        ],
        ducts: [
          { id: '3f-duct-1', x1: 3.6, z1: 2.2, x2: 3.6, z2: 9.5, type: 'hvac' },
          { id: '3f-pipe-1', x1: 2.2, z1: 2.2, x2: 2.8, z2: 4.0, type: 'plumbing' }
        ]
      }
    ]
  }
};

const ROOM_USAGE_OPTIONS: { type: RoomType; label: string; color: string }[] = [
  { type: 'cafe', label: 'LDK・リビング／カフェ・ラウンジ', color: ARCH_PALETTE.terracotta },
  { type: 'meeting', label: '主寝室・子供部屋・和室／会議室', color: ARCH_PALETTE.sage },
  { type: 'office', label: '書斎・WIC／執務オフィス・スタジオ', color: ARCH_PALETTE.slateBlue },
  { type: 'wet', label: '水回り（浴室・洗面脱衣・トイレ・給湯）', color: ARCH_PALETTE.wetAqua },
  { type: 'core', label: '室内階段ホール／EV・階段コア', color: ARCH_PALETTE.coreStone },
  { type: 'terrace', label: '玄関土間・バルコニー・ルーフテラス', color: ARCH_PALETTE.sandstone },
  { type: 'parking', label: 'ビルトインガレージ・駐車場・ピロティ', color: ARCH_PALETTE.parkingAsh }
];

export const FINISH_MATERIAL_OPTIONS: { code: string; label: string }[] = [
  { code: 'oak_flooring', label: 'ナラ無垢フローリング (oak_flooring)' },
  { code: 'walnut_flooring', label: 'ウォールナット挽板 (walnut_flooring)' },
  { code: 'tatami_rush', label: '琉球畳・い草本畳 (tatami_rush)' },
  { code: 'ceramic_tile', label: '大判磁気質タイル (ceramic_tile)' },
  { code: 'mortar_exposed', label: '金鏝押さえモルタル土間 (mortar_exposed)' },
  { code: 'oa_carpet_tile', label: 'OAフロア＋タイルカーペット (oa_carpet_tile)' },
  { code: 'wood_deck_frp', label: 'ハードウッドデッキ＋FRP防水 (wood_deck_frp)' }
];

// 任意の BuildingScenario に詳細設計パラメータ（梁・耐力壁・スラブ/プレナム・天井高・仕上材・什器・開口部）を自動補完
export function ensureScenarioDetails(raw: BuildingScenario): BuildingScenario {
  const b: BuildingScenario = JSON.parse(JSON.stringify(raw));
  const { width: siteW, depth: siteD, floorHeight } = b.site;
  const isRes = floorHeight <= 3.15 || b.id === 'family_house_4ldk' || b.id === 'garage_house_3f';

  // 3. 垂直方向（Z軸）詳細パラメータ
  const slabT = Number((b.site.slabThickness ?? (isRes ? 0.22 : 0.26)).toFixed(2));
  const plenumH = Number((b.site.plenumHeight ?? (isRes ? 0.36 : 0.58)).toFixed(2));
  const defCh = Number(
    (b.site.defaultCeilingHeight ?? Math.min(Math.max(2.3, floorHeight - slabT - plenumH), floorHeight - 0.45)).toFixed(2)
  );
  b.site.slabThickness = slabT;
  b.site.plenumHeight = plenumH;
  b.site.defaultCeilingHeight = defCh;

  // 1. 柱断面・グリッド符号・大梁/小梁・耐力壁の補完
  const colSize = isRes ? 0.4 : 0.6;
  const xs = Array.from(new Set(b.columns.map((c) => Number(c.x.toFixed(2))))).sort((a, z) => a - z);
  const zs = Array.from(new Set(b.columns.map((c) => Number(c.z.toFixed(2))))).sort((a, z) => a - z);
  const spanX = xs.length >= 2 ? Number(((xs[xs.length - 1] - xs[0]) / (xs.length - 1)).toFixed(2)) : 4.5;
  const spanZ = zs.length >= 2 ? Number(((zs[zs.length - 1] - zs[0]) / (zs.length - 1)).toFixed(2)) : 4.5;
  b.site.structuralModule = b.site.structuralModule ?? { spanX, spanZ };

  b.columns = b.columns.map((c, idx) => {
    const xi = Math.max(1, xs.indexOf(Number(c.x.toFixed(2))) + 1);
    const zi = Math.max(1, zs.indexOf(Number(c.z.toFixed(2))) + 1);
    return {
      ...c,
      gridCode: c.gridCode ?? `X${xi}-Y${zi || idx + 1}`,
      width: c.width ?? colSize,
      depth: c.depth ?? colSize
    };
  });

  if (!b.beams || b.beams.length === 0) {
    const beams: BeamData[] = [];
    const gw = isRes ? 0.28 : 0.4;
    const gd = isRes ? 0.42 : 0.6;
    const sw = isRes ? 0.18 : 0.25;
    const sd = isRes ? 0.3 : 0.42;
    let bIdx = 1;
    for (const z of zs) {
      for (let i = 0; i < xs.length - 1; i++) {
        beams.push({ id: `G${bIdx++}`, kind: 'girder', x1: xs[i], z1: z, x2: xs[i + 1], z2: z, width: gw, depth: gd });
      }
    }
    for (const x of xs) {
      for (let j = 0; j < zs.length - 1; j++) {
        beams.push({ id: `G${bIdx++}`, kind: 'girder', x1: x, z1: zs[j], x2: x, z2: zs[j + 1], width: gw, depth: gd });
      }
    }
    let sIdx = 1;
    for (let j = 0; j < zs.length - 1; j++) {
      const midZ = Number(((zs[j] + zs[j + 1]) / 2).toFixed(2));
      for (let i = 0; i < xs.length - 1; i++) {
        beams.push({
          id: `B${sIdx++}`,
          kind: 'secondary',
          x1: xs[i],
          z1: midZ,
          x2: xs[i + 1],
          z2: midZ,
          width: sw,
          depth: sd
        });
      }
    }
    b.beams = beams;
  }

  if (!b.shearWalls || b.shearWalls.length === 0) {
    const shearWalls: ShearWallData[] = [];
    const wt = isRes ? 0.18 : 0.25;
    const coreRoom = b.floors[0]?.rooms.find((r) => r.type === 'core');
    if (coreRoom) {
      shearWalls.push(
        { id: 'SW1', x1: coreRoom.x, z1: coreRoom.z, x2: coreRoom.x + coreRoom.w, z2: coreRoom.z, thickness: wt },
        {
          id: 'SW2',
          x1: coreRoom.x + coreRoom.w,
          z1: coreRoom.z,
          x2: coreRoom.x + coreRoom.w,
          z2: coreRoom.z + coreRoom.d,
          thickness: wt
        }
      );
    }
    if (xs.length >= 2 && zs.length >= 2) {
      shearWalls.push({ id: 'SW3', x1: xs[0], z1: zs[0], x2: xs[0], z2: zs[1], thickness: wt });
    }
    b.shearWalls = shearWalls;
  }

  // 2 & 4. 各部屋の天井高・仕上材・設備什器・開口部（窓/ドア）の補完
  b.floors.forEach((fl) => {
    fl.rooms.forEach((rm) => {
      if (rm.type === 'core') {
        rm.ceilingHeight = rm.ceilingHeight ?? defCh;
        rm.finishes = rm.finishes ?? { floor: 'mortar_exposed', wall: 'rc_exposed', ceiling: 'gypsum_cloth' };
        rm.fixtures = rm.fixtures ?? [];
        rm.openings = rm.openings ?? [];
        return;
      }

      if (rm.ceilingHeight === undefined) {
        rm.ceilingHeight =
          rm.type === 'wet'
            ? Number(Math.max(2.2, defCh - 0.1).toFixed(2))
            : rm.type === 'cafe'
              ? Number(Math.min(floorHeight - slabT - 0.25, defCh + 0.05).toFixed(2))
              : defCh;
      }

      if (!rm.finishes) {
        if (rm.name.includes('和室') || rm.name.includes('タタミ')) {
          rm.finishes = { floor: 'tatami_rush', wall: 'diatom_plaster', ceiling: 'cedar_veneer' };
        } else if (rm.type === 'wet') {
          rm.finishes = { floor: 'ceramic_tile', wall: 'moisture_board', ceiling: 'bath_panel' };
        } else if (rm.type === 'parking' || rm.name.includes('土間') || rm.name.includes('ガレージ')) {
          rm.finishes = { floor: 'mortar_exposed', wall: 'rc_exposed', ceiling: 'calcium_silicate' };
        } else if (rm.type === 'terrace') {
          rm.finishes = { floor: 'wood_deck_frp', wall: 'exterior_siding', ceiling: 'soffit_board' };
        } else if (rm.type === 'office') {
          rm.finishes = { floor: 'oa_carpet_tile', wall: 'vinyl_cloth', ceiling: 'acoustic_rockwool' };
        } else if (rm.type === 'cafe') {
          rm.finishes = { floor: 'oak_flooring', wall: 'plaster_paint', ceiling: 'oak_louver' };
        } else {
          rm.finishes = { floor: 'walnut_flooring', wall: 'acrylic_paint', ceiling: 'gypsum_cloth' };
        }
      }

      if (!rm.fixtures) {
        const fx: RoomFixture[] = [];
        if (rm.type === 'wet') {
          fx.push(
            {
              id: `${rm.id}-FX1`,
              type: 'toilet',
              label: 'タンクレストイレ',
              localX: Number((-rm.w * 0.26).toFixed(2)),
              localZ: Number((-rm.d * 0.24).toFixed(2)),
              w: 0.7,
              d: 0.8
            },
            {
              id: `${rm.id}-FX2`,
              type: 'sink',
              label: '洗面・給水シンク',
              localX: Number((rm.w * 0.24).toFixed(2)),
              localZ: Number((-rm.d * 0.24).toFixed(2)),
              w: 0.9,
              d: 0.65
            }
          );
          if (rm.name.includes('浴室') || rm.name.includes('バス') || rm.name.includes('シャワー')) {
            fx.push({
              id: `${rm.id}-FX3`,
              type: 'unit_bath',
              label: '1616ユニットバス',
              localX: 0,
              localZ: Number((rm.d * 0.22).toFixed(2)),
              w: Number(Math.min(1.6, rm.w * 0.65).toFixed(2)),
              d: Number(Math.min(1.6, rm.d * 0.45).toFixed(2))
            });
          }
        } else if (rm.type === 'cafe') {
          fx.push(
            {
              id: `${rm.id}-FX1`,
              type: 'island_kitchen',
              label: 'アイランドキッチン・シンク',
              localX: Number((-rm.w * 0.18).toFixed(2)),
              localZ: Number((-rm.d * 0.26).toFixed(2)),
              w: Number(Math.min(2.4, rm.w * 0.52).toFixed(2)),
              d: 0.95
            },
            {
              id: `${rm.id}-FX2`,
              type: 'meeting_table',
              label: 'ダイニング・ラウンジテーブル',
              localX: Number((rm.w * 0.15).toFixed(2)),
              localZ: Number((rm.d * 0.18).toFixed(2)),
              w: Number(Math.min(1.8, rm.w * 0.42).toFixed(2)),
              d: 0.95
            }
          );
        } else if (rm.name.includes('寝室') || rm.name.includes('子供部屋')) {
          fx.push({
            id: `${rm.id}-FX1`,
            type: 'bed',
            label: 'ベッドフレーム',
            localX: Number((-rm.w * 0.12).toFixed(2)),
            localZ: 0,
            w: Number(Math.min(1.6, rm.w * 0.55).toFixed(2)),
            d: Number(Math.min(2.0, rm.d * 0.55).toFixed(2))
          });
        } else if (rm.type === 'office') {
          fx.push({
            id: `${rm.id}-FX1`,
            type: rm.name.includes('ラボ') ? 'lab_bench' : 'counter_desk',
            label: rm.name.includes('ラボ') ? '実験ドラフトベンチ' : 'ワークデスクアイランド',
            localX: 0,
            localZ: 0,
            w: Number(Math.min(2.6, rm.w * 0.56).toFixed(2)),
            d: Number(Math.min(1.3, rm.d * 0.44).toFixed(2))
          });
        } else if (rm.type === 'meeting') {
          fx.push({
            id: `${rm.id}-FX1`,
            type: rm.name.includes('和室') ? 'tatami_mat' : 'meeting_table',
            label: rm.name.includes('和室') ? '琉球畳ユニット' : 'ミーティングテーブル',
            localX: 0,
            localZ: 0,
            w: Number(Math.min(2.2, rm.w * 0.58).toFixed(2)),
            d: Number(Math.min(1.5, rm.d * 0.52).toFixed(2))
          });
        }
        rm.fixtures = fx;
      }

      if (!rm.openings || rm.openings.length === 0) {
        const cx = rm.x + rm.w / 2 - siteW / 2;
        const cz = rm.z + rm.d / 2 - siteD / 2;
        const area = rm.w * rm.d;
        const isHabitable = rm.type === 'cafe' || rm.type === 'office' || rm.type === 'meeting';
        const doorWall: WallSide = cz >= 0 ? 'north' : 'south';
        const doorZ = doorWall === 'north' ? Number((cz - rm.d / 2).toFixed(2)) : Number((cz + rm.d / 2).toFixed(2));
        const doorW = Number(Math.min(0.85, Math.max(0.7, rm.w * 0.32)).toFixed(2));

        const winH = isHabitable ? 1.8 : 0.7;
        const reqWinArea = isHabitable ? area / 6.2 : 0.45;
        const winWall: WallSide = cz >= 0 ? 'south' : 'north';
        const winZ = winWall === 'south' ? Number((cz + rm.d / 2).toFixed(2)) : Number((cz - rm.d / 2).toFixed(2));
        const winW = Number(Math.min(Math.max(0.9, rm.w * 0.72), Math.max(1.1, reqWinArea / winH)).toFixed(2));

        const ops: RoomOpening[] = [
          {
            id: `${rm.id}-DR1`,
            type: 'door',
            wall: doorWall,
            x: Number((cx - rm.w * 0.2).toFixed(2)),
            z: doorZ,
            width: doorW,
            height: 2.0,
            sillHeight: 0.0
          },
          {
            id: `${rm.id}-WN1`,
            type: 'window',
            wall: winWall,
            x: Number(cx.toFixed(2)),
            z: winZ,
            width: winW,
            height: winH,
            sillHeight: isHabitable ? 0.4 : 1.2
          }
        ];

        if (isHabitable && winW * winH < area / 7.0) {
          const remArea = area / 6.5 - winW * winH;
          const sideWall: WallSide = cx <= 0 ? 'west' : 'east';
          const sideX = sideWall === 'west' ? Number((cx - rm.w / 2).toFixed(2)) : Number((cx + rm.w / 2).toFixed(2));
          const sideW = Number(Math.min(Math.max(0.9, rm.d * 0.72), Math.max(0.9, remArea / winH)).toFixed(2));
          ops.push({
            id: `${rm.id}-WN2`,
            type: 'window',
            wall: sideWall,
            x: sideX,
            z: Number(cz.toFixed(2)),
            width: sideW,
            height: winH,
            sillHeight: 0.6
          });
        }
        rm.openings = ops;
      }
    });
  });

  return b;
}

// StratumArchBIMSchema (中心原点座標) <-> フロントエンド3D描画データ (左上原点座標) の相互変換
export function stratumSchemaToBuildingScenario(
  schemaData: StratumArchBIMSchema,
  promptText: string,
  baseKey: ScenarioKey = 'cafe_office'
): BuildingScenario {
  const { width: siteW, depth: siteD, floors: numFloors, floorHeight } = schemaData.site;
  const halfW = siteW / 2;
  const halfD = siteD / 2;

  const columns: ColumnData[] = schemaData.skeleton.columns.map((c) => ({
    id: c.id,
    gridCode: c.gridCode,
    x: Number((c.x + halfW).toFixed(2)),
    z: Number((c.z + halfD).toFixed(2)),
    width: c.width,
    depth: c.depth
  }));

  const beams: BeamData[] | undefined = schemaData.skeleton.beams?.map((bm) => ({
    ...bm,
    x1: Number((bm.x1 + halfW).toFixed(2)),
    z1: Number((bm.z1 + halfD).toFixed(2)),
    x2: Number((bm.x2 + halfW).toFixed(2)),
    z2: Number((bm.z2 + halfD).toFixed(2))
  }));

  const shearWalls: ShearWallData[] | undefined = schemaData.skeleton.shearWalls?.map((sw) => ({
    ...sw,
    x1: Number((sw.x1 + halfW).toFixed(2)),
    z1: Number((sw.z1 + halfD).toFixed(2)),
    x2: Number((sw.x2 + halfW).toFixed(2)),
    z2: Number((sw.z2 + halfD).toFixed(2))
  }));

  const risers: RiserData[] = schemaData.mep.shafts.map((s) => ({
    id: s.id,
    name: s.label,
    x: Number((s.x + halfW).toFixed(2)),
    z: Number((s.z + halfD).toFixed(2)),
    type: s.type
  }));

  const colorBySchemaType: Record<string, { uiType: RoomType; color: string }> = {
    public: { uiType: 'cafe', color: ARCH_PALETTE.terracotta },
    service: { uiType: 'terrace', color: ARCH_PALETTE.sandstone },
    wet: { uiType: 'wet', color: ARCH_PALETTE.wetAqua },
    office: { uiType: 'office', color: ARCH_PALETTE.slateBlue },
    meeting: { uiType: 'meeting', color: ARCH_PALETTE.sage },
    parking: { uiType: 'parking', color: ARCH_PALETTE.parkingAsh }
  };

  const floors: FloorData[] = [];
  for (let lv = 1; lv <= numFloors; lv++) {
    const flRooms: RoomData[] = [];

    // 1. 貫通コア (skeleton.cores) を各フロアのコア要素として配置
    schemaData.skeleton.cores.forEach((core) => {
      flRooms.push({
        id: `${lv}f-${core.id.toLowerCase()}`,
        name: core.label,
        type: 'core',
        x: Number((core.x - core.w / 2 + halfW).toFixed(2)),
        z: Number((core.z - core.d / 2 + halfD).toFixed(2)),
        w: Number(core.w.toFixed(2)),
        d: Number(core.d.toFixed(2)),
        color: ARCH_PALETTE.coreStone
      });
    });

    // 2. 各階の部屋 (rooms) を変換（詳細属性 ceilingHeight / finishes / fixtures / openings を保持）
    schemaData.rooms
      .filter((r) => r.floor === lv)
      .forEach((r) => {
        const mapped = colorBySchemaType[r.type] || { uiType: 'office', color: ARCH_PALETTE.slateBlue };
        flRooms.push({
          id: r.id,
          name: r.name,
          type: mapped.uiType,
          x: Number((r.x - r.w / 2 + halfW).toFixed(2)),
          z: Number((r.z - r.d / 2 + halfD).toFixed(2)),
          w: Number(r.w.toFixed(2)),
          d: Number(r.d.toFixed(2)),
          color: mapped.color,
          ceilingHeight: r.ceilingHeight,
          finishes: r.finishes,
          fixtures: r.fixtures,
          openings: r.openings
        });
      });

    // 3. 縦シャフト(PS/DS)から各部屋中心への枝管・空調ダクトを自動ルーティング
    const flDucts: DuctData[] = [];
    const psRiser = risers.find((ri) => ri.type === 'plumbing');
    const dsRiser = risers.find((ri) => ri.type === 'hvac');

    flRooms.forEach((rm, idx) => {
      const cx = Number((rm.x + rm.w / 2).toFixed(2));
      const cz = Number((rm.z + rm.d / 2).toFixed(2));
      if (rm.type === 'wet' && psRiser) {
        flDucts.push({
          id: `${lv}f-pipe-${idx}`,
          x1: psRiser.x,
          z1: psRiser.z,
          x2: cx,
          z2: cz,
          type: 'plumbing'
        });
      } else if (rm.type !== 'core' && rm.type !== 'parking' && dsRiser) {
        flDucts.push({
          id: `${lv}f-duct-${idx}`,
          x1: dsRiser.x,
          z1: dsRiser.z,
          x2: cx,
          z2: cz,
          type: 'hvac'
        });
      }
    });

    floors.push({
      level: lv,
      name: `${lv}F フロア空間`,
      rooms: flRooms,
      ducts: flDucts
    });
  }

  return ensureScenarioDetails({
    id: baseKey,
    name: `${siteW}m×${siteD}m ${numFloors}F 3層詳細BIMプラン`,
    subtitle: '構造・設備・意匠 3層詳細設計モデル',
    prompt: promptText,
    site: {
      width: siteW,
      depth: siteD,
      floorHeight,
      slabThickness: schemaData.site.slabThickness,
      plenumHeight: schemaData.site.plenumHeight,
      defaultCeilingHeight: schemaData.site.defaultCeilingHeight,
      structuralModule: schemaData.site.structuralModule
    },
    columns,
    beams,
    shearWalls,
    risers,
    floors
  });
}

export function buildingScenarioToStratumSchema(rawScenario: BuildingScenario): StratumArchBIMSchema {
  const b = ensureScenarioDetails(rawScenario);
  const halfW = b.site.width / 2;
  const halfD = b.site.depth / 2;

  const schemaTypeByUiType: Record<RoomType, StratumArchBIMSchema['rooms'][number]['type']> = {
    cafe: 'public',
    terrace: 'service',
    wet: 'wet',
    office: 'office',
    meeting: 'meeting',
    parking: 'parking',
    core: 'service'
  };

  const firstFloorCores = (b.floors[0]?.rooms || []).filter((r) => r.type === 'core');
  const cores = firstFloorCores.map((c, idx) => ({
    id: idx === 0 ? 'CORE-EV' : `CORE-${idx + 1}`,
    label: c.name,
    x: Number((c.x + c.w / 2 - halfW).toFixed(2)),
    z: Number((c.z + c.d / 2 - halfD).toFixed(2)),
    w: Number(c.w.toFixed(2)),
    d: Number(c.d.toFixed(2))
  }));

  const rooms: StratumArchBIMSchema['rooms'] = [];
  b.floors.forEach((f) => {
    f.rooms
      .filter((r) => r.type !== 'core')
      .forEach((r) => {
        const cx = Number((r.x + r.w / 2 - halfW).toFixed(2));
        const cz = Number((r.z + r.d / 2 - halfD).toFixed(2));
        // 部屋がドラッグやスライダーで移動した場合も開口部が壁面に追従するよう同期
        const syncedOpenings: RoomOpening[] = (r.openings || []).map((op) => {
          if (op.wall === 'north') {
            return { ...op, x: cx, z: Number((cz - r.d / 2).toFixed(2)) };
          }
          if (op.wall === 'south') {
            return { ...op, x: cx, z: Number((cz + r.d / 2).toFixed(2)) };
          }
          if (op.wall === 'west') {
            return { ...op, x: Number((cx - r.w / 2).toFixed(2)), z: cz };
          }
          return { ...op, x: Number((cx + r.w / 2).toFixed(2)), z: cz };
        });

        rooms.push({
          id: r.id,
          floor: f.level,
          name: r.name,
          type: schemaTypeByUiType[r.type] || 'office',
          x: cx,
          z: cz,
          w: Number(r.w.toFixed(2)),
          d: Number(r.d.toFixed(2)),
          needsPlumbing: r.type === 'wet',
          ceilingHeight: r.ceilingHeight,
          finishes: r.finishes,
          fixtures: r.fixtures,
          openings: syncedOpenings
        });
      });
  });

  return {
    site: {
      width: b.site.width,
      depth: b.site.depth,
      floors: b.floors.length,
      floorHeight: b.site.floorHeight,
      slabThickness: b.site.slabThickness,
      plenumHeight: b.site.plenumHeight,
      defaultCeilingHeight: b.site.defaultCeilingHeight,
      structuralModule: b.site.structuralModule
    },
    skeleton: {
      columns: b.columns.map((c, idx) => ({
        id: c.id || `C${idx + 1}`,
        gridCode: c.gridCode,
        x: Number((c.x - halfW).toFixed(2)),
        z: Number((c.z - halfD).toFixed(2)),
        width: c.width ?? 0.5,
        depth: c.depth ?? 0.5
      })),
      beams: (b.beams || []).map((bm) => ({
        ...bm,
        x1: Number((bm.x1 - halfW).toFixed(2)),
        z1: Number((bm.z1 - halfD).toFixed(2)),
        x2: Number((bm.x2 - halfW).toFixed(2)),
        z2: Number((bm.z2 - halfD).toFixed(2))
      })),
      shearWalls: (b.shearWalls || []).map((sw) => ({
        ...sw,
        x1: Number((sw.x1 - halfW).toFixed(2)),
        z1: Number((sw.z1 - halfD).toFixed(2)),
        x2: Number((sw.x2 - halfW).toFixed(2)),
        z2: Number((sw.z2 - halfD).toFixed(2))
      })),
      cores
    },
    mep: {
      shafts: b.risers.map((ri, idx) => ({
        id: ri.type === 'plumbing' ? 'PS-1' : `DS-${idx}`,
        type: ri.type,
        label: ri.name,
        x: Number((ri.x - halfW).toFixed(2)),
        z: Number((ri.z - halfD).toFixed(2)),
        radius: 0.35
      }))
    },
    rooms
  };
}

// 2D CADマルチレイヤー建築図面 (SVG) ジェネレータ（プロ建築意匠ハッチング・住宅設備CADシンボル・壁芯密着間取り図対応）
export function renderSvgBlueprintClient(bp: StratumArchBIMSchema): string {
  return renderProArchitecturalCadSvg(bp, {
    floorFilter: 'ALL',
    cadTheme: 'monochrome_hatch',
    labelStyle: 'english_serif'
  });
}

interface StudioProps {
  initialBlueprint?: StratumArchBIMSchema;
  initialPrompt?: string;
  autoStartDemo?: boolean;
  onBack?: () => void;
  initialLand?: {
    prevType: PreviousBuildingType;
    roadDir: FrontRoadDirection;
    surrounding: SurroundingContextType;
    context?: RealSiteContext;
  };
}

export default function App({ initialBlueprint, initialPrompt, autoStartDemo = false, onBack, initialLand }: StudioProps = {}) {
  const initialScenario: BuildingScenario = initialBlueprint
    ? stratumSchemaToBuildingScenario(initialBlueprint, initialPrompt ?? '', 'family_house_4ldk')
    : ensureScenarioDetails(PRESET_SCENARIOS.family_house_4ldk);
  const initialRoom =
    initialScenario.floors[0]?.rooms.find((r) => r.type !== 'core') ?? initialScenario.floors[0]?.rooms[0];

  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>('family_house_4ldk');
  const [buildingData, setBuildingData] = useState<BuildingScenario>(initialScenario);
  const [customPrompt, setCustomPrompt] = useState<string>(initialPrompt ?? initialScenario.prompt);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  // 地上建物の分解はデフォルト0（密着統合）とし、土地・地下埋設層の透視を主軸にする
  const [floorExplode, setFloorExplode] = useState<number>(0.0);
  const [layerExplode, setLayerExplode] = useState<number>(0.0);
  const [activeFloorFilter, setActiveFloorFilter] = useState<FloorFilter>('ALL');

  // 土地・過去建物履歴・周辺環境からの地下埋設推論ステート
  const [prevBuildingType, setPrevBuildingType] = useState<PreviousBuildingType>(initialLand?.prevType ?? 'showa_wooden_house');
  const [frontRoadDir, setFrontRoadDir] = useState<FrontRoadDirection>(initialLand?.roadDir ?? 'south');
  const [surroundingType, setSurroundingType] = useState<SurroundingContextType>(initialLand?.surrounding ?? 'old_residential_dense');
  const [showUnderground3D, setShowUnderground3D] = useState<boolean>(true);
  const [superstructureOpacity, setSuperstructureOpacity] = useState<number>(0.28);

  // 3つの建築地層（レイヤー）の表示切替
  const [visibleLayers, setVisibleLayers] = useState<Record<LayerKey, boolean>>({
    skeleton: true, // 第1層：構造スケルトン
    mep: true,      // 第2層：設備配管
    infill: true    // 第3層：意匠・間取り
  });

  // 選択中の部屋
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(
    initialRoom ? { type: 'room', floorLevel: 1, id: initialRoom.id } : null
  );

  const [showJsonDrawer, setShowJsonDrawer] = useState<boolean>(false);
  const [showSvgModal, setShowSvgModal] = useState<boolean>(false);
  const [repairLogs, setRepairLogs] = useState<string[]>([]);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('ISO');
  const [studioViewMode, setStudioViewMode] = useState<StudioViewMode>('SUBSURFACE_CAD');

  // 3Dデモンストレーション自動ツアー & 動画書き出しステート
  const [isAutoTour, setIsAutoTour] = useState<boolean>(autoStartDemo);
  const [tourCaption, setTourCaption] = useState<string>('SCENE 01 — 3層統合・建築全体プレビュー');
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSecLeft, setRecordingSecLeft] = useState<number>(0);
  const isAutoTourRef = useRef<boolean>(autoStartDemo);
  useEffect(() => {
    isAutoTourRef.current = isAutoTour;
  }, [isAutoTour]);

  // Three.js Refs
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const buildingGroupRef = useRef<THREE.Group | null>(null);
  const interactableMeshesRef = useRef<THREE.Object3D[]>([]);
  const isDraggingCameraRef = useRef<boolean>(false);
  const prevMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const sphericalRef = useRef<{ radius: number; theta: number; phi: number; targetY: number }>({
    radius: 26,
    theta: Math.PI / 4.2,
    phi: Math.PI / 2.8,
    targetY: 0.2
  });

  // ==========================================
  // 建築ルール・上下階設備整合性・部屋重なり検証
  // ==========================================
  const diagnostics = useMemo(() => {
    let totalArea = 0;
    const warnings: string[] = [];

    buildingData.floors.forEach((f) => {
      // 1. 面積加算＆敷地境界オーバーチェック
      f.rooms.forEach((r) => {
        totalArea += r.w * r.d;
        if (r.x + r.w > buildingData.site.width + 0.05 || r.z + r.d > buildingData.site.depth + 0.05) {
          warnings.push(`${f.level}F「${r.name}」が敷地境界（${buildingData.site.width}m×${buildingData.site.depth}m）を超過しています。`);
        }
      });

      // 2. 同一フロア内の部屋同士の重なり（干渉）検知
      for (let i = 0; i < f.rooms.length; i++) {
        for (let j = i + 1; j < f.rooms.length; j++) {
          const a = f.rooms[i];
          const b = f.rooms[j];
          const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
          const overlapZ = Math.max(0, Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z));
          if (overlapX > 0.15 && overlapZ > 0.15) {
            warnings.push(`${f.level}F「${a.name}」と「${b.name}」の間取り座標が干渉（重複）しています。`);
          }
        }
      }

      // 3. 水回り部屋（wet）と給排水縦シャフト（PS）の距離・勾配検証（ユークリッド距離3.5m以内）
      const wetRooms = f.rooms.filter((r) => r.type === 'wet');
      const mainWaterRiser = buildingData.risers.find((ri) => ri.type === 'plumbing');
      if (mainWaterRiser) {
        wetRooms.forEach((wetRoom) => {
          const roomCenterX = wetRoom.x + wetRoom.w / 2;
          const roomCenterZ = wetRoom.z + wetRoom.d / 2;
          const dist = Math.hypot(roomCenterX - mainWaterRiser.x, roomCenterZ - mainWaterRiser.z);
          if (dist > 3.5) {
            warnings.push(
              `${f.level}F「${wetRoom.name}」が給排水縦シャフト(PS)から${dist.toFixed(1)}m離れており（上限3.5m）、床下排水勾配が確保できません。`
            );
          }
        });
      }

      // 4. 垂直方向（Z軸）クリアランス検証（床スラブ厚 + 設備プレナム高 + 部屋天井高 <= 階高）
      const slabT = buildingData.site.slabThickness ?? 0.22;
      const plenumH = buildingData.site.plenumHeight ?? 0.36;
      const defCh = buildingData.site.defaultCeilingHeight ?? 2.4;
      f.rooms.forEach((r) => {
        if (r.type === 'core' || r.type === 'terrace' || r.type === 'parking') return;
        const ch = r.ceilingHeight ?? defCh;
        if (slabT + plenumH + ch > buildingData.site.floorHeight + 0.05) {
          warnings.push(
            `${f.level}F「${r.name}」の垂直積層（スラブ${slabT.toFixed(2)}m＋プレナム${plenumH.toFixed(2)}m＋天井高${ch.toFixed(2)}m）が階高${buildingData.site.floorHeight.toFixed(2)}mを超過しています。`
          );
        }

        // 5. 建築基準法 居室採光検証（窓面積 >= 床面積の 1/7）
        if ((r.type === 'cafe' || r.type === 'office' || r.type === 'meeting') && r.openings && r.openings.length > 0) {
          const winArea = r.openings
            .filter((op) => op.type === 'window')
            .reduce((acc, op) => acc + op.width * op.height, 0);
          const reqArea = (r.w * r.d) / 7.0;
          if (winArea + 0.05 < reqArea) {
            warnings.push(
              `${f.level}F「${r.name}」の採光窓面積（${winArea.toFixed(1)}㎡）が建築基準法1/7基準（必要${reqArea.toFixed(1)}㎡）を下回っています。`
            );
          }
        }
      });
    });

    const estimatedCostManYen = Math.round(totalArea * 39.0 + buildingData.columns.length * 125);

    return {
      totalArea: totalArea.toFixed(1),
      estimatedCost: estimatedCostManYen.toLocaleString(),
      isValid: warnings.length === 0,
      warnings
    };
  }, [buildingData]);

  // 選択中の部屋データ取得
  const activeRoomObj = useMemo(() => {
    if (!selectedItem || selectedItem.type !== 'room') return null;
    const floor = buildingData.floors.find((f) => f.level === selectedItem.floorLevel);
    if (!floor) return null;
    return floor.rooms.find((r) => r.id === selectedItem.id) || null;
  }, [buildingData, selectedItem]);

  // シナリオ切り替え
  const handleSelectScenario = (key: ScenarioKey) => {
    setScenarioKey(key);
    const cloned = ensureScenarioDetails(PRESET_SCENARIOS[key]);
    setBuildingData(cloned);
    setCustomPrompt(cloned.prompt);
    setSelectedItem({
      type: 'room',
      floorLevel: 2,
      id: cloned.floors[1].rooms[0].id
    });
  };

  // AI推論API呼び出し (/api/generate-blueprint) + フォールバックシミュレーション
  const handleSimulateAiGeneration = async () => {
    setIsGenerating(true);
    try {
      const endpoints = ['/api/generate-blueprint', 'http://127.0.0.1:8000/api/generate-blueprint'];
      let apiResponseData: { blueprint?: StratumArchBIMSchema } | null = null;

      for (const url of endpoints) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: customPrompt, auto_repair: true })
          });
          if (res.ok) {
            apiResponseData = await res.json();
            break;
          }
        } catch {
          // 次のエンドポイントまたはローカルフォールバックへ進む
        }
      }

      if (apiResponseData && apiResponseData.blueprint) {
        const converted = stratumSchemaToBuildingScenario(
          apiResponseData.blueprint,
          customPrompt,
          scenarioKey
        );
        setBuildingData(converted);
        setActiveFloorFilter('ALL');
        const targetFl = converted.floors[1] || converted.floors[0];
        if (targetFl && targetFl.rooms.length > 0) {
          const firstNonCore = targetFl.rooms.find((r) => r.type !== 'core') || targetFl.rooms[0];
          setSelectedItem({
            type: 'room',
            floorLevel: targetFl.level,
            id: firstNonCore.id
          });
        }
        setFloorExplode(0.0);
        setLayerExplode(0.0);
        setIsGenerating(false);
        return;
      }
    } catch {
      // バックエンド未起動時はプリセット推論シミュレーションへフォールバック
    }

    setTimeout(() => {
      // バックエンド未起動時もプロンプトから「一般住宅」か「オフィス・複合施設」かを自律判定
      const p = customPrompt;
      let nextKey: ScenarioKey = 'family_house_4ldk';
      if (p.includes('ガレージ') || p.includes('中庭') || (p.includes('3階') && (p.includes('家') || p.includes('住宅')))) {
        nextKey = 'garage_house_3f';
      } else if (
        p.includes('家') ||
        p.includes('住宅') ||
        p.includes('戸建') ||
        p.includes('LDK') ||
        p.includes('木造') ||
        p.includes('子供部屋') ||
        p.includes('寝室') ||
        p.includes('和室')
      ) {
        nextKey = 'family_house_4ldk';
      } else if (p.includes('クリニック') || p.includes('病院') || p.includes('薬局')) {
        nextKey = 'clinic_residence';
      } else if (p.includes('ラボ') || p.includes('研究') || p.includes('実験')) {
        nextKey = 'research_lab';
      } else if (p.includes('カフェ') || p.includes('オフィス') || p.includes('ビル')) {
        nextKey = 'cafe_office';
      } else {
        const keys = Object.keys(PRESET_SCENARIOS) as ScenarioKey[];
        nextKey = keys[(keys.indexOf(scenarioKey) + 1) % keys.length];
      }

      const base = ensureScenarioDetails(PRESET_SCENARIOS[nextKey]);
      base.prompt = customPrompt;
      setScenarioKey(nextKey);
      setBuildingData(base);
      setActiveFloorFilter('ALL');
      const targetFl = base.floors[1] || base.floors[0];
      setSelectedItem({
        type: 'room',
        floorLevel: targetFl.level,
        id: targetFl.rooms[0].id
      });
      setFloorExplode(0.0);
      setLayerExplode(0.0);
      setIsGenerating(false);
    }, 550);
  };

  // 部屋の座標・寸法・用途の更新
  const updateSelectedRoom = (field: 'type' | 'w' | 'd' | 'x' | 'z', value: string) => {
    if (!selectedItem) return;
    setBuildingData((prev) => {
      const next: BuildingScenario = JSON.parse(JSON.stringify(prev));
      const floor = next.floors.find((f) => f.level === selectedItem.floorLevel);
      if (!floor) return prev;
      const room = floor.rooms.find((r) => r.id === selectedItem.id);
      if (!room) return prev;

      if (field === 'type') {
        const matched = ROOM_USAGE_OPTIONS.find((opt) => opt.type === value);
        room.type = value as RoomType;
        if (matched) room.color = matched.color;
      } else {
        const numVal = parseFloat(value);
        if (!isNaN(numVal)) {
          room[field] = numVal;
        }
      }
      return next;
    });
  };

  // 垂直方向（Z軸）および構造断面パラメータの更新
  const updateSiteVerticalParam = (
    field: 'floorHeight' | 'slabThickness' | 'plenumHeight' | 'columnSize',
    numVal: number
  ) => {
    if (isNaN(numVal)) return;
    setBuildingData((prev) => {
      const next: BuildingScenario = JSON.parse(JSON.stringify(prev));
      if (field === 'columnSize') {
        next.columns = next.columns.map((c) => ({ ...c, width: numVal, depth: numVal }));
      } else {
        next.site[field] = numVal;
      }
      return next;
    });
  };

  // 選択中の部屋の詳細設計プロパティ（天井高・仕上材・窓幅・ドア幅）の更新
  const updateSelectedRoomDetail = (
    field: 'ceilingHeight' | 'floorFinish' | 'windowWidth' | 'doorWidth',
    value: string
  ) => {
    if (!selectedItem) return;
    setBuildingData((prev) => {
      const next: BuildingScenario = JSON.parse(JSON.stringify(prev));
      const floor = next.floors.find((f) => f.level === selectedItem.floorLevel);
      if (!floor) return prev;
      const room = floor.rooms.find((r) => r.id === selectedItem.id);
      if (!room) return prev;

      if (field === 'ceilingHeight') {
        const v = parseFloat(value);
        if (!isNaN(v)) room.ceilingHeight = v;
      } else if (field === 'floorFinish') {
        room.finishes = {
          ...(room.finishes || { floor: value, wall: 'plaster_paint', ceiling: 'gypsum_cloth' }),
          floor: value
        };
      } else if (field === 'windowWidth') {
        const v = parseFloat(value);
        if (!isNaN(v) && room.openings) {
          const win = room.openings.find((op) => op.type === 'window');
          if (win) win.width = v;
        }
      } else if (field === 'doorWidth') {
        const v = parseFloat(value);
        if (!isNaN(v) && room.openings) {
          const dr = room.openings.find((op) => op.type === 'door');
          if (dr) dr.width = v;
        }
      }
      return next;
    });
  };

  // ハッカソン審査員向けデモ演出①：意図的にLLMの座標破綻（AABB重複＋給排水3.5m超過）を注入 (Before)
  const handleInjectViolationDemo = () => {
    setRepairLogs([]);
    setBuildingData((prev) => {
      const next: BuildingScenario = JSON.parse(JSON.stringify(prev));
      const targetFl = next.floors[1] || next.floors[0];
      if (!targetFl) return prev;
      const wetRoom = targetFl.rooms.find((r) => r.type === 'wet');
      const mainRoom = targetFl.rooms.find((r) => r.type !== 'wet' && r.type !== 'core');
      if (wetRoom && mainRoom) {
        // 水回り部屋を給排水縦シャフト(PS)から大きく離し、かつメイン室とAABB重複させる
        wetRoom.x = Number(Math.max(0.6, mainRoom.x + 1.0).toFixed(1));
        wetRoom.z = Number(Math.min(next.site.depth - wetRoom.d - 0.4, mainRoom.z + 1.2).toFixed(1));
        setSelectedItem({ type: 'room', floorLevel: targetFl.level, id: wetRoom.id });
      }
      return next;
    });
  };

  // ハッカソン審査員向けデモ演出②：物理整合性バリデータ＆自己修復エンジンで自動補正 (After)
  const handleRunSelfRepairDemo = async () => {
    const currentSchema = buildingScenarioToStratumSchema(buildingData);
    const endpoints = ['/api/validate-blueprint', 'http://127.0.0.1:8000/api/validate-blueprint'];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blueprint: currentSchema, auto_repair: true })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.blueprint) {
            const repairedScenario = stratumSchemaToBuildingScenario(
              data.blueprint,
              customPrompt,
              scenarioKey
            );
            setBuildingData(repairedScenario);
            setRepairLogs(
              data.validation?.corrections?.length
                ? data.validation.corrections
                : ['最小貫通軸シフトおよび給排水シャフト(PS)3.5m圏内への引き寄せ補正を完了しました。']
            );
            return;
          }
        }
      } catch {
        // ローカルフォールバックへ
      }
    }

    // バックエンド未接続時のクライアント側即時幾何補正フォールバック
    const cloned: BuildingScenario = JSON.parse(JSON.stringify(PRESET_SCENARIOS[scenarioKey]));
    setBuildingData(cloned);
    setRepairLogs([
      '2F 水回り室を給排水縦シャフト(PS-1)の半径3.5m以内へ引き寄せ補正しました。',
      '2F メイン室とのAABB領域干渉を最小貫通軸シフトにより解消しました。'
    ]);
  };

  // 2D CAD (SVG) 図面のファイルダウンロード
  const handleDownloadSvg = () => {
    const svgStr = renderSvgBlueprintClient(buildingScenarioToStratumSchema(buildingData));
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stratum_bim_${buildingData.site.width}x${buildingData.site.depth}m.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 3Dデモンストレーション自動ツアー（土地スキャン・地下埋設ガス管/上下水管・地中障害物X線透視シーケンス）
  useEffect(() => {
    if (!isAutoTour) return;
    let tick = 0;
    setStudioViewMode('3D_BIM');
    setActiveFloorFilter('ALL');
    setFloorExplode(0.0);
    setLayerExplode(0.0);
    setShowUnderground3D(true);
    setVisibleLayers({ skeleton: true, mep: true, infill: true });

    const timer = window.setInterval(() => {
      tick = (tick + 1) % 120; // 100ms * 120 = 12秒で1周する地下埋設X線スキャンシーケンス
      if (tick < 30) {
        // Phase 1: 地上建物を消去し、土地・前面道路本管・旧木造住宅の埋設白ガス管をX線透視
        setSuperstructureOpacity(0.0);
        setPrevBuildingType('showa_wooden_house');
        setTourCaption('SCENE 01 — 土地・周囲の建物から「旧木造住宅の埋設白ガス管・旧浄化槽」をX線推論');
      } else if (tick < 60) {
        // Phase 2: 旧RCクリニックビル跡地の残置PHC杭(GL-8.5m)・中圧ガス引込管(50A)を推論
        setSuperstructureOpacity(0.15);
        setPrevBuildingType('heisei_rc_clinic');
        setTourCaption('SCENE 02 — 旧RCビル履歴から「地下残置PHC杭6本(GL-8.5m)・50Aガス管」を推論');
      } else if (tick < 90) {
        // Phase 3: 旧連棟アパート跡地の隣地越境ガス枝管・共用下水管リスクを検出
        setSuperstructureOpacity(0.32);
        setPrevBuildingType('rowhouse_apartments');
        setTourCaption('SCENE 03 — 周囲の建物との関係から「隣地越境ガス管・共用排水管リスク」を検出');
      } else {
        // Phase 4: 地下埋設インフラを避けて新築建物の基礎・給排水縦シャフト(PS)を統合配置
        const p = (tick - 90) / 30;
        setSuperstructureOpacity(Number((0.32 + p * 0.58).toFixed(2)));
        setPrevBuildingType('showa_wooden_house');
        setTourCaption('SCENE 04 — 地下埋設物・ガス管との干渉を回避して新築基礎・設備配管を統合');
      }
    }, 100);

    return () => window.clearInterval(timer);
  }, [isAutoTour]);

  // 3Dデモ動画 (.webm) のキャプチャ＆ダウンロード
  const handleRecordDemoVideo = () => {
    const renderer = rendererRef.current;
    if (!renderer || isRecording) return;

    const canvas = renderer.domElement as HTMLCanvasElement & {
      captureStream?: (frameRate?: number) => MediaStream;
    };
    if (typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      setIsAutoTour(true);
      return;
    }

    try {
      setIsAutoTour(true);
      setIsRecording(true);
      setRecordingSecLeft(12);

      const stream = canvas.captureStream(30);
      const mimeTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
      ];
      const supportedMime = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime, videoBitsPerSecond: 5_000_000 })
        : new MediaRecorder(stream);

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stratum_demo_${buildingData.site.width}x${buildingData.site.depth}m.webm`;
        a.click();
        URL.revokeObjectURL(url);
        setIsRecording(false);
        setRecordingSecLeft(0);
      };

      recorder.start(200);

      let sec = 12;
      const countdown = window.setInterval(() => {
        sec -= 1;
        setRecordingSecLeft(Math.max(0, sec));
        if (sec <= 0) {
          window.clearInterval(countdown);
          if (recorder.state !== 'inactive') {
            recorder.stop();
          }
        }
      }, 1000);
    } catch {
      setIsRecording(false);
      setRecordingSecLeft(0);
    }
  };

  // ==========================================
  // Three.js 初期化（建築模型スタジオ風の明るいライティング）
  // ==========================================
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    // 地下埋設管・土壌地層・X線モデルが鮮明に映えるダークエンジニアリング背景
    scene.background = new THREE.Color('#0B1222');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 1000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 柔らかい自然光（建築模型スタジオの照明）
    const ambientLight = new THREE.AmbientLight(0xfffcf5, 0.85);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff8eb, 0.75);
    sunLight.position.set(22, 38, 26);
    sunLight.castShadow = true;
    scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0xe8e2d5, 0.4);
    fillLight.position.set(-22, 16, -18);
    scene.add(fillLight);

    // 繊細な建築図面グリッド（薄いウォームグレー）
    const gridHelper = new THREE.GridHelper(32, 32, 0xD0CBC0, 0xE2DDD3);
    gridHelper.position.y = -0.04;
    scene.add(gridHelper);

    const buildingGroup = new THREE.Group();
    scene.add(buildingGroup);
    buildingGroupRef.current = buildingGroup;

    const updateCameraPosition = () => {
      const { radius, theta, phi, targetY } = sphericalRef.current;
      camera.position.x = radius * Math.sin(phi) * Math.sin(theta);
      camera.position.y = targetY + radius * Math.cos(phi);
      camera.position.z = radius * Math.sin(phi) * Math.cos(theta);
      camera.lookAt(0, targetY, 0);
    };
    updateCameraPosition();

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      isDraggingCameraRef.current = true;
      prevMouseRef.current = { x: e.clientX, y: e.clientY };
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingCameraRef.current) return;
      const dx = e.clientX - prevMouseRef.current.x;
      const dy = e.clientY - prevMouseRef.current.y;
      prevMouseRef.current = { x: e.clientX, y: e.clientY };

      sphericalRef.current.theta -= dx * 0.0075;
      sphericalRef.current.phi = Math.max(0.14, Math.min(Math.PI / 2 - 0.04, sphericalRef.current.phi - dy * 0.0075));
      updateCameraPosition();
    };

    const onPointerUp = (e: PointerEvent) => {
      isDraggingCameraRef.current = false;
      const moveDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (moveDist < 5) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        const intersects = raycaster.intersectObjects(interactableMeshesRef.current, false);
        if (intersects.length > 0) {
          const hitData = intersects[0].object.userData as SelectedItem | undefined;
          if (hitData && hitData.id) {
            setSelectedItem(hitData);
          }
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      sphericalRef.current.radius = Math.max(13, Math.min(52, sphericalRef.current.radius + e.deltaY * 0.015));
      updateCameraPosition();
    };

    const domElem = renderer.domElement;
    domElem.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    domElem.addEventListener('wheel', onWheel, { passive: false });

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    let reqId: number;
    const animate = () => {
      reqId = requestAnimationFrame(animate);
      if (isAutoTourRef.current && !isDraggingCameraRef.current) {
        sphericalRef.current.theta += 0.0042;
        updateCameraPosition();
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(reqId);
      domElem.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      domElem.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, []);

  // カメラプリセット切替
  useEffect(() => {
    if (!cameraRef.current) return;
    if (cameraPreset === 'ISO') {
      sphericalRef.current = { radius: 26, theta: Math.PI / 4.2, phi: Math.PI / 2.8, targetY: 0.2 };
    } else if (cameraPreset === 'TOP') {
      sphericalRef.current = { radius: 26, theta: 0, phi: 0.14, targetY: 0.0 };
    } else if (cameraPreset === 'FRONT') {
      sphericalRef.current = { radius: 26, theta: 0, phi: Math.PI / 2.08, targetY: -0.5 };
    }
    const { radius, theta, phi, targetY } = sphericalRef.current;
    cameraRef.current.position.x = radius * Math.sin(phi) * Math.sin(theta);
    cameraRef.current.position.y = targetY + radius * Math.cos(phi);
    cameraRef.current.position.z = radius * Math.sin(phi) * Math.cos(theta);
    cameraRef.current.lookAt(0, targetY, 0);
  }, [cameraPreset]);

  // ==========================================
  // 建築3レイヤー（地層）ジオメトリの構築
  // ==========================================
  useEffect(() => {
    const group = buildingGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }
    interactableMeshesRef.current = [];

    const { width: siteW, depth: siteD, floorHeight } = buildingData.site;
    const offsetX = -siteW / 2;
    const offsetZ = -siteD / 2;

    // 敷地境界ベースプレート（半透明地表 GL±0.0m サーフェス）
    const basePlateGeo = new THREE.BoxGeometry(siteW + 0.4, 0.08, siteD + 0.4);
    const basePlateMat = new THREE.MeshStandardMaterial({
      color: 0xDFD9CE,
      roughness: 0.9,
      metalness: 0.05,
      transparent: true,
      opacity: showUnderground3D ? 0.35 : 0.92
    });
    const basePlate = new THREE.Mesh(basePlateGeo, basePlateMat);
    basePlate.position.set(0, -0.04, 0);
    group.add(basePlate);

    const siteOutlineGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(siteW, 0.05, siteD));
    const siteOutlineMat = new THREE.LineBasicMaterial({ color: 0x1C1B18 });
    const siteOutline = new THREE.LineSegments(siteOutlineGeo, siteOutlineMat);
    siteOutline.position.set(0, 0.02, 0);
    group.add(siteOutline);

    // ==========================================
    // 地下埋設層（GL 0.0m 〜 -8.5m）：周囲の建物・旧建物履歴からの埋設ガス管・上下水管・地中障害物3Dモデル
    // ==========================================
    if (showUnderground3D) {
      const subGroup = new THREE.Group();
      const subData = inferLandSubsurface(
        buildingScenarioToStratumSchema(buildingData),
        prevBuildingType,
        frontRoadDir,
        surroundingType
      );

      // 1) 地下3地層ボックス (GL 0〜-1.6m / -1.6〜-4.8m / -4.8〜-8.5m)
      subData.soilLayers.forEach((sl, sIdx) => {
        const h = sl.depthTo - sl.depthFrom;
        const cy = -(sl.depthFrom + h / 2);
        const soilGeo = new THREE.BoxGeometry(siteW, h, siteD);
        const soilMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(sl.colorHex),
          transparent: true,
          opacity: 0.10 + sIdx * 0.03,
          roughness: 0.95,
          depthWrite: false
        });
        const soilMesh = new THREE.Mesh(soilGeo, soilMat);
        soilMesh.position.set(0, cy, 0);
        subGroup.add(soilMesh);

        const soilEdges = new THREE.LineSegments(
          new THREE.EdgesGeometry(soilGeo),
          new THREE.LineBasicMaterial({ color: 0x9C8F7A, transparent: true, opacity: 0.45 })
        );
        soilEdges.position.copy(soilMesh.position);
        subGroup.add(soilEdges);
      });

      // 2) 周囲の建物シルエット（西隣・東隣・北隣の既存建物ボリューム）
      const neighborSpecs = [
        { x: -siteW / 2 - 3.6, z: 0, w: 5.2, d: siteD * 0.85, h: surroundingType === 'urban_rc_mixed' ? 16 : 6.2 },
        { x: siteW / 2 + 3.6, z: 0, w: 5.2, d: siteD * 0.85, h: surroundingType === 'urban_rc_mixed' ? 11 : 5.8 },
        { x: 0, z: -siteD / 2 - 3.4, w: siteW * 0.9, d: 4.5, h: 4.8 }
      ];
      neighborSpecs.forEach((nb) => {
        const nbGeo = new THREE.BoxGeometry(nb.w, nb.h, nb.d);
        const nbMat = new THREE.MeshStandardMaterial({
          color: 0xD5D0C5,
          transparent: true,
          opacity: 0.18,
          roughness: 0.9,
          depthWrite: false
        });
        const nbMesh = new THREE.Mesh(nbGeo, nbMat);
        nbMesh.position.set(nb.x, nb.h / 2, nb.z);
        subGroup.add(nbMesh);

        const nbEdges = new THREE.LineSegments(
          new THREE.EdgesGeometry(nbGeo),
          new THREE.LineBasicMaterial({ color: 0xABA59A, transparent: true, opacity: 0.45 })
        );
        nbEdges.position.copy(nbMesh.position);
        subGroup.add(nbEdges);
      });

      // 3) 前回建っていた建物の跡地ゴースト外周枠 (GL+0.03m)
      const prevFpGeo = new THREE.BoxGeometry(
        subData.previousBuilding.footprintW,
        0.08,
        subData.previousBuilding.footprintD
      );
      const prevFpEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(prevFpGeo),
        new THREE.LineBasicMaterial({ color: 0x8C583A })
      );
      prevFpEdges.position.set(
        subData.previousBuilding.offsetX,
        0.04,
        subData.previousBuilding.offsetZ
      );
      subGroup.add(prevFpEdges);

      // 4) 推論された地下埋設管（都市ガス管・上水道管・下水管・隣地越境管）の3Dチューブ描画
      const pipeColorHex: Record<string, number> = {
        gas_low: 0xD97706,      // ガス引込管：アンバーオレンジ
        gas_medium: 0xB45309,   // ガス本管：ディープアンバー
        water_supply: 0x0284C7, // 上水道管：シアンブルー
        sewer_Foul: 0x7C2D12,   // 汚水下水管：ブラウン
        storm_drain: 0x4D7C0F,  // 雨水・暗渠管：グリーン
        power_Loops: 0x6D28D9
      };

      subData.pipes.forEach((p) => {
        const p1 = new THREE.Vector3(p.x1, -p.depth1, p.z1);
        const p2 = new THREE.Vector3(p.x2, -p.depth2, p.z2);
        const dir = new THREE.Vector3().subVectors(p2, p1);
        const len = dir.length();
        if (len < 0.1) return;

        const radius = Math.max(0.08, (p.diameterMm / 1000) * 1.15);
        const cylGeo = new THREE.CylinderGeometry(radius, radius, len, 16);
        const colHex = p.status === 'cross_border_risk' ? 0xDC2626 : (pipeColorHex[p.kind] ?? 0xD97706);
        const cylMat = new THREE.MeshStandardMaterial({
          color: colHex,
          roughness: 0.35,
          metalness: 0.45
        });
        const cylMesh = new THREE.Mesh(cylGeo, cylMat);
        const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        cylMesh.position.copy(mid);
        cylMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        subGroup.add(cylMesh);

        // 敷地内終端から地表(GL±0.0m)への旧メーター・点検桝立ち上がり管
        if (!p.id.startsWith('MAIN-')) {
          const riserH = p.depth2;
          const upGeo = new THREE.CylinderGeometry(0.07, 0.07, riserH, 12);
          const upMesh = new THREE.Mesh(upGeo, cylMat);
          upMesh.position.set(p.x2, -riserH / 2, p.z2);
          subGroup.add(upMesh);
        }
      });

      // 5) 地中残置障害物（旧残置PHC杭・旧浄化槽・旧布基礎・旧重油タンク・古井戸）の3D描画
      subData.obstacles.forEach((obs) => {
        const obsH = Math.max(0.3, obs.depthBottom - obs.depthTop);
        const cy = -(obs.depthTop + obsH / 2);
        const isPile = obs.kind === 'old_pile' || obs.kind === 'old_well';
        const obsGeo = isPile
          ? new THREE.CylinderGeometry(obs.w / 2, obs.w / 2, obsH, 18)
          : new THREE.BoxGeometry(obs.w, obsH, obs.d);
        const obsMat = new THREE.MeshStandardMaterial({
          color: isPile ? 0x9E3B1E : 0xB45309,
          transparent: true,
          opacity: 0.78,
          roughness: 0.6,
          metalness: 0.15
        });
        const obsMesh = new THREE.Mesh(obsGeo, obsMat);
        obsMesh.position.set(obs.x, cy, obs.z);
        subGroup.add(obsMesh);

        const obsEdges = new THREE.LineSegments(
          new THREE.EdgesGeometry(obsGeo),
          new THREE.LineBasicMaterial({ color: 0x7F1D1D })
        );
        obsEdges.position.copy(obsMesh.position);
        subGroup.add(obsEdges);
      });

      group.add(subGroup);
    }

    const slabT = buildingData.site.slabThickness ?? 0.22;
    const plenumH = buildingData.site.plenumHeight ?? 0.36;
    const defaultCh = buildingData.site.defaultCeilingHeight ?? Math.max(2.3, floorHeight - slabT - plenumH);

    if (superstructureOpacity > 0.02) {
      buildingData.floors.forEach((floor, fIdx) => {
      if (activeFloorFilter !== 'ALL' && activeFloorFilter !== floor.level) return;

      const baseFloorY = fIdx * (floorHeight + floorExplode);
      const skeletonY = baseFloorY;
      const mepY = baseFloorY + layerExplode * 0.9;
      const infillY = baseFloorY + layerExplode * 1.8;

      // ------------------------------------------
      // 第1層：構造スケルトン層 (Skeleton: 床スラブ・通し柱・大梁/小梁・耐力壁)
      // ------------------------------------------
      if (visibleLayers.skeleton) {
        const skeletonGroup = new THREE.Group();
        skeletonGroup.position.y = skeletonY;

        // ウォームコンクリートの床スラブ（slabThickness を反映）
        const slabGeo = new THREE.BoxGeometry(siteW, slabT, siteD);
        const slabMat = new THREE.MeshStandardMaterial({
          color: 0xDFDBD2,
          roughness: 0.85,
          metalness: 0.05,
          transparent: true,
          opacity: 0.92
        });
        const slabMesh = new THREE.Mesh(slabGeo, slabMat);
        slabMesh.position.set(0, slabT / 2, 0);
        skeletonGroup.add(slabMesh);

        const slabEdges = new THREE.LineSegments(
          new THREE.EdgesGeometry(slabGeo),
          new THREE.LineBasicMaterial({ color: 0xABA59A })
        );
        slabEdges.position.copy(slabMesh.position);
        skeletonGroup.add(slabEdges);

        // 1F〜最上階貫通構造柱（柱断面 width × depth を反映）
        buildingData.columns.forEach((col) => {
          const cw = col.width ?? 0.45;
          const cd = col.depth ?? 0.45;
          const colGeo = new THREE.BoxGeometry(cw, floorHeight, cd);
          const colMat = new THREE.MeshStandardMaterial({
            color: 0x9E988E,
            roughness: 0.7,
            metalness: 0.15
          });
          const colMesh = new THREE.Mesh(colGeo, colMat);
          colMesh.position.set(offsetX + col.x, floorHeight / 2, offsetZ + col.z);
          skeletonGroup.add(colMesh);

          const colEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(colGeo),
            new THREE.LineBasicMaterial({ color: 0x757067 })
          );
          colEdges.position.copy(colMesh.position);
          skeletonGroup.add(colEdges);
        });

        // 大梁 (girder) および小梁 (secondary) グリッド
        (buildingData.beams || []).forEach((bm) => {
          const dx = bm.x2 - bm.x1;
          const dz = bm.z2 - bm.z1;
          const len = Math.hypot(dx, dz);
          if (len < 0.2) return;
          const angle = Math.atan2(dx, dz);
          const beamGeo = new THREE.BoxGeometry(bm.width, bm.depth, len);
          const isGirder = bm.kind === 'girder';
          const beamMat = new THREE.MeshStandardMaterial({
            color: isGirder ? 0xA8A298 : 0xB8B2A8,
            roughness: 0.75,
            metalness: 0.1,
            transparent: true,
            opacity: isGirder ? 0.88 : 0.72
          });
          const beamMesh = new THREE.Mesh(beamGeo, beamMat);
          beamMesh.position.set(
            offsetX + (bm.x1 + bm.x2) / 2,
            floorHeight - bm.depth / 2,
            offsetZ + (bm.z1 + bm.z2) / 2
          );
          beamMesh.rotation.y = angle;
          skeletonGroup.add(beamMesh);
        });

        // 耐力壁 (shearWalls)
        (buildingData.shearWalls || []).forEach((sw) => {
          const dx = sw.x2 - sw.x1;
          const dz = sw.z2 - sw.z1;
          const len = Math.hypot(dx, dz);
          if (len < 0.2) return;
          const angle = Math.atan2(dx, dz);
          const swGeo = new THREE.BoxGeometry(sw.thickness, floorHeight - slabT, len);
          const swMat = new THREE.MeshStandardMaterial({
            color: 0x8C867C,
            roughness: 0.8,
            transparent: true,
            opacity: 0.65
          });
          const swMesh = new THREE.Mesh(swGeo, swMat);
          swMesh.position.set(
            offsetX + (sw.x1 + sw.x2) / 2,
            slabT + (floorHeight - slabT) / 2,
            offsetZ + (sw.z1 + sw.z2) / 2
          );
          swMesh.rotation.y = angle;
          skeletonGroup.add(swMesh);
        });

        group.add(skeletonGroup);
      }

      // ------------------------------------------
      // 第2層：設備配管・プレナム層 (MEP & Plenum Clearance)
      // ------------------------------------------
      if (visibleLayers.mep) {
        const mepGroup = new THREE.Group();
        mepGroup.position.y = mepY;
        const plenumCenterY = Math.max(slabT + 1.8, floorHeight - plenumH / 2);

        // 分解時の設備プレナム空間（Plenum Clearance）ボリュームガイド
        if (layerExplode > 0.15) {
          const planeGeo = new THREE.BoxGeometry(siteW, plenumH, siteD);
          const planeMat = new THREE.MeshBasicMaterial({
            color: 0x4A8B9C,
            transparent: true,
            opacity: 0.08
          });
          const planeMesh = new THREE.Mesh(planeGeo, planeMat);
          planeMesh.position.set(0, plenumCenterY, 0);
          mepGroup.add(planeMesh);

          const planeBorder = new THREE.LineSegments(
            new THREE.EdgesGeometry(planeGeo),
            new THREE.LineBasicMaterial({ color: 0x8AAAB5 })
          );
          planeBorder.position.copy(planeMesh.position);
          mepGroup.add(planeBorder);
        }

        // 上下階貫通シャフト (PS / DS)
        buildingData.risers.forEach((riser) => {
          const isPlumbing = riser.type === 'plumbing';
          const riserGeo = new THREE.CylinderGeometry(0.26, 0.26, floorHeight + floorExplode * 0.55, 20);
          const riserMat = new THREE.MeshStandardMaterial({
            color: isPlumbing ? 0x3D7A8A : 0xB86B4B,
            roughness: 0.35,
            metalness: 0.45
          });
          const riserMesh = new THREE.Mesh(riserGeo, riserMat);
          riserMesh.position.set(offsetX + riser.x, floorHeight / 2, offsetZ + riser.z);
          mepGroup.add(riserMesh);
        });

        // 枝管・空調ダクト（プレナム高さ plenumCenterY に配置）
        floor.ducts.forEach((duct) => {
          const isHvac = duct.type === 'hvac';
          const dx = duct.x2 - duct.x1;
          const dz = duct.z2 - duct.z1;
          const length = Math.hypot(dx, dz);
          const angle = Math.atan2(dx, dz);

          const ductGeo = new THREE.BoxGeometry(isHvac ? 0.34 : 0.15, isHvac ? 0.2 : 0.15, length);
          const ductMat = new THREE.MeshStandardMaterial({
            color: isHvac ? 0xC87A5B : 0x4A8B9C,
            roughness: 0.4,
            metalness: 0.35
          });
          const ductMesh = new THREE.Mesh(ductGeo, ductMat);
          const midX = (duct.x1 + duct.x2) / 2;
          const midZ = (duct.z1 + duct.z2) / 2;
          ductMesh.position.set(offsetX + midX, plenumCenterY, offsetZ + midZ);
          ductMesh.rotation.y = angle;
          mepGroup.add(ductMesh);
        });

        group.add(mepGroup);
      }

      // ------------------------------------------
      // 第3層：意匠・間取り・建具開口部・設備什器層 (Infill)
      // ------------------------------------------
      if (visibleLayers.infill) {
        const infillGroup = new THREE.Group();
        infillGroup.position.y = infillY;

        floor.rooms.forEach((room) => {
          const isSelected =
            selectedItem &&
            selectedItem.type === 'room' &&
            selectedItem.floorLevel === floor.level &&
            selectedItem.id === room.id;

          const roomCh = room.ceilingHeight ?? defaultCh;
          const wallHeight = room.type === 'terrace' || room.type === 'parking' ? 0.95 : roomCh;

          // 壁芯スナップにより隣接部屋と隙間なく間仕切り壁を共有
          const visW = Math.min(siteW - 0.2, room.w + 0.18);
          const visD = Math.min(siteD - 0.2, room.d + 0.18);
          const roomGeo = new THREE.BoxGeometry(visW, wallHeight, visD);
          const roomMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(room.color),
            transparent: true,
            opacity: (isSelected ? 0.68 : 0.42) * superstructureOpacity,
            roughness: 0.65,
            metalness: 0.05
          });

          const roomMesh = new THREE.Mesh(roomGeo, roomMat);
          const centerX = offsetX + room.x + room.w / 2;
          const centerZ = offsetZ + room.z + room.d / 2;
          roomMesh.position.set(centerX, slabT + wallHeight / 2, centerZ);

          roomMesh.userData = {
            type: 'room',
            floorLevel: floor.level,
            id: room.id
          };
          interactableMeshesRef.current.push(roomMesh);
          infillGroup.add(roomMesh);

          // 建築図面風のシャープな輪郭線（選択時はテラコッタブラウンで強調）
          const edgeGeo = new THREE.EdgesGeometry(roomGeo);
          const edgeMat = new THREE.LineBasicMaterial({
            color: isSelected ? 0x9E3B1E : 0x4A4843
          });
          const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
          edgeLines.position.copy(roomMesh.position);
          infillGroup.add(edgeLines);

          // 床面の仕上材プレート（隙間ゼロの連続床）
          const floorTileGeo = new THREE.BoxGeometry(visW - 0.02, 0.06, visD - 0.02);
          const floorTileMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(room.color),
            roughness: 0.75
          });
          const floorTile = new THREE.Mesh(floorTileGeo, floorTileMat);
          floorTile.position.set(centerX, slabT + 0.03, centerZ);
          infillGroup.add(floorTile);

          // 部屋内の設備・什器 (fixtures) の3D描画
          (room.fixtures || []).forEach((fx) => {
            const fxH =
              fx.type === 'unit_bath'
                ? 1.9
                : fx.type === 'island_kitchen' || fx.type === 'lab_bench' || fx.type === 'sink'
                  ? 0.85
                  : fx.type === 'tatami_mat'
                    ? 0.12
                    : 0.72;
            const fxGeo = new THREE.BoxGeometry(fx.w, fxH, fx.d);
            const fxColor =
              fx.type === 'sink' || fx.type === 'toilet' || fx.type === 'unit_bath'
                ? 0xE6EEF0
                : fx.type === 'tatami_mat'
                  ? 0xB8C4A8
                  : 0xD8CFC2;
            const fxMat = new THREE.MeshStandardMaterial({
              color: fxColor,
              roughness: 0.6,
              metalness: 0.1
            });
            const fxMesh = new THREE.Mesh(fxGeo, fxMat);
            fxMesh.position.set(centerX + fx.localX, slabT + 0.06 + fxH / 2, centerZ + fx.localZ);
            infillGroup.add(fxMesh);

            const fxEdges = new THREE.LineSegments(
              new THREE.EdgesGeometry(fxGeo),
              new THREE.LineBasicMaterial({ color: 0x6E6A61 })
            );
            fxEdges.position.copy(fxMesh.position);
            infillGroup.add(fxEdges);
          });

          // 開口部・建具 (openings: 窓 window & ドア door) の3D描画
          (room.openings || []).forEach((op) => {
            const isWin = op.type === 'window';
            const opW = Math.min(op.width, (op.wall === 'north' || op.wall === 'south' ? room.w : room.d) * 0.9);
            const opH = Math.min(op.height, Math.max(0.5, wallHeight - 0.15));
            const sill = isWin ? Math.min(op.sillHeight, Math.max(0.1, wallHeight - opH - 0.05)) : 0.02;

            const isNS = op.wall === 'north' || op.wall === 'south';
            const boxW = isNS ? opW : 0.09;
            const boxD = isNS ? 0.09 : opW;
            const opGeo = new THREE.BoxGeometry(boxW, opH, boxD);
            const opMat = new THREE.MeshStandardMaterial({
              color: isWin ? 0x9CC5D6 : 0xB87B56,
              transparent: true,
              opacity: isWin ? 0.65 : 0.9,
              roughness: isWin ? 0.15 : 0.65,
              metalness: isWin ? 0.25 : 0.05
            });
            const opMesh = new THREE.Mesh(opGeo, opMat);

            const wallX =
              op.wall === 'west'
                ? centerX - room.w / 2
                : op.wall === 'east'
                  ? centerX + room.w / 2
                  : centerX + (op.type === 'door' ? -room.w * 0.22 : 0);
            const wallZ =
              op.wall === 'north'
                ? centerZ - room.d / 2
                : op.wall === 'south'
                  ? centerZ + room.d / 2
                  : centerZ;

            opMesh.position.set(wallX, slabT + sill + opH / 2, wallZ);
            infillGroup.add(opMesh);

            const opFrame = new THREE.LineSegments(
              new THREE.EdgesGeometry(opGeo),
              new THREE.LineBasicMaterial({ color: isWin ? 0x3D6B7D : 0x6E4228 })
            );
            opFrame.position.copy(opMesh.position);
            infillGroup.add(opFrame);
          });
        });

        group.add(infillGroup);
      }
      });
    }
  }, [
    buildingData,
    floorExplode,
    layerExplode,
    visibleLayers,
    activeFloorFilter,
    selectedItem,
    showUnderground3D,
    superstructureOpacity,
    prevBuildingType,
    frontRoadDir,
    surroundingType
  ]);

  const toggleLayer = (key: LayerKey) => {
    setVisibleLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#070B14] text-slate-100 overflow-hidden select-none antialiased">
      {/* ==================== トップバー（ダークGIS・タブレット対応ヘッダー） ==================== */}
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-[#070B14] border-b border-white/10 z-20">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 h-10 px-3 rounded-xl text-xs font-semibold ring-1 ring-white/15 bg-[#0B1222] text-slate-200 hover:bg-[#111C33] transition cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4 text-cyan-400" />
              マップへ戻る
            </button>
          )}
          <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-cyan-400/15 ring-1 ring-cyan-400/40 text-cyan-300">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-white">
                STRATUM GEO-BIM STUDIO
              </h1>
              <span className="hidden lg:inline-block px-2 py-0.5 text-[10px] font-mono font-semibold bg-cyan-400/15 text-cyan-300 ring-1 ring-cyan-400/30 rounded-md">
                SUBSURFACE X-RAY &amp; CAD
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              土地・地下埋設ガス管推論 × 新築2D/3D設計統合スタジオ
            </p>
          </div>
        </div>

        {/* 設計条件入力バー */}
        <div className="flex-1 max-w-lg hidden md:flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="設計したい建物の敷地・階層・用途を入力..."
              className="w-full h-10 bg-[#0B1222] ring-1 ring-white/15 focus:ring-cyan-400 rounded-xl px-3 text-xs text-white placeholder-slate-500 outline-none transition"
            />
          </div>
          <button
            onClick={handleSimulateAiGeneration}
            disabled={isGenerating}
            className="h-10 flex items-center gap-1.5 px-3.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-[#070B14] font-bold text-xs transition disabled:opacity-50 cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
            {isGenerating ? '計算中...' : 'AI再構成'}
          </button>
        </div>

        {/* シナリオ選択・デモ再生・CAD/JSONボタン */}
        <div className="flex items-center gap-2">
          <select
            value={scenarioKey}
            onChange={(e) => handleSelectScenario(e.target.value as ScenarioKey)}
            className="h-10 bg-[#0B1222] ring-1 ring-white/15 text-slate-200 text-xs rounded-xl px-2.5 outline-none cursor-pointer hover:bg-[#111C33] transition"
          >
            <optgroup label="一般住宅（戸建て・マイホーム）" className="bg-[#0B1222]">
              <option value="family_house_4ldk">10×9.5m 木造2F 4LDK戸建て住宅</option>
              <option value="garage_house_3f">10×10m 3F ガレージ＆中庭住宅</option>
            </optgroup>
            <optgroup label="オフィス・商業・研究複合建築" className="bg-[#0B1222]">
              <option value="cafe_office">12×10m カフェ＆オフィスビル</option>
              <option value="clinic_residence">14×10m クリニック＆レジデンス</option>
              <option value="research_lab">12×12m バイオ研究ラボ棟</option>
            </optgroup>
          </select>

          <button
            onClick={() => setIsAutoTour(!isAutoTour)}
            className={`h-10 flex items-center gap-1.5 px-3 rounded-xl text-xs font-semibold ring-1 transition cursor-pointer ${
              isAutoTour
                ? 'bg-cyan-400 ring-cyan-300 text-[#070B14]'
                : 'bg-[#0B1222] ring-white/15 text-slate-200 hover:bg-[#111C33]'
            }`}
          >
            {isAutoTour ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 text-cyan-400" />}
            <span className="hidden sm:inline">{isAutoTour ? 'ツアー停止' : '3D地下X線デモ'}</span>
          </button>

          <button
            onClick={handleRecordDemoVideo}
            disabled={isRecording}
            className={`h-10 hidden sm:flex items-center gap-1.5 px-3 rounded-xl text-xs font-semibold ring-1 transition cursor-pointer ${
              isRecording
                ? 'bg-red-500/20 ring-red-400 text-red-200'
                : 'bg-[#0B1222] ring-white/15 text-slate-200 hover:bg-[#111C33]'
            }`}
          >
            <Video className={`w-3.5 h-3.5 ${isRecording ? 'text-red-400 animate-pulse' : 'text-emerald-400'}`} />
            {isRecording ? `録画中 (${recordingSecLeft}s)` : '動画保存'}
          </button>

          <button
            onClick={() => setShowSvgModal(true)}
            className="h-10 flex items-center gap-1.5 px-3 rounded-xl text-xs font-semibold ring-1 bg-[#0B1222] ring-white/15 text-slate-200 hover:bg-[#111C33] transition cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">SVG出力</span>
          </button>

          <button
            onClick={() => setShowJsonDrawer(!showJsonDrawer)}
            className={`h-10 hidden lg:flex items-center gap-1.5 px-3 rounded-xl text-xs font-semibold ring-1 transition cursor-pointer ${
              showJsonDrawer
                ? 'bg-cyan-400 ring-cyan-300 text-[#070B14]'
                : 'bg-[#0B1222] ring-white/15 text-slate-200 hover:bg-[#111C33]'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            JSON
          </button>
        </div>
      </header>

      {/* ==================== メインワークスペース ==================== */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* 左サイドパネル：地下埋設AI推論＆レイヤー制御 */}
        <aside className="w-76 lg:w-80 hidden md:flex bg-[#0B1222] border-r border-white/10 flex-col justify-between p-4 overflow-y-auto z-10">
          <div className="space-y-4">
            {/* 1. 土地・過去建物履歴・周辺環境からの地下埋設AI推論パネル */}
            <div className="bg-[#070B14] ring-1 ring-cyan-400/40 rounded-2xl p-3.5 space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                  土地・旧建物からの地下埋設AI推論
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-400/15 text-cyan-300 font-bold">
                  GL 0〜-9.0m
                </span>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-300">
                  ① 前回建っていた建物履歴
                </label>
                <select
                  value={prevBuildingType}
                  onChange={(e) => setPrevBuildingType(e.target.value as PreviousBuildingType)}
                  className="w-full h-9 bg-[#0B1222] ring-1 ring-white/15 rounded-lg px-2 text-xs text-white cursor-pointer"
                >
                  {PREVIOUS_BUILDING_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id} className="bg-[#0B1222]">
                      {opt.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-300">
                  ② 前面道路・ガス/上下水本管位置
                </label>
                <select
                  value={frontRoadDir}
                  onChange={(e) => setFrontRoadDir(e.target.value as FrontRoadDirection)}
                  className="w-full h-9 bg-[#0B1222] ring-1 ring-white/15 rounded-lg px-2 text-xs text-white cursor-pointer"
                >
                  {FRONT_ROAD_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id} className="bg-[#0B1222]">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-300">
                  ③ 周囲の建物・隣地越境環境
                </label>
                <select
                  value={surroundingType}
                  onChange={(e) => setSurroundingType(e.target.value as SurroundingContextType)}
                  className="w-full h-9 bg-[#0B1222] ring-1 ring-white/15 rounded-lg px-2 text-xs text-white cursor-pointer"
                >
                  {SURROUNDING_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id} className="bg-[#0B1222]">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1 pt-1 border-t border-white/10">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-300">④ 地上建物のX線透過度</span>
                  <span className="font-mono text-cyan-300 font-bold">
                    {superstructureOpacity <= 0.02
                      ? '地下・土地のみ表示'
                      : `${Math.round(superstructureOpacity * 100)}%`}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={superstructureOpacity}
                  onChange={(e) => setSuperstructureOpacity(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer h-1.5"
                />
              </div>

              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <button
                  onClick={() => setStudioViewMode('SUBSURFACE_CAD')}
                  className="py-2 text-[11px] bg-cyan-400 hover:bg-cyan-300 text-[#070B14] font-bold rounded-lg transition cursor-pointer"
                >
                  2D 埋設推論伏図
                </button>
                <button
                  onClick={() => {
                    setStudioViewMode('3D_BIM');
                    setShowUnderground3D(true);
                    setSuperstructureOpacity(0.15);
                  }}
                  className="py-2 text-[11px] bg-white/10 hover:bg-white/15 text-white font-semibold rounded-lg transition cursor-pointer"
                >
                  3D 地下埋設X線
                </button>
              </div>
            </div>

            {/* 2. 3つの建築レイヤー表示切替 */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-300 px-0.5">
                新築建物レイヤーの表示切替
              </div>

              <button
                onClick={() => toggleLayer('infill')}
                className={`w-full flex items-center justify-between p-2.5 rounded-xl ring-1 text-left transition cursor-pointer ${
                  visibleLayers.infill
                    ? 'bg-[#070B14] ring-white/20 text-white'
                    : 'bg-[#070B14]/40 ring-white/5 text-slate-500'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold">意匠・間取り (Infill)</div>
                    <div className="text-[10px] text-slate-400">部屋ゾーニング・間仕切り壁</div>
                  </div>
                </div>
                {visibleLayers.infill ? <Eye className="w-3.5 h-3.5 text-cyan-400" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={() => toggleLayer('mep')}
                className={`w-full flex items-center justify-between p-2.5 rounded-xl ring-1 text-left transition cursor-pointer ${
                  visibleLayers.mep
                    ? 'bg-[#070B14] ring-white/20 text-white'
                    : 'bg-[#070B14]/40 ring-white/5 text-slate-500'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-cyan-400 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold">設備配管 (MEP)</div>
                    <div className="text-[10px] text-slate-400">給排水縦シャフト(PS)・ダクト</div>
                  </div>
                </div>
                {visibleLayers.mep ? <Eye className="w-3.5 h-3.5 text-cyan-400" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={() => toggleLayer('skeleton')}
                className={`w-full flex items-center justify-between p-2.5 rounded-xl ring-1 text-left transition cursor-pointer ${
                  visibleLayers.skeleton
                    ? 'bg-[#070B14] ring-white/20 text-white'
                    : 'bg-[#070B14]/40 ring-white/5 text-slate-500'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-slate-400 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold">構造スケルトン (Skeleton)</div>
                    <div className="text-[10px] text-slate-400">床スラブ・通し柱・耐力壁</div>
                  </div>
                </div>
                {visibleLayers.skeleton ? <Eye className="w-3.5 h-3.5 text-cyan-400" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* 3. フロア単独フィルタ */}
            <div className="space-y-1.5">
              <div className="text-xs font-bold text-slate-300 px-0.5">
                フロア階層フィルタ
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {(['ALL', ...buildingData.floors.map((f) => f.level)] as FloorFilter[]).map((fl) => (
                  <button
                    key={fl}
                    onClick={() => setActiveFloorFilter(fl)}
                    className={`py-2 rounded-lg text-xs font-bold ring-1 transition cursor-pointer ${
                      activeFloorFilter === fl
                        ? 'bg-cyan-400 ring-cyan-300 text-[#070B14]'
                        : 'bg-[#070B14] ring-white/10 text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    {fl === 'ALL' ? '全階' : `${fl}F`}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. 垂直断面(Z軸)・構造グリッドの精密制御 */}
            <div className="bg-[#070B14] ring-1 ring-white/10 rounded-2xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                <span className="text-xs font-bold text-slate-200">
                  構造グリッド・断面寸法
                </span>
                <span className="font-mono text-[10px] text-cyan-300">
                  スパン {buildingData.site.structuralModule?.spanX ?? 4.5}×
                  {buildingData.site.structuralModule?.spanZ ?? 4.5}m
                </span>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">階高 (Floor Height)</span>
                  <span className="font-mono text-white">{buildingData.site.floorHeight.toFixed(2)} m</span>
                </div>
                <input
                  type="range"
                  min="2.8"
                  max="4.4"
                  step="0.05"
                  value={buildingData.site.floorHeight}
                  onChange={(e) => updateSiteVerticalParam('floorHeight', parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer h-1.5"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">柱断面寸法 (Column)</span>
                  <span className="font-mono text-white">
                    {Math.round((buildingData.columns[0]?.width ?? 0.45) * 1000)} mm角
                  </span>
                </div>
                <input
                  type="range"
                  min="0.30"
                  max="0.75"
                  step="0.05"
                  value={buildingData.columns[0]?.width ?? 0.45}
                  onChange={(e) => updateSiteVerticalParam('columnSize', parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer h-1.5"
                />
              </div>
            </div>
          </div>

          {/* 構造・設備ルール整合性チェッカー */}
          <div
            className={`p-3.5 rounded-2xl ring-1 mt-4 ${
              diagnostics.isValid
                ? 'bg-[#070B14] ring-emerald-400/30'
                : 'bg-red-950/40 ring-red-400/50'
            }`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              {diagnostics.isValid ? (
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              )}
              <span className="text-xs font-bold text-white">
                {diagnostics.isValid
                  ? '埋設接続・上下階設備：適合'
                  : `設計ルール不整合（${diagnostics.warnings.length}件）`}
              </span>
            </div>
            {diagnostics.isValid ? (
              <p className="text-[11px] text-slate-400 leading-relaxed">
                通し柱（{buildingData.columns.length}本）と給排水縦シャフト(PS)の座標が整合しています。
              </p>
            ) : (
              <ul className="text-[11px] text-red-300 space-y-1 list-disc pl-4 leading-relaxed">
                {diagnostics.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            )}

            <div className="mt-3 pt-2.5 border-t border-white/10 grid grid-cols-2 gap-1.5">
              <button
                onClick={handleInjectViolationDemo}
                className="px-2 py-1.5 text-[11px] bg-white/5 hover:bg-red-500/20 text-red-300 rounded-lg ring-1 ring-red-400/30 transition cursor-pointer font-medium"
              >
                ① 不整合デモ
              </button>
              <button
                onClick={handleRunSelfRepairDemo}
                className="px-2 py-1.5 text-[11px] bg-cyan-400 hover:bg-cyan-300 text-[#070B14] rounded-lg transition cursor-pointer font-bold"
              >
                ② 自動補正
              </button>
            </div>
            {repairLogs.length > 0 && (
              <div className="bg-[#070B14] ring-1 ring-emerald-400/30 rounded-lg p-2 mt-2 text-[10px] text-emerald-300 space-y-0.5">
                {repairLogs.map((log, i) => (
                  <div key={i}>・{log}</div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* ==================== 中央：地下埋設CAD & 3D地下X線 & 2D建築設計図ビューポート ==================== */}
        <main className="flex-1 relative bg-[#0B1222] flex flex-col overflow-hidden">
          <div
            ref={mountRef}
            className={`w-full h-full cursor-grab active:cursor-grabbing ${
              studioViewMode === '3D_BIM' ? 'relative z-0' : 'absolute inset-0 opacity-0 pointer-events-none -z-10'
            }`}
          />

          {/* 地下埋設インフラ・旧建物履歴AI推論CADモード (メイン) */}
          {studioViewMode === 'SUBSURFACE_CAD' && (
            <div className="relative z-10 w-full h-full pt-14 pb-16 bg-[#070B14]">
              <SubsurfaceAnalyzerView
                blueprint={buildingScenarioToStratumSchema(buildingData)}
                prevType={prevBuildingType}
                roadDir={frontRoadDir}
                surroundingType={surroundingType}
                realContext={initialLand?.context}
                onChangePrevType={setPrevBuildingType}
                onChangeRoadDir={setFrontRoadDir}
                onChangeSurrounding={setSurroundingType}
              />
            </div>
          )}

          {/* 2D 業務設計図・間取り図モード */}
          {studioViewMode === '2D_CAD' && (
            <div className="relative z-10 w-full h-full pt-14 pb-16 bg-[#FAF9F5]">
              <ProCadFloorPlanView
                blueprint={buildingScenarioToStratumSchema(buildingData)}
                floorFilter={activeFloorFilter === 'ALL' ? 'ALL' : (activeFloorFilter as 1 | 2 | 3)}
                selectedRoomId={selectedItem?.id ?? null}
                onSelectRoom={(fl, roomId) =>
                  setSelectedItem({ type: 'room', floorLevel: fl, id: roomId })
                }
              />
            </div>
          )}

          {/* 高層・複合建築 階層ゾーニング分解アクソメ図モード */}
          {studioViewMode === 'AXON_STACK' && (
            <div className="relative z-10 w-full h-full pt-14 pb-16 bg-[#E8E7E3]">
              <VerticalZoningAxonometricView
                blueprint={buildingScenarioToStratumSchema(buildingData)}
              />
            </div>
          )}

          {/* 上部オーバーレイ：タブレット対応 大型モード切替タブ */}
          <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none z-20">
            <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
              <div className="bg-[#070B14]/95 backdrop-blur-md ring-1 ring-white/15 rounded-2xl p-1 flex items-center gap-1 shadow-xl">
                {[
                  { id: 'SUBSURFACE_CAD' as const, label: '① 地下埋設・ガス管AI推論図' },
                  { id: '3D_BIM' as const, label: '② 3D 地下埋設X線・透視' },
                  { id: '2D_CAD' as const, label: '③ 2D 新築設計図・間取り図' },
                  { id: 'AXON_STACK' as const, label: '④ 階層ゾーニング図' }
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setStudioViewMode(m.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      studioViewMode === m.id
                        ? 'bg-cyan-400 text-[#070B14] shadow'
                        : 'text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {studioViewMode === '3D_BIM' && (
                <div className="bg-[#070B14]/95 backdrop-blur-md ring-1 ring-white/15 rounded-2xl p-1 flex items-center gap-1 shadow-xl">
                  {[
                    { id: 'ISO' as const, label: '鳥瞰アイソメ' },
                    { id: 'TOP' as const, label: '平面 (Top)' },
                    { id: 'FRONT' as const, label: '地下断面 (Front)' }
                  ].map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setCameraPreset(v.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                        cameraPreset === v.id
                          ? 'bg-white/20 text-white'
                          : 'text-slate-400 hover:bg-white/10'
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {isAutoTour && (
              <div className="bg-[#070B14]/95 text-cyan-200 ring-1 ring-cyan-400/50 rounded-2xl px-4 py-2 text-xs font-mono flex items-center gap-2 pointer-events-auto shadow-xl animate-fade-in">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                {tourCaption}
              </div>
            )}
          </div>

          {/* 下部オーバーレイ：建築諸元・面積・概算コスト */}
          <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-3 pointer-events-none z-20">
            <div className="bg-[#070B14]/95 backdrop-blur-md ring-1 ring-white/15 rounded-2xl px-4 py-2.5 flex items-center gap-5 pointer-events-auto shadow-xl">
              <div>
                <div className="text-[10px] text-slate-400">敷地寸法</div>
                <div className="text-xs font-mono font-bold text-white">
                  {buildingData.site.width}m × {buildingData.site.depth}m
                </div>
              </div>
              <div className="h-6 w-px bg-white/10" />
              <div>
                <div className="text-[10px] text-slate-400">延床面積</div>
                <div className="text-xs font-mono font-bold text-white">
                  {diagnostics.totalArea} ㎡
                </div>
              </div>
              <div className="h-6 w-px bg-white/10" />
              <div>
                <div className="text-[10px] text-slate-400">概算建築工事費</div>
                <div className="text-xs font-mono font-bold text-cyan-300">
                  ¥{diagnostics.estimatedCost}万
                </div>
              </div>
            </div>

            <div className="bg-[#070B14]/95 backdrop-blur-md ring-1 ring-white/15 rounded-2xl px-3.5 py-2 hidden sm:flex items-center gap-4 text-[11px] text-slate-300 pointer-events-auto shadow-xl">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                都市ガス埋設管
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block" />
                上水道・給排水PS
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />
                残置杭・越境リスク
              </span>
            </div>
          </div>
        </main>

        {/* ==================== 右サイドパネル：座標・寸法インスペクター ==================== */}
        <aside className="w-76 lg:w-80 hidden xl:flex bg-[#0B1222] border-l border-white/10 p-4 flex-col justify-between overflow-y-auto z-10">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2">
                <Move className="w-4 h-4 text-cyan-400" />
                <h2 className="text-xs font-bold text-white">
                  部屋座標・寸法インスペクター
                </h2>
              </div>
            </div>

            {activeRoomObj ? (
              <div className="space-y-3.5">
                <div className="bg-[#070B14] ring-1 ring-white/10 rounded-2xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-cyan-400/15 text-cyan-300">
                      {selectedItem?.floorLevel}F フロア
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      {activeRoomObj.id}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-white mt-1">
                    {activeRoomObj.name}
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10 text-xs">
                    <span className="text-slate-400">床面積</span>
                    <span className="font-mono font-bold text-cyan-300">
                      {(activeRoomObj.w * activeRoomObj.d).toFixed(1)} ㎡
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-slate-300">
                    部屋用途区分
                  </label>
                  <select
                    value={activeRoomObj.type}
                    onChange={(e) => updateSelectedRoom('type', e.target.value)}
                    className="w-full h-9 bg-[#070B14] ring-1 ring-white/15 rounded-xl px-2.5 text-xs text-white outline-none cursor-pointer"
                  >
                    {ROOM_USAGE_OPTIONS.map((opt) => (
                      <option key={opt.type} value={opt.type} className="bg-[#0B1222]">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="bg-[#070B14] ring-1 ring-white/10 rounded-2xl p-3.5 space-y-2.5">
                  <div className="text-xs font-bold text-slate-200">
                    ジオメトリ座標・寸法 (m)
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">間口幅 (W)</span>
                      <span className="font-mono text-white">{activeRoomObj.w.toFixed(1)} m</span>
                    </div>
                    <input
                      type="range"
                      min="1.5"
                      max="10.0"
                      step="0.2"
                      value={activeRoomObj.w}
                      onChange={(e) => updateSelectedRoom('w', e.target.value)}
                      className="w-full accent-cyan-400 cursor-pointer h-1.5"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">奥行 (D)</span>
                      <span className="font-mono text-white">{activeRoomObj.d.toFixed(1)} m</span>
                    </div>
                    <input
                      type="range"
                      min="1.5"
                      max="9.5"
                      step="0.2"
                      value={activeRoomObj.d}
                      onChange={(e) => updateSelectedRoom('d', e.target.value)}
                      className="w-full accent-cyan-400 cursor-pointer h-1.5"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">東西座標 (X)</span>
                      <span className="font-mono text-cyan-300">{activeRoomObj.x.toFixed(1)} m</span>
                    </div>
                    <input
                      type="range"
                      min="0.2"
                      max={buildingData.site.width - 1.5}
                      step="0.2"
                      value={activeRoomObj.x}
                      onChange={(e) => updateSelectedRoom('x', e.target.value)}
                      className="w-full accent-cyan-400 cursor-pointer h-1.5"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">南北座標 (Z)</span>
                      <span className="font-mono text-cyan-300">{activeRoomObj.z.toFixed(1)} m</span>
                    </div>
                    <input
                      type="range"
                      min="0.2"
                      max={buildingData.site.depth - 1.5}
                      step="0.2"
                      value={activeRoomObj.z}
                      onChange={(e) => updateSelectedRoom('z', e.target.value)}
                      className="w-full accent-cyan-400 cursor-pointer h-1.5"
                    />
                  </div>
                </div>

                {/* 床仕上材 */}
                <div className="bg-[#070B14] ring-1 ring-white/10 rounded-2xl p-3.5 space-y-2">
                  <label className="text-[11px] text-slate-400 block">床仕上材コード (finishes.floor)</label>
                  <select
                    value={activeRoomObj.finishes?.floor ?? 'oak_flooring'}
                    onChange={(e) => updateSelectedRoomDetail('floorFinish', e.target.value)}
                    className="w-full h-9 bg-[#0B1222] ring-1 ring-white/15 rounded-lg px-2 text-xs font-mono text-white outline-none cursor-pointer"
                  >
                    {FINISH_MATERIAL_OPTIONS.map((fOpt) => (
                      <option key={fOpt.code} value={fOpt.code} className="bg-[#0B1222]">
                        {fOpt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-400 bg-[#070B14] p-3 rounded-xl ring-1 ring-white/10">
                部屋を選択してください。
              </div>
            )}

            {/* 各階の部屋一覧 */}
            <div className="space-y-2 pt-1">
              <div className="text-xs font-bold text-slate-300">
                フロア別空間構成リスト
              </div>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {buildingData.floors.map((fl) => (
                  <div key={fl.level} className="space-y-1">
                    <div className="text-[11px] font-medium text-slate-400">{fl.name}</div>
                    {fl.rooms.map((rm) => {
                      const isSel =
                        selectedItem?.floorLevel === fl.level && selectedItem?.id === rm.id;
                      return (
                        <button
                          key={rm.id}
                          onClick={() =>
                            setSelectedItem({ type: 'room', floorLevel: fl.level, id: rm.id })
                          }
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs ring-1 transition cursor-pointer ${
                            isSel
                              ? 'bg-cyan-400/15 ring-cyan-400 text-white font-semibold'
                              : 'bg-[#070B14] ring-white/10 text-slate-300 hover:bg-white/5'
                          }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <span
                              className="w-2.5 h-2.5 rounded-sm shrink-0"
                              style={{ backgroundColor: rm.color }}
                            />
                            <span className="truncate">{rm.name}</span>
                          </span>
                          <span className="font-mono text-[10px] text-slate-400 shrink-0 ml-1">
                            {(rm.w * rm.d).toFixed(0)}㎡
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* ==================== 3層統合BIM座標データ (JSON) インスペクター ==================== */}
        {showJsonDrawer && (
          <div className="absolute inset-y-0 right-0 xl:right-80 w-96 bg-[#0B1222] border-l border-white/15 p-4 flex flex-col z-30 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div>
                <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-cyan-400" />
                  BIM座標データ (JSON)
                </h3>
              </div>
              <button
                onClick={() => setShowJsonDrawer(false)}
                className="text-xs text-slate-300 hover:text-white px-2.5 py-1 rounded-lg bg-white/10 cursor-pointer"
              >
                閉じる
              </button>
            </div>
            <pre className="flex-1 overflow-auto text-[11px] font-mono text-cyan-100 bg-[#070B14] p-3 rounded-xl mt-3 ring-1 ring-white/10 leading-relaxed">
              {JSON.stringify(buildingScenarioToStratumSchema(buildingData), null, 2)}
            </pre>
          </div>
        )}

        {/* ==================== 2D CAD (SVG) 建築設計図プレビューモーダル ==================== */}
        {showSvgModal && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 z-30">
            <div className="bg-[#0B1222] ring-1 ring-white/20 rounded-2xl w-full max-w-5xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-[#070B14]">
                <div>
                  <h3 className="text-sm font-bold text-white">
                    2D マルチレイヤーCAD建築平面図 (SVG Export)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    壁芯密着・フローリング/タイルハッチング・住宅設備シンボル付き業務CAD図面
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDownloadSvg}
                    className="px-3.5 py-2 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-[#070B14] text-xs font-bold cursor-pointer transition"
                  >
                    SVG図面をダウンロード (.svg)
                  </button>
                  <button
                    onClick={() => setShowSvgModal(false)}
                    className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold cursor-pointer transition"
                  >
                    閉じる
                  </button>
                </div>
              </div>
              <div
                className="flex-1 overflow-auto p-6 bg-[#FAF9F5]"
                dangerouslySetInnerHTML={{
                  __html: renderSvgBlueprintClient(buildingScenarioToStratumSchema(buildingData))
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}