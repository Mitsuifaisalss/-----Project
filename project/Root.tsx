import { useState } from 'react';
import Studio, {
  PRESET_SCENARIOS,
  buildingScenarioToStratumSchema,
  type ScenarioKey,
  type StratumArchBIMSchema
} from './ai_bim_3d';
import Welcome from './Welcome';
import Wizard from './Wizard';
import LandMapExplorer, { blueprintForLand, type SelectedLand } from './LandMapExplorer';
import type { PreviousBuildingType, FrontRoadDirection, SurroundingContextType, RealSiteContext } from './SubsurfaceInferenceEngine';

interface StudioSession {
  id: number;
  blueprint: StratumArchBIMSchema;
  prompt: string;
  autoStartDemo?: boolean;
  land?: {
    prevType: PreviousBuildingType;
    roadDir: FrontRoadDirection;
    surrounding: SurroundingContextType;
    context?: RealSiteContext;
  };
}

type ScreenMode = 'welcome' | 'map' | 'wizard' | 'studio';

// ようこそ → 地図で土地を選択（AI埋設推論＆自動作図） → 3Dスタジオ ／ 新築プラン条件（Wizard）
export default function Root() {
  const [screen, setScreen] = useState<ScreenMode>('welcome');
  const [session, setSession] = useState<StudioSession | null>(null);
  const [selectedLand, setSelectedLand] = useState<SelectedLand | undefined>(undefined);
  const [presetSiteId, setPresetSiteId] = useState<string | undefined>(undefined);
  const [studioBack, setStudioBack] = useState<ScreenMode>('map');

  const go = (s: ScreenMode) => {
    setScreen(s);
    window.scrollTo(0, 0);
  };

  if (screen === 'welcome') {
    return (
      <Welcome
        onStartWizard={(presetId?: string) => {
          setPresetSiteId(presetId);
          go('map');
        }}
        onLaunchDemoTour={(presetKey?: ScenarioKey) => {
          const scenario = PRESET_SCENARIOS[presetKey ?? 'family_house_4ldk'];
          setSession({
            id: Date.now(),
            blueprint: buildingScenarioToStratumSchema(scenario),
            prompt: scenario.prompt,
            autoStartDemo: true
          });
          setStudioBack('welcome');
          go('studio');
        }}
      />
    );
  }

  if (screen === 'map' || (screen === 'studio' && !session)) {
    return (
      <LandMapExplorer
        initialPresetId={presetSiteId}
        onBack={() => go('welcome')}
        onOpenStudio={(land) => {
          setSelectedLand(land);
          setSession({
            id: Date.now(),
            blueprint: blueprintForLand(land),
            prompt: `${land.accurateTitle || land.address} の土地（${land.width}m×${land.depth}m）`,
            land: {
              prevType: land.prevType,
              roadDir: land.roadDir,
              surrounding: land.surrounding,
              context: land.context
            }
          });
          setStudioBack('map');
          go('studio');
        }}
        onPlanBuilding={(land) => {
          setSelectedLand(land);
          go('wizard');
        }}
      />
    );
  }

  if (screen === 'wizard') {
    return (
      <Wizard
        initialLand={selectedLand}
        onBackToWelcome={() => go('map')}
        onOpenStudio={(blueprint, prompt, landConfig) => {
          setSession({
            id: Date.now(),
            blueprint,
            prompt,
            autoStartDemo: false,
            land: landConfig ?? (selectedLand ? {
              prevType: selectedLand.prevType,
              roadDir: selectedLand.roadDir,
              surrounding: selectedLand.surrounding
            } : undefined)
          });
          setStudioBack('wizard');
          go('studio');
        }}
      />
    );
  }

  return (
    <Studio
      key={session!.id}
      initialBlueprint={session!.blueprint}
      initialPrompt={session!.prompt}
      autoStartDemo={session!.autoStartDemo}
      initialLand={session!.land}
      onBack={() => go(studioBack)}
    />
  );
}
