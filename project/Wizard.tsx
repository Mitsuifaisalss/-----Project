import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowLeft, Check, AlertCircle, Home, Building2, Compass, MapPin, Radar } from 'lucide-react';
import {
  PRESET_SCENARIOS,
  buildingScenarioToStratumSchema,
  type ScenarioKey,
  type StratumArchBIMSchema
} from './ai_bim_3d';
import {
  PREVIOUS_BUILDING_OPTIONS,
  FRONT_ROAD_OPTIONS,
  SURROUNDING_OPTIONS,
  inferLandSubsurface,
  renderSubsurfaceSurveyCadSvg,
  type PreviousBuildingType,
  type FrontRoadDirection,
  type SurroundingContextType,
  type RealSiteContext
} from './SubsurfaceInferenceEngine';
import type { SelectedLand } from './LandMapExplorer';

// ==========================================
// 選択肢の定義
// ==========================================
type BuildingTypeId =
  | 'family_house'
  | 'garage_house'
  | 'two_generation'
  | 'cafe_office'
  | 'clinic'
  | 'coworking'
  | 'research_lab';

type Orientation = 'northeast' | 'northwest' | 'southeast' | 'southwest';

interface BuildingTypeOption {
  id: BuildingTypeId;
  group: 'residential' | 'commercial';
  title: string;
  description: string;
  defaults: { width: number; depth: number; floors: number };
  fallbackPreset: ScenarioKey;
}

const BUILDING_TYPES: BuildingTypeOption[] = [
  {
    id: 'family_house',
    group: 'residential',
    title: '4LDK ファミリー戸建て',
    description: '玄関・LDK・和室・主寝室・子供部屋2室・バルコニー',
    defaults: { width: 10, depth: 9.5, floors: 2 },
    fallbackPreset: 'family_house_4ldk'
  },
  {
    id: 'garage_house',
    group: 'residential',
    title: 'ガレージ＆中庭のある家',
    description: 'ビルトインガレージ・2F大空間LDK・中庭デッキ',
    defaults: { width: 10, depth: 10, floors: 3 },
    fallbackPreset: 'garage_house_3f'
  },
  {
    id: 'two_generation',
    group: 'residential',
    title: '二世帯住宅',
    description: '1F親世帯（バリアフリー）・2F子世帯LDK・共有玄関',
    defaults: { width: 11, depth: 10, floors: 3 },
    fallbackPreset: 'family_house_4ldk'
  },
  {
    id: 'cafe_office',
    group: 'commercial',
    title: 'カフェ＆オフィス複合ビル',
    description: '1Fカフェ・上階オフィス・EV階段コア',
    defaults: { width: 12, depth: 10, floors: 3 },
    fallbackPreset: 'cafe_office'
  },
  {
    id: 'clinic',
    group: 'commercial',
    title: 'クリニック併用住宅',
    description: '1F診察・待合、上階は住居',
    defaults: { width: 14, depth: 10, floors: 3 },
    fallbackPreset: 'clinic_residence'
  },
  {
    id: 'coworking',
    group: 'commercial',
    title: 'コワーキングオフィス',
    description: 'ラウンジ・フレックス執務・会議室',
    defaults: { width: 14, depth: 12, floors: 4 },
    fallbackPreset: 'cafe_office'
  },
  {
    id: 'research_lab',
    group: 'commercial',
    title: '研究ラボ棟',
    description: '実験室・ウェットラボ・搬入ヤード',
    defaults: { width: 12, depth: 12, floors: 3 },
    fallbackPreset: 'research_lab'
  }
];

const SITE_PRESETS: { w: number; d: number; note: string }[] = [
  { w: 8, d: 8, note: '狭小地 約19坪' },
  { w: 10, d: 9.5, note: '標準 約29坪' },
  { w: 10, d: 10, note: '約30坪' },
  { w: 12, d: 10, note: '約36坪' },
  { w: 14, d: 12, note: '約51坪' },
  { w: 16, d: 14, note: '約68坪' }
];

