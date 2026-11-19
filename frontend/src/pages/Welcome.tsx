import { ArrowRight, ChevronRight, MapPin, Play } from 'lucide-react';
import type { ScenarioKey } from './ai_bim_3d';
import { SAMPLE_FIELD_SITES } from '../lib/realSiteData';
import ThemeToggle from '../components/ThemeToggle';

interface WelcomeProps {
  onStartWizard: (presetSiteId?: string) => void;
  onLaunchDemoTour: (presetKey?: ScenarioKey) => void;
}

const STEPS = [
  { title: '地図で土地を選ぶ', desc: '住所検索・現在地・地図のタップで敷地を指定します。' },
  { title: '地下の埋設物を確認', desc: 'ガス管・上下水管・残置杭などの推定位置と深さ、撤去費の目安を表示します。' },
  { title: '建物プランを作る', desc: '埋設物を避けた3つのプランを比べ、図面と3Dで確認します。' }
];

export default function Welcome({ onStartWizard, onLaunchDemoTour }: WelcomeProps) {
  return (
    <div className="min-h-screen w-full bg-canvas text-slate-100 antialiased flex flex-col">
      <header className="border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-md bg-cyan-400 text-on-accent grid place-items-center text-sm font-bold">S</span>
            <span className="font-semibold text-white">Stratum Geo-BIM</span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-10 sm:py-14 grid lg:grid-cols-[1fr_400px] gap-10 lg:gap-14">
        <div className="space-y-8">
          <div className="space-y-4">
            <h1 className="text-2xl sm:text-3xl font-bold leading-snug text-white">
              土地を選んで、
              <br className="sm:hidden" />
              地下と建物をまとめて検討する
            </h1>
            <p className="text-sm sm:text-base text-slate-400 leading-relaxed max-w-xl">
              周囲の建物や前面道路、以前その土地に建っていた建物の記録から地中の埋設物を推定し、それを避けた建物プランと図面を作成します。
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => onStartWizard()}
              className="h-12 px-6 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-on-accent font-semibold flex items-center gap-2 transition cursor-pointer"
            >
              <MapPin className="w-4.5 h-4.5" />
              地図から土地を選ぶ
            </button>
            <button
              onClick={() => onLaunchDemoTour('family_house_4ldk')}
              className="h-12 px-5 rounded-lg ring-1 ring-white/15 hover:bg-white/[0.05] text-slate-200 font-medium flex items-center gap-2 transition cursor-pointer"
            >
              <Play className="w-4 h-4" />
              デモを見る
            </button>
          </div>

          <section aria-labelledby="howto" className="pt-2">
            <h2 id="howto" className="text-sm font-semibold text-slate-400 mb-3">
              使い方
            </h2>
            <ol className="space-y-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-3.5">
                  <span className="w-7 h-7 shrink-0 rounded-full ring-1 ring-white/20 grid place-items-center text-sm font-semibold text-slate-300">
                    {i + 1}
                  </span>
                  <div>
                    <div className="font-semibold text-white">{s.title}</div>
                    <div className="text-sm text-slate-400 mt-0.5">{s.desc}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <section aria-labelledby="samples" className="lg:pt-1">
          <div className="flex items-baseline justify-between mb-3">
            <h2 id="samples" className="text-sm font-semibold text-slate-400">
              事例の土地から始める
            </h2>
            <button
              onClick={() => onStartWizard()}
              className="text-sm text-cyan-300 hover:underline flex items-center gap-1 cursor-pointer"
            >
              住所で探す
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <ul className="rounded-lg ring-1 ring-white/10 bg-surface divide-y divide-white/10 overflow-hidden">
            {SAMPLE_FIELD_SITES.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => onStartWizard(s.id)}
                  className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-hover transition cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white truncate">{s.label}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{s.badge}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-white/10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 text-xs text-slate-500">
          地図・航空写真：国土地理院 ／ 建物・道路：© OpenStreetMap contributors。埋設物の位置は推定であり、着工前に試掘・台帳での確認が必要です。
        </div>
      </footer>
    </div>
  );
}
