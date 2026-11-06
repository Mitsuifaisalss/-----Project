import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Play,
  MapPin,
  ScanLine,
  ShieldAlert,
  FileCode2,
  Tablet,
  Radar
} from 'lucide-react';
import type { ScenarioKey } from './ai_bim_3d';
import { SAMPLE_FIELD_SITES } from './realSiteData';

interface WelcomeProps {
  onStartWizard: (presetSiteId?: string) => void;
  onLaunchDemoTour: (presetKey?: ScenarioKey) => void;
}

const SCAN_STEPS = [
  {
    code: 'PHASE 01',
    title: 'マップ上で調査したい土地をタップ選択',
    sub: 'GIS Parcel & Surrounding Building Scan',
    desc: '現場のタブレットやPCから地図上の土地をタップ。OpenStreetMapの周囲の建物形状・階数・前面道路幅員・水路距離と、国土地理院の1970年代航空写真を即時照合します。'
  },
  {
    code: 'PHASE 02',
    title: '周囲の建物・旧建物履歴から「地下ガス管・上下水管」をAI推論',
    sub: 'Subsurface Gas & Water Utility Inference',
    desc: '前面道路の本管(GL-1.2m)と、前回その土地に建っていた建物（旧木造住宅の台所/風呂釜・旧RCクリニックの機械室等）から、地中に残る白ガス管・鉛給水管・隣地越境管のルートを推論します。'
  },
  {
    code: 'PHASE 03',
    title: '地中残置杭・旧浄化槽・地下タンクの深さと撤去費を算出',
    sub: 'Buried Obstacles & Excavation Cost Estimation',
    desc: 'GL-1.8m〜-8.5mに残置された旧RCビルのPHC杭や旧浄化槽・地下重油タンクを特定。重機掘削前の試掘ポイントと撤去概算費用（万円）を即座に算出します。'
  },
  {
    code: 'PHASE 04',
    title: '埋設管と干渉しない「埋設伏図・断面図・新築間取り図」を自動作図',
    sub: 'Automated Subsurface CAD & Architectural Floor Plan',
    desc: '推論された地下埋設インフラを避けて新築の柱・基礎・給排水縦シャフト(PS)を自動配置し、プロ実務仕様の2D CAD図面と3D地下X線透視モデルを同時生成します。'
  }
];