const ORIENTATIONS: { id: Orientation; label: string }[] = [
  { id: 'northwest', label: '北西' },
  { id: 'northeast', label: '北東' },
  { id: 'southwest', label: '南西' },
  { id: 'southeast', label: '南東' }
];

interface VariantResult {
  label: string;
  title: string;
  prompt: string;
  blueprint: StratumArchBIMSchema;
  validation: { isValid: boolean; repairedCount: number; warnings: string[] };
  summary: { totalArea: number; roomCount: number; wetCount: number; floors: number };
}

interface WizardProps {
  onOpenStudio: (
    blueprint: StratumArchBIMSchema,
    prompt: string,
    landConfig?: {
      prevType: PreviousBuildingType;
      roadDir: FrontRoadDirection;
      surrounding: SurroundingContextType;
      context?: RealSiteContext;
    }
  ) => void;
  onBackToWelcome?: () => void;
  initialLand?: SelectedLand;
}

const API_ENDPOINTS = ['/api/generate-from-spec', 'http://127.0.0.1:8000/api/generate-from-spec'];

function r2(val: number): number {
  return Math.round(val * 100) / 100;
}

function generateClientVariants(
  selectedOpt: BuildingTypeOption,
  siteW: number,
  siteD: number,
  numFloors: number,
  orient: Orientation,
  summaryPrompt: string
): VariantResult[] {
  const baseScenario = PRESET_SCENARIOS[selectedOpt.fallbackPreset];
  const baseSchema = buildingScenarioToStratumSchema(baseScenario);

  const scaleX = siteW / baseSchema.site.width;
  const scaleZ = siteD / baseSchema.site.depth;
  const isRes = selectedOpt.group === 'residential';
  const floorHeight = isRes ? 2.9 : 3.6;

  const variantSpecs = [
    { label: 'A', title: '標準バランスプラン', mirrorX: orient === 'northwest' || orient === 'southwest', mirrorZ: orient.startsWith('south'), mainScale: 1.0 },
    { label: 'B', title: '左右反転コアプラン', mirrorX: !(orient === 'northwest' || orient === 'southwest'), mirrorZ: orient.startsWith('south'), mainScale: 1.0 },
    { label: 'C', title: isRes ? 'ワイドLDK・大空間プラン' : 'メイン執務拡張プラン', mirrorX: orient === 'northwest' || orient === 'southwest', mirrorZ: orient.startsWith('south'), mainScale: 1.08 }
  ];

  return variantSpecs.map((vs) => {
    const signX = vs.mirrorX ? -1 : 1;
    const signZ = vs.mirrorZ ? -1 : 1;

    const columns = baseSchema.skeleton.columns.map((c) => ({
      id: c.id,
      x: r2(c.x * scaleX * signX),
      z: r2(c.z * scaleZ * signZ)
    }));

    const cores = baseSchema.skeleton.cores.map((c) => ({
      ...c,
      x: r2(c.x * scaleX * signX),
      z: r2(c.z * scaleZ * signZ),
      w: r2(Math.max(1.6, c.w * scaleX)),
      d: r2(Math.max(1.6, c.d * scaleZ))
    }));

    const shafts = baseSchema.mep.shafts.map((s) => ({
      ...s,
      x: r2(s.x * scaleX * signX),
      z: r2(s.z * scaleZ * signZ)
    }));

    const maxBaseFloor = Math.max(...baseSchema.rooms.map((r) => r.floor), 1);
    const rooms: StratumArchBIMSchema['rooms'] = [];

    for (let fl = 1; fl <= numFloors; fl++) {
      const srcFl = Math.min(fl, maxBaseFloor);
      const flRooms = baseSchema.rooms.filter((r) => r.floor === srcFl);
      flRooms.forEach((rm, idx) => {
        const wScaled = r2(Math.max(1.4, rm.w * scaleX * (rm.type === 'public' ? vs.mainScale : 1 / vs.mainScale)));
        const dScaled = r2(Math.max(1.3, rm.d * scaleZ));
        const halfW = siteW / 2 - 0.35;
        const halfD = siteD / 2 - 0.35;
        const clampedW = r2(Math.min(wScaled, halfW * 2));
        const clampedD = r2(Math.min(dScaled, halfD * 2));
        const rawX = rm.x * scaleX * signX;
        const rawZ = rm.z * scaleZ * signZ;
        const clampedX = r2(Math.max(-halfW + clampedW / 2, Math.min(halfW - clampedW / 2, rawX)));
        const clampedZ = r2(Math.max(-halfD + clampedD / 2, Math.min(halfD - clampedD / 2, rawZ)));

        rooms.push({
          ...rm,
          id: `R${fl}0${idx + 1}`,
          floor: fl,
          name: fl > maxBaseFloor ? rm.name.replace(/^\d+F\s*/, `${fl}F `) : rm.name,
          x: clampedX,
          z: clampedZ,
          w: clampedW,
          d: clampedD
        });
      });
    }

    const bp: StratumArchBIMSchema = {
      site: { width: siteW, depth: siteD, floors: numFloors, floorHeight },
      skeleton: { columns, cores },
      mep: { shafts },
      rooms
    };

    const totalArea = r2(rooms.reduce((acc, r) => acc + r.w * r.d, 0));
    const wetCount = rooms.filter((r) => r.needsPlumbing || r.type === 'wet').length;

    return {
      label: vs.label,
      title: vs.title,
      prompt: `${summaryPrompt}（${vs.title}）`,
      blueprint: bp,
      validation: { isValid: true, repairedCount: 0, warnings: [] },
      summary: {
        totalArea,
        roomCount: rooms.length,
        wetCount,
        floors: numFloors
      }
    };
  });
}

