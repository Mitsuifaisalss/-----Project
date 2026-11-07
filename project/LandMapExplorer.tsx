import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from 'react';
import {
  ArrowLeft,
  Search,
  LocateFixed,
  Plus,
  Minus,
  Layers,
  ScanLine,
  X,
  Box,
  ClipboardList,
  MapPin,
  AlertTriangle,
  RotateCw,
  Database,
  FileCode2
} from 'lucide-react';
import { PRESET_SCENARIOS, buildingScenarioToStratumSchema, type StratumArchBIMSchema } from './ai_bim_3d';
import {
  inferLandSubsurface,
  renderSubsurfaceSurveyCadSvg,
  PREVIOUS_BUILDING_OPTIONS,
  FRONT_ROAD_OPTIONS,
  SURROUNDING_OPTIONS,
  type PreviousBuildingType,
  type FrontRoadDirection,
  type SurroundingContextType,
  type RealSiteContext
} from './SubsurfaceInferenceEngine';
import { renderProArchitecturalCadSvg } from './ArchitecturalDrawings';
import { analyzeRealSite, SAMPLE_FIELD_SITES, type SiteAnalysisResult, type Pt, type PresetFieldSite } from './realSiteData';

// ==========================================
// 地図タイル（国土地理院タイル）
// ==========================================
type BaseLayer = 'std' | 'photo' | 'old';
const LAYERS: Record<BaseLayer, { label: string; url: (z: number, x: number, y: number) => string; maxZoom: number }> = {
  std: { label: '標準地図', url: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/std/${z}/${x}/${y}.png`, maxZoom: 18 },
  photo: {
    label: '現在の航空写真',
    url: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${z}/${x}/${y}.jpg`,
    maxZoom: 18
  },
  old: {
    label: '1974-78年 航空写真（旧建物の確認）',
    url: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/gazo1/${z}/${x}/${y}.jpg`,
    maxZoom: 17
  }
};

const TILE = 256;
const lngToPx = (lng: number, z: number) => ((lng + 180) / 360) * TILE * 2 ** z;
const latToPx = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
};
const pxToLng = (px: number, z: number) => (px / (TILE * 2 ** z)) * 360 - 180;
const pxToLat = (py: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * py) / (TILE * 2 ** z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};
const metersPerPx = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

// ==========================================
// 選択土地（スタジオ・新築設計ウィザードへ受け渡し）
// ==========================================
export interface SelectedLand {
  lat: number;
  lng: number;
  center: Pt; // タップ点から敷地中心へのオフセット[m]
  width: number;
  depth: number;
  address: string;
  accurateTitle?: string;
  siteStatus?: 'existing_building' | 'vacant_lot' | 'parking_lot';
  sitePolygon?: Pt[];
  buildingPolygon?: Pt[] | null;
  edgeLengths?: number[];
  prevType: PreviousBuildingType;
  roadDir: FrontRoadDirection;
  surrounding: SurroundingContextType;
  context: RealSiteContext;
}

export function blueprintForLand(land: {
  width: number;
  depth: number;
  prevType?: PreviousBuildingType;
  siteStatus?: 'existing_building' | 'vacant_lot' | 'parking_lot';
  context?: RealSiteContext;
}): StratumArchBIMSchema {
  const isVacant =
    land.siteStatus === 'vacant_lot' ||
    land.siteStatus === 'parking_lot' ||
    land.context?.siteStatus === 'vacant_lot' ||
    land.context?.siteStatus === 'parking_lot';

  const presetKey =
    land.prevType === 'heisei_rc_clinic'
      ? 'clinic_residence'
      : land.prevType === 'old_factory_cleaner'
      ? 'cafe_office'
      : land.prevType === 'rowhouse_apartments'
      ? 'garage_house_3f'
      : 'family_house_4ldk';
  const bp = buildingScenarioToStratumSchema(PRESET_SCENARIOS[presetKey]);
  bp.site.width = land.width;
  bp.site.depth = land.depth;

  if (isVacant) {
    // 建物なし・更地・駐車場：存在しない4LDK住宅の間取りを勝手に表示せず、空地として保持
    bp.rooms = [];
    bp.skeleton.columns = [];
    bp.skeleton.beams = [];
    bp.site.floors = 1;
  }
  return bp;
}

interface Props {
  onBack: () => void;
  onOpenStudio: (land: SelectedLand) => void;
  onPlanBuilding: (land: SelectedLand) => void;
  initialPresetId?: string;
}

const RISK_STYLE: Record<string, string> = {
  HIGH: 'bg-red-500/15 text-red-300 ring-red-400/40',
  MEDIUM: 'bg-amber-500/15 text-amber-300 ring-amber-400/40',
  LOW: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40'
};
const PIPE_COLOR: Record<string, string> = {
  gas_low: '#F59E0B',
  gas_medium: '#F97316',
  water_supply: '#38BDF8',
  sewer_Foul: '#C08457',
  storm_drain: '#84CC16',
  power_Loops: '#A78BFA'
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading'; lat: number; lng: number }
  | { kind: 'error'; lat: number; lng: number; msg: string }
  | { kind: 'done' };

export default function LandMapExplorer({ onBack, onOpenStudio, onPlanBuilding, initialPresetId }: Props) {
  const [center, setCenter] = useState({ lat: 35.6466, lng: 139.6533 });
  const [zoom, setZoom] = useState(18);
  const [layer, setLayer] = useState<BaseLayer>('photo');
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [site, setSite] = useState<SiteAnalysisResult | null>(null);
  const [overrides, setOverrides] = useState<{ prev?: PreviousBuildingType; road?: FrontRoadDirection; sur?: SurroundingContextType }>({});
  const [query, setQuery] = useState('');
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [tab, setTab] = useState<'drawing' | 'result' | 'evidence'>('drawing');
  const [drawingMode, setDrawingMode] = useState<'subsurface' | 'floorplan'>('subsurface');
  const [showFoundationOverlay, setShowFoundationOverlay] = useState<boolean>(true);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragStart = useRef({ x: 0, y: 0, moved: false });
  const pinchDist = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const effZoom = Math.min(zoom, LAYERS[layer].maxZoom);

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const originX = lngToPx(center.lng, effZoom) - size.w / 2;
  const originY = latToPx(center.lat, effZoom) - size.h / 2;

  const tiles = useMemo(() => {
    const out: { key: string; src: string; left: number; top: number }[] = [];
    const max = 2 ** effZoom;
    for (let x = Math.floor(originX / TILE); x <= Math.floor((originX + size.w) / TILE); x++) {
      for (let y = Math.floor(originY / TILE); y <= Math.floor((originY + size.h) / TILE); y++) {
        if (y < 0 || y >= max) continue;
        out.push({
          key: `${layer}-${effZoom}-${x}-${y}`,
          src: LAYERS[layer].url(effZoom, ((x % max) + max) % max, y),
          left: x * TILE - originX,
          top: y * TILE - originY
        });
      }
    }
    return out;
  }, [originX, originY, size, effZoom, layer]);

  const land: SelectedLand | null = useMemo(
    () =>
      site
        ? {
            lat: site.lat,
            lng: site.lng,
            center: site.targetBuilding?.centroid ?? { x: 0, z: 0 },
            width: site.width,
            depth: site.depth,
            address: site.address,
            accurateTitle: site.accurateTitle,
            siteStatus: site.siteStatus,
            sitePolygon: site.sitePolygon,
            buildingPolygon: site.buildingPolygon,
            edgeLengths: site.edgeLengths,
            prevType: overrides.prev ?? site.prevType,
            roadDir: overrides.road ?? site.roadDir,
            surrounding: overrides.sur ?? site.surrounding,
            context: site.context
          }
        : null,
    [site, overrides]
  );

  const landBlueprint = useMemo(() => (land ? blueprintForLand(land) : null), [land]);

  const analysis = useMemo(
    () => (land && landBlueprint ? inferLandSubsurface(landBlueprint, land.prevType, land.roadDir, land.surrounding, land.context) : null),
    [land, landBlueprint]
  );

  const subsurfaceSvgMarkup = useMemo(
    () => (landBlueprint && analysis ? renderSubsurfaceSurveyCadSvg(landBlueprint, analysis, showFoundationOverlay) : ''),
    [landBlueprint, analysis, showFoundationOverlay]
  );

  const floorPlanSvgMarkup = useMemo(
    () =>
      landBlueprint
        ? renderProArchitecturalCadSvg(landBlueprint, {
            floorFilter: 1,
            cadTheme: 'presentation_color',
            labelStyle: 'japanese_tatami'
          })
        : '',
    [landBlueprint]
  );

  const runAnalysis = async (lat: number, lng: number, preset?: PresetFieldSite) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSite(null);
    setOverrides(
      preset
        ? { prev: preset.prevType, road: preset.roadDir, sur: preset.surrounding }
        : {}
    );
    setTab('drawing');
    setPhase({ kind: 'loading', lat, lng });
    try {
      const result = await analyzeRealSite(lat, lng, ac.signal);
      setSite(result);
      setPhase({ kind: 'done' });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setPhase({
        kind: 'error',
        lat,
        lng,
        msg: '地図データサーバーに接続できませんでした。通信環境を確認して再試行してください。'
      });
    }
  };

  useEffect(() => {
    const preset = SAMPLE_FIELD_SITES.find((s) => s.id === initialPresetId);
    if (preset) {
      setCenter({ lat: preset.lat, lng: preset.lng });
      setZoom(18);
      runAnalysis(preset.lat, preset.lng, preset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPresetId]);

  const handleSelectPresetSite = (preset: PresetFieldSite) => {
    setCenter({ lat: preset.lat, lng: preset.lng });
    setZoom(18);
    runAnalysis(preset.lat, preset.lng, preset);
  };

  // ---------- ポインタ操作（マウス・タッチ・ペン共通） ----------
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) dragStart.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist.current === null) pinchDist.current = d;
      else if (d / pinchDist.current > 1.35) {
        setZoom((z) => Math.min(18, z + 1));
        pinchDist.current = d;
      } else if (d / pinchDist.current < 0.74) {
        setZoom((z) => Math.max(12, z - 1));
        pinchDist.current = d;
      }
      dragStart.current.moved = true;
      return;
    }
    if (Math.hypot(e.clientX - dragStart.current.x, e.clientY - dragStart.current.y) > 6) dragStart.current.moved = true;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    setCenter((c) => ({
      lat: pxToLat(latToPx(c.lat, effZoom) - dy, effZoom),
      lng: pxToLng(lngToPx(c.lng, effZoom) - dx, effZoom)
    }));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchDist.current = null;
    if (wasSingle && !dragStart.current.moved && mapRef.current) {
      const rect = mapRef.current.getBoundingClientRect();
      runAnalysis(pxToLat(originY + e.clientY - rect.top, effZoom), pxToLng(originX + e.clientX - rect.left, effZoom));
    }
  };
  const onWheel = (e: ReactWheelEvent) => setZoom((z) => Math.max(12, Math.min(18, z + (e.deltaY < 0 ? 1 : -1))));

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearchMsg('検索中…');
    try {
      const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const [lng, lat] = data[0].geometry.coordinates;
        setCenter({ lat, lng });
        setZoom(18);
        setSearchMsg(null);
        runAnalysis(lat, lng);
      } else setSearchMsg('見つかりません');
    } catch {
      setSearchMsg('接続できません');
    }
  };
  const handleLocate = () => {
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        setCenter({ lat: p.coords.latitude, lng: p.coords.longitude });
        setZoom(18);
        runAnalysis(p.coords.latitude, p.coords.longitude);
      },
      () => setSearchMsg('位置情報を取得できません')
    );
  };

  // ---------- 地図オーバーレイ（ローカル[m] → 画面px） ----------
  const anchor = phase.kind === 'loading' || phase.kind === 'error' ? { lat: phase.lat, lng: phase.lng } : site;
  const proj = useMemo(() => {
    if (!anchor) return null;
    const mpp = metersPerPx(anchor.lat, effZoom);
    const ax = lngToPx(anchor.lng, effZoom) - originX;
    const ay = latToPx(anchor.lat, effZoom) - originY;
    return { mpp, ax, ay, p: (pt: Pt) => [ax + pt.x / mpp, ay + pt.z / mpp] as const };
  }, [anchor, effZoom, originX, originY]);
  const polyStr = (poly: Pt[]) => (proj ? poly.map((pt) => proj.p(pt).join(',')).join(' ') : '');

  const panelOpen = phase.kind !== 'idle';
  const conf = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="fixed inset-0 bg-[#070B14] text-slate-100 flex flex-col md:flex-row select-none antialiased">
      {/* ===== 地図エリア ===== */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={mapRef}
          className="absolute inset-0 overflow-hidden touch-none cursor-crosshair bg-slate-900"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {tiles.map((t) => (
            <img
              key={t.key}
              src={t.src}
              alt=""
              draggable={false}
              className="absolute pointer-events-none"
              style={{ left: t.left, top: t.top, width: TILE, height: TILE }}
            />
          ))}

          {proj && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {site?.neighbors.map((b) => (
                <polygon
                  key={b.id}
                  points={polyStr(b.poly)}
                  fill="rgba(148,163,184,0.22)"
                  stroke="#CBD5E1"
                  strokeWidth={1.2}
                />
              ))}
              {site?.targetBuilding && (
                <polygon
                  points={polyStr(site.targetBuilding.poly)}
                  fill="rgba(251,191,36,0.20)"
                  stroke="#FBBF24"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                />
              )}
              {land && (
                <rect
                  x={proj.ax + (land.center.x - land.width / 2) / proj.mpp}
                  y={proj.ay + (land.center.z - land.depth / 2) / proj.mpp}
                  width={land.width / proj.mpp}
                  height={land.depth / proj.mpp}
                  fill="rgba(34,211,238,0.14)"
                  stroke="#22D3EE"
                  strokeWidth={2.5}
                />
              )}
              {land &&
                analysis &&
                analysis.pipes.map((pp) => {
                  const [x1, y1] = proj.p({ x: land.center.x + pp.x1, z: land.center.z + pp.z1 });
                  const [x2, y2] = proj.p({ x: land.center.x + pp.x2, z: land.center.z + pp.z2 });
                  return (
                    <line
                      key={pp.id}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={pp.status === 'cross_border_risk' ? '#EF4444' : PIPE_COLOR[pp.kind]}
                      strokeWidth={pp.id.startsWith('MAIN-') ? 4.5 : 3.2}
                      strokeDasharray={pp.status === 'active' ? undefined : '7 4'}
                      strokeLinecap="round"
                    />
                  );
                })}
              {land &&
                analysis &&
                analysis.obstacles.map((o) => {
                  const [ox, oy] = proj.p({ x: land.center.x + o.x, z: land.center.z + o.z });
                  const w = Math.max(10, o.w / proj.mpp);
                  const h = Math.max(10, o.d / proj.mpp);
                  return (
                    <rect
                      key={o.id}
                      x={ox - w / 2}
                      y={oy - h / 2}
                      width={w}
                      height={h}
                      fill="rgba(239,68,68,0.42)"
                      stroke="#F87171"
                      strokeWidth={1.6}
                    />
                  );
                })}
              {phase.kind === 'loading' && (
                <>
                  <circle
                    cx={proj.ax}
                    cy={proj.ay}
                    r={70 / proj.mpp}
                    fill="rgba(34,211,238,0.10)"
                    stroke="#22D3EE"
                    strokeWidth={1.8}
                    strokeDasharray="4 4"
                    className="animate-pulse"
                  />
                  <circle cx={proj.ax} cy={proj.ay} r={6} fill="#22D3EE" />
                </>
              )}
            </svg>
          )}
        </div>

        {/* 上部：戻る・住所検索＋現地プリセットワンタップバー */}
        <div className="absolute top-3 left-3 right-18 flex flex-col gap-2 pointer-events-none">
          <div className="flex gap-2">
            <button
              onClick={onBack}
              aria-label="戻る"
              className="pointer-events-auto h-12 w-12 shrink-0 grid place-items-center rounded-2xl bg-[#070B14]/90 backdrop-blur-md ring-1 ring-white/15 hover:bg-[#111A2E] cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSearch();
              }}
              className="pointer-events-auto flex-1 max-w-xl h-12 flex items-center gap-2 px-4 rounded-2xl bg-[#070B14]/90 backdrop-blur-md ring-1 ring-white/15 focus-within:ring-cyan-400/70"
            >
              <Search className="w-5 h-5 text-cyan-400 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="調査したい住所・地名を入力（例：世田谷区若林 / 文京区本郷）"
                className="flex-1 min-w-0 bg-transparent outline-none text-sm sm:text-base placeholder:text-slate-400"
              />
              {searchMsg && <span className="text-xs text-cyan-300 shrink-0">{searchMsg}</span>}
            </form>
          </div>

          {/* タブレット向けワンタップ現地調査プリセットチップ */}
          <div className="pointer-events-auto flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            {SAMPLE_FIELD_SITES.map((s) => {
              const isSelected = site && Math.hypot(site.lat - s.lat, site.lng - s.lng) < 0.0018;
              return (
                <button
                  key={s.id}
                  onClick={() => handleSelectPresetSite(s)}
                  className={`shrink-0 h-9 px-3.5 rounded-xl text-xs font-medium flex items-center gap-2 backdrop-blur-md ring-1 transition active:scale-95 cursor-pointer ${
                    isSelected
                      ? 'bg-cyan-400 text-[#070B14] ring-cyan-300 font-semibold shadow-lg shadow-cyan-500/20'
                      : 'bg-[#070B14]/85 text-slate-200 ring-white/15 hover:bg-[#111A2E]'
                  }`}
                >
                  <MapPin className={`w-3.5 h-3.5 ${isSelected ? 'text-[#070B14]' : 'text-cyan-400'}`} />
                  <span>{s.label}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                      isSelected ? 'bg-[#070B14]/20 text-[#070B14]' : 'bg-white/10 text-cyan-300'
                    }`}
                  >
                    {s.badge}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 右側：タブレット対応 48px 大型地図操作ボタン */}
        <div className="absolute right-3 top-3 flex flex-col gap-2">
          {[
            { icon: <Plus className="w-5 h-5" />, onClick: () => setZoom((z) => Math.min(18, z + 1)), label: '拡大' },
            { icon: <Minus className="w-5 h-5" />, onClick: () => setZoom((z) => Math.max(12, z - 1)), label: '縮小' },
            { icon: <LocateFixed className="w-5 h-5 text-cyan-400" />, onClick: handleLocate, label: '現在地' },
            { icon: <Layers className="w-5 h-5" />, onClick: () => setShowLayerMenu((v) => !v), label: '地図切替' }
          ].map((b) => (
            <button
              key={b.label}
              onClick={b.onClick}
              aria-label={b.label}
              className="h-12 w-12 grid place-items-center rounded-2xl bg-[#070B14]/90 backdrop-blur-md ring-1 ring-white/15 hover:bg-[#111A2E] active:scale-95 transition cursor-pointer"
            >
              {b.icon}
            </button>
          ))}
          {showLayerMenu && (
            <div className="absolute right-14 bottom-0 w-64 rounded-2xl bg-[#070B14]/95 backdrop-blur-md ring-1 ring-white/15 p-1.5 shadow-2xl">
              {(Object.keys(LAYERS) as BaseLayer[]).map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    setLayer(k);
                    setShowLayerMenu(false);
                  }}
                  className={`w-full text-left px-3 py-3 rounded-xl text-sm cursor-pointer ${
                    layer === k ? 'bg-cyan-400/20 text-cyan-300 font-semibold' : 'hover:bg-white/5 text-slate-200'
                  }`}
                >
                  {LAYERS[k].label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 地図凡例＆操作ガイド */}
        {!panelOpen && (
          <div className="absolute bottom-7 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl bg-[#070B14]/90 backdrop-blur-md ring-1 ring-cyan-400/40 text-sm flex items-center gap-2.5 animate-fade-up whitespace-nowrap shadow-xl">
            <MapPin className="w-4 h-4 text-cyan-400 animate-bounce" />
            <span>地図上の知りたい土地をタップすると、AIが地下埋設図と設計図を自動作成します</span>
          </div>
        )}
        <div className="absolute bottom-1.5 left-3 text-[10px] text-white/75 pointer-events-none drop-shadow">
          地図タイル：国土地理院 ／ 建物・道路ベクトル：© OpenStreetMap contributors
        </div>
      </div>

      {/* ===== AI地下埋設図・設計図ドロワー（タブレット縦：下シート ／ タブレット横・PC：右ワイドパネル） ===== */}
      {panelOpen && (
        <aside className="w-full md:w-[520px] lg:w-[580px] max-h-[65vh] md:max-h-none md:h-full flex flex-col bg-[#0B1222] border-t md:border-t-0 md:border-l border-white/15 animate-fade-up shadow-2xl">
          <div className="md:hidden mx-auto mt-2 h-1.5 w-12 rounded-full bg-white/20" />
          <div className="px-5 pt-3.5 pb-3 flex items-start justify-between gap-3 border-b border-white/10">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-cyan-400 font-mono tracking-[0.16em] font-semibold">
                  AI LAND &amp; SUBSURFACE CAD
                </span>
                {analysis && (
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold ring-1 ${
                      RISK_STYLE[analysis.aiSummary.overallRiskLevel]
                    }`}
                  >
                    RISK: {analysis.aiSummary.overallRiskLevel}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="text-base sm:text-lg font-semibold truncate">
                  {site?.accurateTitle || site?.address || '土地をスキャン中…'}
                </div>
                {site && (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 ${
                      site.siteStatus === 'existing_building'
                        ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40'
                        : site.siteStatus === 'parking_lot'
                        ? 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-400/40'
                        : 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40'
                    }`}
                  >
                    {site.siteStatus === 'existing_building'
                      ? '実測建物あり'
                      : site.siteStatus === 'parking_lot'
                      ? '現況駐車場'
                      : '現況更地'}
                  </span>
                )}
              </div>
              {site && analysis && (
                <div className="text-xs text-slate-400 font-mono mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span>
                    区画 {site.width}m × {site.depth}m（{(site.width * site.depth).toFixed(1)}㎡）
                    {site.edgeLengths && `・実測多角形 ${site.edgeLengths.length}辺`}
                  </span>
                  <span className="text-amber-300">推論配管 {analysis.pipes.length}系統</span>
                  <span className="text-red-300">地中障害 {analysis.obstacles.length}箇所</span>
                </div>
              )}
            </div>
            <button
              onClick={() => {
                abortRef.current?.abort();
                setPhase({ kind: 'idle' });
                setSite(null);
              }}
              className="h-11 w-11 grid place-items-center rounded-xl hover:bg-white/10 shrink-0 cursor-pointer"
              aria-label="閉じる"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {phase.kind === 'loading' && (
            <div className="flex-1 grid place-items-center py-14">
              <div className="flex flex-col items-center gap-3 text-slate-200 text-sm text-center px-6">
                <ScanLine className="w-11 h-11 text-cyan-400 animate-pulse" />
                <div className="font-semibold text-base">AIが選択された土地と周辺環境を解析中…</div>
                <div className="text-xs text-slate-400">
                  周囲の建物・前面道路本管・旧建物履歴から地下ガス管と設計図を作成しています
                </div>
              </div>
            </div>
          )}

          {phase.kind === 'error' && (
            <div className="flex-1 grid place-items-center py-10 px-6">
              <div className="flex flex-col items-center gap-4 text-center">
                <AlertTriangle className="w-9 h-9 text-amber-400" />
                <p className="text-sm text-slate-300">{phase.msg}</p>
                <button
                  onClick={() => runAnalysis(phase.lat, phase.lng)}
                  className="h-12 px-6 rounded-xl bg-white/10 hover:bg-white/15 flex items-center gap-2 font-medium cursor-pointer"
                >
                  <RotateCw className="w-4 h-4" /> 再試行
                </button>
              </div>
            </div>
          )}

          {phase.kind === 'done' && site && land && analysis && (
            <>
              {/* タブレット向け大型3タブ（① AI生成図面 ／ ② 埋設リスク＆一覧 ／ ③ 実データ根拠・補正） */}
              <div className="px-4 flex gap-1 border-b border-white/10 bg-[#080D1A]">
                {(
                  [
                    ['drawing', '① AI自動作図 (CAD)'],
                    ['result', '② 埋設リスク・一覧'],
                    ['evidence', '③ 根拠・現地補正']
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setTab(k)}
                    className={`flex-1 h-12 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer ${
                      tab === k
                        ? 'border-cyan-400 text-cyan-300 bg-cyan-400/5'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {tab === 'drawing' && (
                  <div className="space-y-3">
                    {/* 図面切替ピル：地下埋設ガス管CAD図 vs 新築間取りCAD図 */}
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-white/[0.04] p-1.5 rounded-xl ring-1 ring-white/10">
                      <div className="flex gap-1 flex-1">
                        <button
                          onClick={() => setDrawingMode('subsurface')}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            drawingMode === 'subsurface'
                              ? 'bg-cyan-400 text-[#070B14] shadow'
                              : 'text-slate-300 hover:bg-white/5'
                          }`}
                        >
                          <FileCode2 className="w-3.5 h-3.5" />
                          地下埋設・ガス管推論図 (平面＋断面)
                        </button>
                        <button
                          onClick={() => setDrawingMode('floorplan')}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            drawingMode === 'floorplan'
                              ? 'bg-cyan-400 text-[#070B14] shadow'
                              : 'text-slate-300 hover:bg-white/5'
                          }`}
                        >
                          <ClipboardList className="w-3.5 h-3.5" />
                          AI新築1F間取り図 (埋設整合済)
                        </button>
                      </div>

                      {drawingMode === 'subsurface' && (
                        <label className="flex items-center gap-1.5 px-2 text-[11px] text-slate-300 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={showFoundationOverlay}
                            onChange={(e) => setShowFoundationOverlay(e.target.checked)}
                            className="accent-cyan-400 w-3.5 h-3.5"
                          />
                          新築1F基礎重ね表示
                        </label>
                      )}
                    </div>

                    {/* 要点サマリーバー */}
                    <div className="rounded-xl bg-cyan-500/10 ring-1 ring-cyan-400/30 px-3.5 py-2.5 text-xs text-cyan-100 leading-relaxed">
                      <strong className="text-cyan-300 font-semibold">AI解析サマリー：</strong>
                      {analysis.aiSummary.keyFindings[0]}
                    </div>

                    {/* AI生成CAD図面キャンバス */}
                    {drawingMode === 'subsurface' ? (
                      <div
                        className="rounded-2xl bg-[#FAF9F5] p-2.5 ring-1 ring-white/15 shadow-inner [&>svg]:w-full [&>svg]:h-auto"
                        dangerouslySetInnerHTML={{ __html: subsurfaceSvgMarkup }}
                      />
                    ) : land.siteStatus === 'existing_building' ? (
                      <div
                        className="rounded-2xl bg-[#FAF9F5] p-2.5 ring-1 ring-white/15 shadow-inner [&>svg]:w-full [&>svg]:h-auto"
                        dangerouslySetInnerHTML={{ __html: floorPlanSvgMarkup }}
                      />
                    ) : (
                      <div className="rounded-2xl bg-[#070B14] p-5 ring-1 ring-cyan-400/30 text-center space-y-3">
                        <div className="inline-flex p-3 rounded-full bg-cyan-400/10 text-cyan-300">
                          <ClipboardList className="w-7 h-7" />
                        </div>
                        <div className="text-sm font-semibold text-slate-100">
                          現況【{land.siteStatus === 'parking_lot' ? 'コインパーキング' : '更地'}】のため建物間取りはありません
                        </div>
                        <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                          架空の間取りは表示していません。敷地境界線（{land.edgeLengths ? `${land.edgeLengths.length}辺` : ''}）および前面道路からのガス・上下水道の引込状況は「地下埋設・ガス管推論図」にて正確に表示されています。
                        </p>
                        <button
                          onClick={() => onPlanBuilding(land)}
                          className="h-10 px-4 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-[#070B14] font-bold text-xs inline-flex items-center gap-1.5 shadow-md cursor-pointer transition active:scale-95"
                        >
                          <ClipboardList className="w-4 h-4" /> この土地の形状に合わせて新築プランを設計
                        </button>
                      </div>
                    )}

                    {/* 簡易変更セレクト（タブレットで図面を見ながら旧建物履歴を即座に切り替え可能） */}
                    <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-3 space-y-2">
                      <div className="text-[11px] text-slate-400 font-medium">
                        前回この土地に建っていた建物履歴（切り替えると上のAI埋設図が即時再計算されます）
                      </div>
                      <select
                        value={land.prevType}
                        onChange={(e) =>
                          setOverrides((s) => ({ ...s, prev: e.target.value as PreviousBuildingType }))
                        }
                        className="w-full h-11 rounded-xl bg-[#070B14] ring-1 ring-cyan-400/40 px-3 text-xs sm:text-sm text-white outline-none cursor-pointer"
                      >
                        {PREVIOUS_BUILDING_OPTIONS.map((o) => (
                          <option key={o.id} value={o.id} className="bg-[#0B1222]">
                            {o.title}（{o.era}）— {o.badge}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {tab === 'result' && (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <div className={`rounded-2xl ring-1 p-3 ${RISK_STYLE[analysis.aiSummary.overallRiskLevel]}`}>
                        <div className="text-[11px] opacity-80">埋設リスク</div>
                        <div className="text-xl font-bold">{analysis.aiSummary.overallRiskLevel}</div>
                      </div>
                      <div className="rounded-2xl ring-1 ring-white/10 bg-white/[0.03] p-3">
                        <div className="text-[11px] text-slate-400">埋設管</div>
                        <div className="text-xl font-bold">
                          {analysis.pipes.length}
                          <span className="text-xs font-normal ml-0.5">系統</span>
                        </div>
                      </div>
                      <div className="rounded-2xl ring-1 ring-white/10 bg-white/[0.03] p-3">
                        <div className="text-[11px] text-slate-400">撤去・試掘概算</div>
                        <div className="text-xl font-bold">
                          {analysis.aiSummary.estimatedSubsurfaceCostManYen}
                          <span className="text-xs font-normal ml-0.5">万円</span>
                        </div>
                      </div>
                    </div>

                    <ul className="space-y-2">
                      {analysis.aiSummary.keyFindings.map((f, i) => (
                        <li
                          key={i}
                          className="text-sm text-slate-300 leading-relaxed pl-3 border-l-2 border-cyan-400/60"
                        >
                          {f}
                        </li>
                      ))}
                    </ul>

                    <div className="space-y-1.5">
                      <div className="text-xs text-slate-400">推論された埋設物（敷地内）</div>
                      {analysis.pipes
                        .filter((p) => !p.id.startsWith('MAIN-'))
                        .map((p) => (
                          <div key={p.id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
                            <span
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{
                                background: p.status === 'cross_border_risk' ? '#EF4444' : PIPE_COLOR[p.kind]
                              }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm truncate">{p.label.replace('推論：', '')}</div>
                              <div className="text-[11px] text-slate-400 font-mono">
                                GL-{p.depth2.toFixed(2)}m ・ 確度 {conf(p.confidence)} ・ {p.reason}
                              </div>
                            </div>
                          </div>
                        ))}
                      {analysis.obstacles.map((o) => (
                        <div key={o.id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
                          <span className="w-3 h-3 rounded-sm shrink-0 bg-red-400" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm truncate">{o.label.replace('推論：', '')}</div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              GL-{o.depthTop}〜-{o.depthBottom}m ・ 撤去 約{o.removalCostManYen}万円
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {tab === 'evidence' && (
                  <>
                    <div className="space-y-1.5">
                      <div className="text-xs text-slate-400 flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5 text-cyan-400" /> 取得した実在GIS・オープンデータ根拠
                      </div>
                      {site.evidence.map((ev, i) => (
                        <div key={i} className="flex items-start gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
                          <span
                            className={`mt-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                              ev.source === '推定'
                                ? 'bg-amber-400/15 text-amber-300'
                                : 'bg-cyan-400/15 text-cyan-300'
                            }`}
                          >
                            {ev.source}
                          </span>
                          <div className="min-w-0">
                            <div className="text-[11px] text-slate-400">{ev.label}</div>
                            <div className="text-sm">{ev.value}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-3">
                      <div className="text-xs text-slate-400">AI判定（現地確認と異なる場合はタップして補正）</div>
                      {[
                        {
                          label: '解体・既存建物の種別',
                          conf: site.confidence.prev,
                          value: land.prevType,
                          opts: PREVIOUS_BUILDING_OPTIONS.map((o) => ({ id: o.id, label: o.title })),
                          set: (v: string) => setOverrides((s) => ({ ...s, prev: v as PreviousBuildingType }))
                        },
                        {
                          label: '前面道路（本管の方向）',
                          conf: site.confidence.road,
                          value: land.roadDir,
                          opts: FRONT_ROAD_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
                          set: (v: string) => setOverrides((s) => ({ ...s, road: v as FrontRoadDirection }))
                        },
                        {
                          label: '周辺環境',
                          conf: site.confidence.surrounding,
                          value: land.surrounding,
                          opts: SURROUNDING_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
                          set: (v: string) => setOverrides((s) => ({ ...s, sur: v as SurroundingContextType }))
                        }
                      ].map((f) => (
                        <div key={f.label}>
                          <div className="flex justify-between text-[11px] mb-1">
                            <span className="text-slate-300">{f.label}</span>
                            <span className={f.conf >= 0.7 ? 'text-emerald-300' : 'text-amber-300'}>
                              確度 {conf(f.conf)}
                            </span>
                          </div>
                          <select
                            value={f.value}
                            onChange={(e) => f.set(e.target.value)}
                            className="w-full h-12 rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 text-sm outline-none focus:ring-cyan-400/60 cursor-pointer"
                          >
                            {f.opts.map((o) => (
                              <option key={o.id} value={o.id} className="bg-[#0E1628]">
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      ヒント：右上の地図切替ボタンから「1974-78年 航空写真」を表示すると、昭和期に建っていた旧建物の配置を視覚的に照合できます。
                    </p>
                  </>
                )}
              </div>

              <div className="p-4 border-t border-white/10 bg-[#080D1A] grid grid-cols-2 gap-2.5">
                <button
                  onClick={() => onOpenStudio(land)}
                  className="h-12 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-[#070B14] font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition shadow-lg shadow-cyan-500/20 cursor-pointer"
                >
                  <Box className="w-5 h-5" /> 3D地下X線・詳細CAD
                </button>
                <button
                  onClick={() => onPlanBuilding(land)}
                  className="h-12 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition cursor-pointer"
                >
                  <ClipboardList className="w-5 h-5 text-cyan-400" /> この土地で新築計画
                </button>
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