export default function Welcome({ onStartWizard, onLaunchDemoTour }: WelcomeProps) {
  const [stepIdx, setStepIdx] = useState<number>(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStepIdx((prev) => (prev + 1) % SCAN_STEPS.length);
    }, 3600);
    return () => window.clearInterval(timer);
  }, []);

  const activeStep = SCAN_STEPS[stepIdx];

  return (
    <div className="min-h-screen w-full bg-[#070B14] text-slate-100 selection:bg-cyan-400/20 antialiased">
      {/* ==================== トップナビゲーション ==================== */}
      <header className="sticky top-0 z-30 bg-[#070B14]/85 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-400/15 ring-1 ring-cyan-400/40 text-cyan-300 flex items-center justify-center shadow-lg shadow-cyan-500/10">
              <Radar className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-white">STRATUM GEO-BIM</span>
                <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-400/15 text-cyan-300 ring-1 ring-cyan-400/30">
                  <Tablet className="w-3 h-3" /> FIELD TABLET READY
                </span>
              </div>
              <div className="text-[11px] text-slate-400 hidden sm:block">
                土地マップ選択 × 地下埋設ガス管・障害物AI推論 × 自動CAD設計システム
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => onLaunchDemoTour('family_house_4ldk')}
              className="h-11 px-4 rounded-xl text-xs sm:text-sm font-medium text-slate-200 bg-white/[0.05] hover:bg-white/[0.1] ring-1 ring-white/10 flex items-center gap-2 transition active:scale-95 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 text-cyan-400 fill-cyan-400" />
              <span>3D地下X線デモ</span>
            </button>
            <button
              onClick={() => onStartWizard()}
              className="h-11 px-4 sm:px-5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-[#070B14] text-xs sm:text-sm font-bold flex items-center gap-2 transition shadow-lg shadow-cyan-500/20 active:scale-95 cursor-pointer"
            >
              <MapPin className="w-4 h-4" />
              <span>マップで土地を選ぶ</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ==================== ヒーローセクション ==================== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 pb-14 lg:py-16">
        <div className="grid lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          {/* 左カラム：メインコピー＆大型タブレットCTA */}
          <div className="lg:col-span-6 space-y-6 animate-fade-up">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-400/10 ring-1 ring-cyan-400/30 text-xs font-mono text-cyan-300">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              MAP-FIRST SUBSURFACE AI SURVEY &amp; CAD GENERATOR
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight leading-[1.22] text-white">
              マップで知りたい土地をタップ。
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-sky-300 to-amber-300">
                地下のガス管・埋設物と設計図
              </span>
              をAIが即座に描く。
            </h1>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              現場のタブレットから地図上の土地を選ぶだけ。
              <strong className="text-white font-semibold">
                「周囲の建物データ」「前面道路の本管」「前回その土地に建っていた建物履歴」
              </strong>
              から、地中に眠る都市ガス管・上下水管・隣地越境管・旧残置杭をAIが推論し、平面伏図・地下断面図・新築間取り図をワンタップで自動生成します。
            </p>

            {/* メインアクションボタン（タブレット指操作対応 52px高） */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                onClick={() => onStartWizard()}
                className="group h-14 px-7 rounded-2xl bg-cyan-400 hover:bg-cyan-300 text-[#070B14] text-base font-bold flex items-center gap-3 transition shadow-xl shadow-cyan-500/25 active:scale-[0.98] cursor-pointer"
              >
                <MapPin className="w-5 h-5" />
                <span>土地マップを開いてAI調査を開始</span>
                <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
              </button>

              <button
                onClick={() => onLaunchDemoTour('family_house_4ldk')}
                className="h-14 px-6 rounded-2xl bg-white/[0.06] hover:bg-white/[0.12] ring-1 ring-white/15 text-white text-sm sm:text-base font-semibold flex items-center gap-2.5 transition active:scale-[0.98] cursor-pointer"
              >
                <Play className="w-4 h-4 text-cyan-400 fill-cyan-400" />
                <span>3D地下X線スタジオを見る</span>
              </button>
            </div>

            {/* 3つの主要スペック指標 */}
            <div className="grid grid-cols-3 gap-3 pt-4">
              <div className="rounded-2xl bg-[#0E172A] ring-1 ring-white/10 p-3.5">
                <div className="font-mono text-xs text-amber-400 font-semibold">GL -0.4m〜-1.5m</div>
                <div className="text-sm font-bold text-white mt-0.5">埋設ガス管・給排水</div>
                <div className="text-[11px] text-slate-400 mt-1">道路本管と旧台所・風呂跡から引込ルートを推論</div>
              </div>
              <div className="rounded-2xl bg-[#0E172A] ring-1 ring-white/10 p-3.5">
                <div className="font-mono text-xs text-red-400 font-semibold">GL -0.5m〜-3.5m</div>
                <div className="text-sm font-bold text-white mt-0.5">隣地越境管・旧浄化槽</div>
                <div className="text-[11px] text-slate-400 mt-1">周囲の建物関係から越境枝管・地下タンクを検出</div>
              </div>
              <div className="rounded-2xl bg-[#0E172A] ring-1 ring-white/10 p-3.5">
                <div className="font-mono text-xs text-cyan-400 font-semibold">GL -1.8m〜-8.5m</div>
                <div className="text-sm font-bold text-white mt-0.5">残置PHC杭・支持層</div>
                <div className="text-[11px] text-slate-400 mt-1">旧RCビルの残置杭と新築基礎の干渉を自動回避</div>
              </div>
            </div>
          </div>

          {/* 右カラム：ライブGISレーダー＆地下埋設X線ダイアグラム */}
          <div className="lg:col-span-6 animate-fade-up-delay-1">
            <div className="rounded-3xl bg-[#0B1222] ring-1 ring-white/15 p-4 sm:p-5 shadow-2xl">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-cyan-400/15 text-cyan-300 ring-1 ring-cyan-400/30 font-bold">
                    {activeStep.code}
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-white">{activeStep.title}</span>
                </div>
                <span className="font-mono text-[11px] text-emerald-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  AI SCAN ACTIVE
                </span>
              </div>

              {/* 地図＋地下埋設レーダーSVG */}
              <div className="relative h-80 sm:h-88 bg-[#070B14] ring-1 ring-white/10 rounded-2xl my-3.5 overflow-hidden">
                <svg viewBox="0 0 560 360" className="w-full h-full">
                  <defs>
                    <pattern id="gis-grid" width="28" height="28" patternUnits="userSpaceOnUse">
                      <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#1E293B" strokeWidth="0.8" />
                    </pattern>
                  </defs>
                  <rect width="560" height="360" fill="url(#gis-grid)" />

                  {/* 周囲の建物ポリゴン (西隣・東隣・北隣) */}
                  <g fill="#1E293B" stroke="#475569" strokeWidth="1.2">
                    <rect x="36" y="64" width="96" height="145" rx="4" />
                    <rect x="428" y="64" width="96" height="145" rx="4" />
                    <rect x="155" y="14" width="250" height="36" rx="4" />
                  </g>
                  <text x="84" y="135" textAnchor="middle" fontSize="10" fill="#94A3B8">
                    西隣：既存木造2F
                  </text>
                  <text x="476" y="135" textAnchor="middle" fontSize="10" fill="#94A3B8">
                    東隣：RCマンション3F
                  </text>
                  <text x="280" y="36" textAnchor="middle" fontSize="10" fill="#94A3B8">
                    北隣：既存住宅（旧水路暗渠境界）
                  </text>

                  {/* 南側前面道路＆地下本管 */}
                  <rect x="20" y="232" width="520" height="54" fill="#0F172A" stroke="#334155" strokeWidth="1" />
                  <text x="40" y="248" fontSize="10" fontWeight="bold" fill="#94A3B8">
                    前面公道（幅員6.0m）— 地下インフラ本管ゾーン
                  </text>
                  {/* 都市ガス本管 (アンバー) */}
                  <line x1="25" y1="258" x2="535" y2="258" stroke="#F59E0B" strokeWidth="4" />
                  <text x="490" y="254" fontSize="9" fontFamily="monospace" fill="#FBBF24">
                    都市ガス本管 100A (GL-1.2m)
                  </text>
                  {/* 上水道本管 (シアン) */}
                  <line x1="25" y1="269" x2="535" y2="269" stroke="#38BDF8" strokeWidth="3.5" />
                  {/* 下水本管 (ブラウン) */}
                  <line x1="25" y1="280" x2="535" y2="280" stroke="#C08457" strokeWidth="4.5" />

                  {/* 選択された対象土地境界 (シアン枠) */}
                  <rect
                    x="152"
                    y="62"
                    width="256"
                    height="156"
                    fill="rgba(34,211,238,0.08)"
                    stroke="#22D3EE"
                    strokeWidth="2.5"
                    strokeDasharray="7 4"
                  />
                  <text x="162" y="80" fontSize="10" fontFamily="monospace" fontWeight="bold" fill="#22D3EE">
                    SELECTED LOT: 10.0m × 9.5m
                  </text>

                  {/* 旧建物履歴シルエット（破線） */}
                  <rect
                    x="182"
                    y="86"
                    width="196"
                    height="106"
                    fill="rgba(251,191,36,0.07)"
                    stroke="#FBBF24"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                  />
                  <text x="192" y="102" fontSize="9.5" fill="#FDE68A">
                    [旧建物履歴] 昭和54年木造住宅（旧台所・風呂釜跡）
                  </text>

                  {/* AI推論された地下埋設管ルート */}
                  {/* 1) 旧白ガス引込管 */}
                  <line
                    x1="325"
                    y1="258"
                    x2="325"
                    y2="112"
                    stroke="#F59E0B"
                    strokeWidth="3.5"
                    strokeDasharray="6 3"
                  />
                  <line
                    x1="325"
                    y1="112"
                    x2="225"
                    y2="112"
                    stroke="#F59E0B"
                    strokeWidth="3"
                    strokeDasharray="5 3"
                  />
                  <circle cx="325" cy="112" r="5" fill="#F59E0B" />
                  <circle cx="225" cy="112" r="5" fill="#F59E0B" />
                  <rect x="232" y="118" width="175" height="16" rx="3" fill="#070B14" stroke="#F59E0B" strokeWidth="1" />
                  <text x="320" y="129" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="#FBBF24">
                    推論: 旧白ガス管25A (GL-0.60m)
                  </text>

                  {/* 2) 隣地越境管リスク (赤破線) */}
                  <line
                    x1="125"
                    y1="150"
                    x2="215"
                    y2="218"
                    stroke="#EF4444"
                    strokeWidth="3"
                    strokeDasharray="4 2"
                  />
                  <rect x="135" y="160" width="142" height="16" rx="3" fill="#450A0A" stroke="#EF4444" strokeWidth="1" />
                  <text x="206" y="171" textAnchor="middle" fontSize="8.5" fontFamily="monospace" fill="#FCA5A5">
                    ⚠️ 西隣越境排水管 (GL-0.65m)
                  </text>

                  {/* 3) 旧浄化槽・地中障害物 */}
                  <rect
                    x="332"
                    y="152"
                    width="40"
                    height="28"
                    rx="3"
                    fill="rgba(239,68,68,0.35)"
                    stroke="#F87171"
                    strokeWidth="1.8"
                  />
                  <text x="352" y="169" textAnchor="middle" fontSize="8.5" fontWeight="bold" fill="#FECACA">
                    旧浄化槽
                  </text>

                  {/* 下段ミニ断面ゲージ (GL 0m 〜 -8.5m) */}
                  <rect x="20" y="296" width="520" height="52" rx="6" fill="#0B1222" stroke="#1E293B" strokeWidth="1" />
                  <text x="32" y="313" fontSize="9.5" fontFamily="monospace" fontWeight="bold" fill="#38BDF8">
                    STRATUM DEPTH PROFILE (GL±0.0m 〜 -8.5m)
                  </text>
                  <text x="32" y="330" fontSize="9" fontFamily="monospace" fill="#FBBF24">
                    ● 都市ガス管: GL-0.60m / 本管-1.20m
                  </text>
                  <text x="225" y="330" fontSize="9" fontFamily="monospace" fill="#38BDF8">
                    ● 給水管: GL-0.45m / 下水管: -1.55m
                  </text>
                  <text x="405" y="330" fontSize="9" fontFamily="monospace" fill="#F87171">
                    ■ 旧浄化槽・残置杭: GL-1.8〜-8.5m
                  </text>
                </svg>
              </div>

              {/* ステップインジケータ */}
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed min-h-[40px]">{activeStep.desc}</p>
              <div className="grid grid-cols-4 gap-2 pt-3 mt-3 border-t border-white/10">
                {SCAN_STEPS.map((st, idx) => (
                  <button
                    key={st.code}
                    onClick={() => setStepIdx(idx)}
                    className={`text-left p-2.5 rounded-xl transition cursor-pointer ${
                      idx === stepIdx
                        ? 'bg-cyan-400/15 ring-1 ring-cyan-400 text-white'
                        : 'bg-white/[0.03] hover:bg-white/[0.07] text-slate-400'
                    }`}
                  >
                    <div className="font-mono text-[10px] text-cyan-400 font-bold">{st.code}</div>
                    <div className="text-[11px] font-semibold mt-0.5 line-clamp-1">{st.title}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== ワンタップ現地調査プリセット（マップ直行カード） ==================== */}
      <section className="border-t border-white/10 bg-[#0A101F] py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="font-mono text-xs text-cyan-400 tracking-wider font-semibold">
                INSTANT FIELD SITES // 現地ケース別プリセット
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white mt-1">
                知りたい土地ケースをタップして、マップ＆AI埋設図を即座に開く
              </h2>
            </div>
            <button
              onClick={() => onStartWizard()}
              className="text-xs sm:text-sm font-semibold text-cyan-300 hover:text-cyan-200 flex items-center gap-1.5 cursor-pointer"
            >
              自由な住所・現在地をマップで探す
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {SAMPLE_FIELD_SITES.map((s) => (
              <button
                key={s.id}
                onClick={() => onStartWizard(s.id)}
                className="group text-left rounded-2xl bg-[#0E172A] hover:bg-[#13203B] ring-1 ring-white/10 hover:ring-cyan-400/60 p-5 flex flex-col justify-between transition shadow-lg cursor-pointer"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold bg-cyan-400/15 text-cyan-300 ring-1 ring-cyan-400/30">
                      {s.badge}
                    </span>
                    <MapPin className="w-4 h-4 text-slate-400 group-hover:text-cyan-400 transition" />
                  </div>
                  <div className="text-base font-bold text-white group-hover:text-cyan-200 transition">
                    {s.label}
                  </div>
                  <div className="text-xs text-slate-400 font-mono">
                    北緯 {s.lat.toFixed(4)}° / 東経 {s.lng.toFixed(4)}°
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-white/10 flex items-center justify-between text-xs font-semibold text-cyan-300">
                  <span>この土地をマップでAI解析</span>
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ==================== 現場タブレット向け3つの特徴 ==================== */}
      <section className="border-t border-white/10 py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 grid md:grid-cols-3 gap-6">
          <div className="rounded-2xl bg-[#0B1222] ring-1 ring-white/10 p-6 space-y-2.5">
            <div className="w-10 h-10 rounded-xl bg-cyan-400/15 text-cyan-300 flex items-center justify-center">
              <ScanLine className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white">1. 土地・周辺建物・昭和航空写真を統合</h3>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              現在の地図・航空写真だけでなく、1974〜78年の国土地理院航空写真にワンタップで切替可能。以前どんな建物が建っていたかを現場のタブレットで視覚的に裏付けられます。
            </p>
          </div>

          <div className="rounded-2xl bg-[#0B1222] ring-1 ring-white/10 p-6 space-y-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-400/15 text-amber-300 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white">2. ガス管・越境管・残置杭の深さを推論</h3>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              道路本管(GL-1.2m)からの引込白ガス管、隣地からの越境排水管、旧RCビルの残置PHC杭(GL-8.5m)の平面位置と深さプロファイルを推論し、試掘・撤去概算費用を算出します。
            </p>
          </div>

          <div className="rounded-2xl bg-[#0B1222] ring-1 ring-white/10 p-6 space-y-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-400/15 text-emerald-300 flex items-center justify-center">
              <FileCode2 className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white">3. 埋設CAD図＆新築間取り図を同時生成</h3>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              選んだ土地の寸法と埋設管位置に整合する「地下埋設伏図・断面図」と「プロ建築意匠間取り図」をAIが即座に作成。そのまま3D地下X線スタジオで立体確認できます。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