function SectionTitle({ index, title, hint }: { index: number; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2.5 mb-3">
      <span className="font-mono text-xs text-cyan-400 font-bold">{String(index).padStart(2, '0')}</span>
      <h2 className="text-base font-bold text-white">{title}</h2>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </div>
  );
}

function ChoiceButton({
  selected,
  onClick,
  children,
  className = ''
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-2xl ring-1 transition cursor-pointer ${
        selected
          ? 'bg-cyan-400/15 ring-cyan-400 text-white shadow-lg shadow-cyan-500/10'
          : 'bg-[#0B1222] ring-white/10 text-slate-200 hover:bg-[#111C33] hover:ring-white/20'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export default function Wizard({ onOpenStudio, onBackToWelcome, initialLand }: WizardProps) {
  const [prevBuilding, setPrevBuilding] = useState<PreviousBuildingType>(
    initialLand?.prevType ?? 'showa_wooden_house'
  );
  const [frontRoad, setFrontRoad] = useState<FrontRoadDirection>(initialLand?.roadDir ?? 'south');
  const [surrounding, setSurrounding] = useState<SurroundingContextType>(
    initialLand?.surrounding ?? 'old_residential_dense'
  );

  const [typeId, setTypeId] = useState<BuildingTypeId>('family_house');
  const [width, setWidth] = useState<number>(initialLand?.width ?? 10);
  const [depth, setDepth] = useState<number>(initialLand?.depth ?? 9.5);
  const [floors, setFloors] = useState<number>(2);
  const [orientation, setOrientation] = useState<Orientation>('northeast');

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [variants, setVariants] = useState<VariantResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selectedType = BUILDING_TYPES.find((t) => t.id === typeId)!;
  const isResidential = selectedType.group === 'residential';
  const floorOptions = isResidential ? [1, 2, 3] : [2, 3, 4, 5];
  const siteAreaTsubo = (width * depth) / 3.305785;

  const previewSubsurface = useMemo(() => {
    const baseSchema = buildingScenarioToStratumSchema(PRESET_SCENARIOS[selectedType.fallbackPreset]);
    baseSchema.site.width = width;
    baseSchema.site.depth = depth;
    return inferLandSubsurface(baseSchema, prevBuilding, frontRoad, surrounding, initialLand?.context);
  }, [selectedType, width, depth, prevBuilding, frontRoad, surrounding, initialLand]);

  const summaryText = useMemo(
    () =>
      `${initialLand ? `[${initialLand.address}] ` : ''}${selectedType.title} ／ 敷地 ${width}m × ${depth}m（約${siteAreaTsubo.toFixed(
        0
      )}坪） ／ ${floors}階建て ／ コア・水回り ${ORIENTATIONS.find((o) => o.id === orientation)?.label}寄せ`,
    [initialLand, selectedType, width, depth, floors, orientation, siteAreaTsubo]
  );

  const handleSelectType = (opt: BuildingTypeOption) => {
    setTypeId(opt.id);
    if (!initialLand) {
      setWidth(opt.defaults.width);
      setDepth(opt.defaults.depth);
    }
    setFloors(opt.defaults.floors);
    if (opt.group === 'residential' && orientation.startsWith('south')) {
      setOrientation(orientation === 'southeast' ? 'northeast' : 'northwest');
    }
    setVariants([]);
    setError(null);
  };

  const handleGenerate = async () => {
    setIsLoading(true);
    setError(null);
    setVariants([]);

    const body = JSON.stringify({ building_type: typeId, width, depth, floors, orientation, variants: 3 });
    for (const url of API_ENDPOINTS) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        if (res.ok) {
          const data = await res.json();
          setVariants(data.variants ?? []);
          setIsLoading(false);
          return;
        }
      } catch {
        // 次のエンドポイントを試す
      }
    }
    const fallbackVariants = generateClientVariants(
      selectedType,
      width,
      depth,
      floors,
      orientation,
      summaryText
    );
    setVariants(fallbackVariants);
    setIsLoading(false);
  };

  const handleOpenPreset = () => {
    const preset = PRESET_SCENARIOS[selectedType.fallbackPreset];
    onOpenStudio(buildingScenarioToStratumSchema(preset), preset.prompt, {
      prevType: prevBuilding,
      roadDir: frontRoad,
      surrounding
    });
  };

  return (
    <div className="min-h-screen w-full bg-[#070B14] text-slate-100 antialiased">
      {/* ヘッダー */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#070B14]/90 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {onBackToWelcome && (
              <button
                onClick={onBackToWelcome}
                className="flex items-center gap-1.5 h-11 px-3.5 rounded-xl text-xs font-semibold ring-1 ring-white/15 bg-[#0B1222] text-slate-200 hover:bg-[#111C33] transition cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4 text-cyan-400" />
                土地マップへ戻る
              </button>
            )}
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-cyan-400/15 ring-1 ring-cyan-400/40 text-cyan-300">
              <Radar className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white">
                STRATUM GEO-BIM — 地下埋設整合・新築プラン作成
              </h1>
              <p className="text-xs text-slate-400">
                {initialLand
                  ? `選択中の土地：${initialLand.address}（${width}m × ${depth}m）`
                  : '土地の地下埋設管・地中障害物を避けて3つの建築プランを比較生成します'}
              </p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 font-mono text-xs text-slate-400">
            <span className="px-2.5 py-1 rounded-lg bg-[#0B1222] ring-1 ring-white/10">01 土地マップ選択</span>
            <span>→</span>
            <span className="px-2.5 py-1 rounded-lg bg-cyan-400 text-[#070B14] font-bold">02 新築プラン比較</span>
            <span>→</span>
            <span className="px-2.5 py-1 rounded-lg bg-[#0B1222] ring-1 ring-white/10">03 3D地下X線・CADスタジオ</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-9">
        {/* 00 土地の過去履歴・前面道路・周囲の建物環境からの地下埋設AI推論 */}
        <section className="animate-fade-up bg-[#0B1222] ring-1 ring-cyan-400/40 rounded-3xl p-5 sm:p-6 space-y-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
            <div>
              <div className="font-mono text-xs text-cyan-400 font-bold flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                STEP 00 — LAND &amp; BURIED UTILITY INFERENCE
              </div>
              <h2 className="text-base sm:text-lg font-bold text-white mt-0.5">
                土地の過去履歴・周囲の建物から「地下のガス管・上下水管・地中障害物」を推論
              </h2>
            </div>
            <span className="px-3 py-1 rounded-lg bg-cyan-400/15 ring-1 ring-cyan-400/40 text-cyan-300 font-mono text-xs font-bold">
              推論配管 {previewSubsurface.pipes.length}系統 ／ 地中障害物 {previewSubsurface.obstacles.length}箇所
            </span>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            {PREVIOUS_BUILDING_OPTIONS.map((opt) => (
              <ChoiceButton
                key={opt.id}
                selected={prevBuilding === opt.id}
                onClick={() => setPrevBuilding(opt.id)}
                className="p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-cyan-400/15 text-cyan-300 mr-2">
                      {opt.era}
                    </span>
                    <span className="text-sm font-bold text-white">{opt.title}</span>
                  </div>
                  {prevBuilding === opt.id && <Check className="w-4 h-4 text-cyan-400 shrink-0" />}
                </div>
                <div className="text-xs text-slate-400 mt-1.5 leading-relaxed">{opt.desc}</div>
              </ChoiceButton>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4 pt-1">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                前面道路・本管（ガス・上水・下水）の埋設方向
              </label>
              <select
                value={frontRoad}
                onChange={(e) => setFrontRoad(e.target.value as FrontRoadDirection)}
                className="w-full h-12 bg-[#070B14] ring-1 ring-white/15 rounded-xl px-3 text-xs sm:text-sm text-white cursor-pointer"
              >
                {FRONT_ROAD_OPTIONS.map((r) => (
                  <option key={r.id} value={r.id} className="bg-[#0B1222]">
                    {r.label} — {r.note}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                周囲の建物・隣地環境（越境管・残置山留め推論）
              </label>
              <select
                value={surrounding}
                onChange={(e) => setSurrounding(e.target.value as SurroundingContextType)}
                className="w-full h-12 bg-[#070B14] ring-1 ring-white/15 rounded-xl px-3 text-xs sm:text-sm text-white cursor-pointer"
              >
                {SURROUNDING_OPTIONS.map((s) => (
                  <option key={s.id} value={s.id} className="bg-[#0B1222]">
                    {s.label} — {s.note}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* リアルタイムAI地下埋設推論レポート */}
          <div className="bg-[#070B14] ring-1 ring-white/10 rounded-2xl p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-bold text-cyan-300">
                AI地下埋設物・ガス管推論レポート（{previewSubsurface.landTitle}）
              </span>
              <span className="font-mono text-xs text-amber-300 font-bold">
                試掘・撤去・引込概算: 約{previewSubsurface.aiSummary.estimatedSubsurfaceCostManYen}万円
              </span>
            </div>
            <ul className="text-xs text-slate-300 space-y-1 list-disc pl-4">
              {previewSubsurface.aiSummary.keyFindings.map((kf, i) => (
                <li key={i}>{kf}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* 01 用途 */}
        <section className="animate-fade-up">
          <SectionTitle index={1} title="どんな建物を建てますか" />
          <div className="space-y-4">
            {(['residential', 'commercial'] as const).map((group) => (
              <div key={group}>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-2">
                  {group === 'residential' ? <Home className="w-4 h-4 text-cyan-400" /> : <Building2 className="w-4 h-4 text-cyan-400" />}
                  {group === 'residential' ? '住宅' : 'オフィス・店舗・施設'}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {BUILDING_TYPES.filter((t) => t.group === group).map((opt) => (
                    <ChoiceButton key={opt.id} selected={typeId === opt.id} onClick={() => handleSelectType(opt)} className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-bold text-white">{opt.title}</div>
                        {typeId === opt.id && <Check className="w-4 h-4 text-cyan-400 shrink-0" />}
                      </div>
                      <div className="text-xs text-slate-400 mt-1 leading-relaxed">{opt.description}</div>
                      <div className="font-mono text-[10px] text-cyan-300/80 mt-2">
                        標準 {opt.defaults.width}×{opt.defaults.depth}m ・ {opt.defaults.floors}F
                      </div>
                    </ChoiceButton>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 02 敷地 */}
        <section>
          <SectionTitle index={2} title="敷地の大きさ" hint="間口（東西）× 奥行（南北）" />
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5 mb-4">
            {SITE_PRESETS.map((p) => (
              <ChoiceButton
                key={`${p.w}x${p.d}`}
                selected={width === p.w && depth === p.d}
                onClick={() => {
                  setWidth(p.w);
                  setDepth(p.d);
                  setVariants([]);
                }}
                className="px-3.5 py-3"
              >
                <div className="font-mono text-sm font-bold text-white">
                  {p.w}×{p.d}m
                </div>
                <div className="text-[11px] text-slate-400">{p.note}</div>
              </ChoiceButton>
            ))}
          </div>
          <div className="grid md:grid-cols-2 gap-4 bg-[#0B1222] ring-1 ring-white/10 rounded-2xl p-4">
            {[
              { label: '間口（東西）', value: width, set: setWidth },
              { label: '奥行（南北）', value: depth, set: setDepth }
            ].map((s) => (
              <div key={s.label} className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">{s.label}</span>
                  <span className="font-mono text-cyan-300 font-bold">{s.value.toFixed(1)} m</span>
                </div>
                <input
                  type="range"
                  min="8"
                  max="24"
                  step="0.5"
                  value={s.value}
                  onChange={(e) => {
                    s.set(parseFloat(e.target.value));
                    setVariants([]);
                  }}
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>
            ))}
            <div className="md:col-span-2 text-xs text-slate-400">
              敷地面積 <span className="font-mono text-white font-semibold">{(width * depth).toFixed(1)}㎡</span>（約
              <span className="font-mono text-white font-semibold">{siteAreaTsubo.toFixed(1)}</span>坪）
            </div>
          </div>
        </section>

        {/* 03 階数 & 04 方位 */}
        <section className="grid md:grid-cols-2 gap-8">
          <div>
            <SectionTitle index={3} title="階数" />
            <div className="grid grid-cols-4 gap-2.5">
              {floorOptions.map((f) => (
                <ChoiceButton
                  key={f}
                  selected={floors === f}
                  onClick={() => {
                    setFloors(f);
                    setVariants([]);
                  }}
                  className="py-3.5 text-center"
                >
                  <div className="font-mono text-base font-bold text-white text-center">{f}F</div>
                  <div className="text-[11px] text-slate-400 text-center">{f === 1 ? '平屋' : `${f}階建て`}</div>
                </ChoiceButton>
              ))}
            </div>
          </div>
          <div>
            <SectionTitle
              index={4}
              title="階段・水回りを寄せる方角"
              hint={isResidential ? '住宅は南の採光を優先するため北側のみ' : undefined}
            />
            <div className="grid grid-cols-2 gap-2.5 max-w-xs">
              {ORIENTATIONS.map((o) => {
                const disabled = isResidential && o.id.startsWith('south');
                return (
                  <button
                    key={o.id}
                    disabled={disabled}
                    onClick={() => {
                      setOrientation(o.id);
                      setVariants([]);
                    }}
                    className={`py-3 rounded-2xl ring-1 text-sm font-semibold transition ${
                      disabled
                        ? 'bg-[#0B1222]/40 ring-white/5 text-slate-600 cursor-not-allowed'
                        : orientation === o.id
                        ? 'bg-cyan-400/15 ring-cyan-400 text-white cursor-pointer'
                        : 'bg-[#0B1222] ring-white/10 text-slate-300 hover:bg-[#111C33] cursor-pointer'
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* 生成ボタン */}
        <section className="flex flex-wrap items-center justify-between gap-4 bg-[#0B1222] ring-1 ring-white/15 rounded-2xl px-5 py-4 animate-fade-up-delay-1">
          <div>
            <div className="text-xs text-slate-400">選択中の設計条件</div>
            <div className="text-sm font-semibold text-white mt-0.5">{summaryText}</div>
          </div>
          <button
            onClick={handleGenerate}
            disabled={isLoading}
            className="h-12 flex items-center gap-2 px-6 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-[#070B14] text-sm font-bold transition disabled:opacity-50 shadow-lg shadow-cyan-500/20 cursor-pointer"
          >
            <Compass className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? '3つのプランを計算中...' : '埋設整合済みの3プランを作成する'}
          </button>
        </section>

        {error && (
          <section className="bg-red-950/50 ring-1 ring-red-500/40 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-300">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
            <button
              onClick={handleOpenPreset}
              className="text-xs text-cyan-300 hover:underline cursor-pointer"
            >
              サンプル設計をスタジオで開く →
            </button>
          </section>
        )}

        {/* 03案の比較 */}
        {variants.length > 0 && (
          <section className="animate-fade-up">
            <SectionTitle index={5} title="設計プランを比較して選ぶ" hint="すべてのプランで地下埋設管・構造・設備の整合性検証が完了しています" />
            <div className="grid md:grid-cols-3 gap-4">
              {variants.map((v) => (
                <div
                  key={v.label}
                  className="bg-[#0B1222] ring-1 ring-white/15 rounded-2xl overflow-hidden flex flex-col hover:ring-cyan-400/60 transition"
                >
                  <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                    <div>
                      <span className="font-mono text-xs text-cyan-400 font-bold mr-2">案{v.label}</span>
                      <span className="text-sm font-bold text-white">{v.title}</span>
                    </div>
                    {v.validation.isValid ? (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-semibold">
                        <Check className="w-3.5 h-3.5" /> 埋設整合OK
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] text-amber-400 font-semibold">
                        <AlertCircle className="w-3.5 h-3.5" /> 要確認
                      </span>
                    )}
                  </div>
                  <div
                    className="h-52 bg-[#FAF9F5] p-2 [&>svg]:w-full [&>svg]:h-full"
                    dangerouslySetInnerHTML={{
                      __html: renderSubsurfaceSurveyCadSvg(
                        v.blueprint,
                        inferLandSubsurface(v.blueprint, prevBuilding, frontRoad, surrounding, initialLand?.context),
                        true
                      )
                    }}
                  />
                  <div className="grid grid-cols-3 border-t border-white/10 text-center">
                    <div className="py-2.5">
                      <div className="text-[10px] text-slate-400">延床面積</div>
                      <div className="font-mono text-sm font-bold text-white">{v.summary.totalArea}㎡</div>
                    </div>
                    <div className="py-2.5 border-x border-white/10">
                      <div className="text-[10px] text-slate-400">部屋数</div>
                      <div className="font-mono text-sm font-bold text-white">{v.summary.roomCount}</div>
                    </div>
                    <div className="py-2.5">
                      <div className="text-[10px] text-slate-400">水回り</div>
                      <div className="font-mono text-sm font-bold text-white">{v.summary.wetCount}</div>
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      onOpenStudio(v.blueprint, v.prompt, {
                        prevType: prevBuilding,
                        roadDir: frontRoad,
                        surrounding,
                        context: initialLand?.context
                      })
                    }
                    className="m-3 mt-auto h-11 flex items-center justify-center gap-2 px-4 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-[#070B14] text-xs font-bold transition cursor-pointer"
                  >
                    この案で3D・CADスタジオを開く
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
