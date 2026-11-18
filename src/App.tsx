import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PriorityMatrixSection } from './components/PriorityMatrixSection';
import { PythonProjectSection } from './components/PythonProjectSection';
import { SignalControllerSection } from './components/SignalControllerSection';
import { VisionPipelineSection } from './components/VisionPipelineSection';
import {
  deleteMediaItemsBatch,
  getMetaValue,
  setMetaValue,
} from './storage/mediaStorage';
import {
  ApproachState,
  ClassBreakdownCounts,
  ControllerSettings,
  RoadDirection,
  TrafficMediaAsset,
} from './types/traffic';
import {
  evaluateTrafficControl,
  REFERENCE_PRESETS,
  ReferencePreset,
  ROADS,
} from './utils/trafficLogic';
import { getBuiltinTrafficFeeds } from './utils/trafficVisionEngine';

const PIPELINE_STEPS = [
  {
    num: '01',
    title: 'Traffic Input',
    desc: 'Camera feed, image, or video frame capture',
    targetId: 'section-vision',
  },
  {
    num: '02',
    title: 'Object Detection',
    desc: 'Cars, bikes, buses, trucks & pedestrians',
    targetId: 'section-vision',
  },
  {
    num: '03',
    title: 'Density Matrix',
    desc: 'North, South, East & West road counts',
    targetId: 'section-matrix',
  },
  {
    num: '04',
    title: 'Priority Decision',
    desc: 'Weighted density + max waiting time limit',
    targetId: 'section-matrix',
  },
  {
    num: '05',
    title: 'Binary Output',
    desc: '1 = ON (GREEN / WALK), 0 = OFF (RED / STOP)',
    targetId: 'section-controller',
  },
];

export function App() {
  const [selectedVisionRoad, setSelectedVisionRoad] =
    useState<RoadDirection>('North');

  const [mediaAssets, setMediaAssets] = useState<TrafficMediaAsset[]>(() =>
    getBuiltinTrafficFeeds()
  );

  const [approaches, setApproaches] = useState<
    Record<RoadDirection, ApproachState>
  >(() => ({
    North: { ...REFERENCE_PRESETS[0].approaches.North },
    South: { ...REFERENCE_PRESETS[0].approaches.South },
    East: { ...REFERENCE_PRESETS[0].approaches.East },
    West: { ...REFERENCE_PRESETS[0].approaches.West },
  }));

  const [settings, setSettings] = useState<ControllerSettings>({
    vehicleWeight: 2,
    pedestrianWeight: 3,
    maxWaitThreshold: 90,
    dedicatedPedestrianPhase: false,
    pedestrianThreshold: 22,
  });

  const [forcePedestrianWalk, setForcePedestrianWalk] = useState(false);
  const [simulationRunning, setSimulationRunning] = useState(false);

  // Restore any user-uploaded unlimited traffic photos/videos from IndexedDB metadata
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const savedCustom = await getMetaValue<TrafficMediaAsset[]>(
          'traffic_custom_media_v1'
        );
        if (mounted && Array.isArray(savedCustom) && savedCustom.length > 0) {
          setMediaAssets([...getBuiltinTrafficFeeds(), ...savedCustom]);
        }
      } catch {
        // Ignore storage read errors
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const persistCustomAssets = useCallback((nextAll: TrafficMediaAsset[]) => {
    const customOnly = nextAll.filter((a) => !a.isBuiltin);
    setMetaValue('traffic_custom_media_v1', customOnly).catch(() => undefined);
  }, []);

  const decision = useMemo(
    () => evaluateTrafficControl(approaches, settings, forcePedestrianWalk),
    [approaches, settings, forcePedestrianWalk]
  );

  const [timerRemainingSec, setTimerRemainingSec] = useState<number>(
    decision.greenDurationSec
  );

  // Sync timer whenever winning phase changes
  useEffect(() => {
    setTimerRemainingSec(decision.greenDurationSec);
  }, [decision.selectedRoad, decision.greenDurationSec]);

  const advanceNextCycle = useCallback(() => {
    const elapsed = decision.greenDurationSec;
    setApproaches((prev) => {
      const next = { ...prev };
      for (const road of ROADS) {
        if (decision.selectedRoad === road) {
          next[road] = { ...prev[road], waitSec: 0 };
        } else {
          next[road] = { ...prev[road], waitSec: prev[road].waitSec + elapsed };
        }
      }
      return next;
    });
    if (forcePedestrianWalk) {
      setForcePedestrianWalk(false);
    }
  }, [decision.greenDurationSec, decision.selectedRoad, forcePedestrianWalk]);

  useEffect(() => {
    if (!simulationRunning) return;
    const id = window.setInterval(() => {
      setTimerRemainingSec((t) => {
        if (t <= 1) {
          advanceNextCycle();
          return 30;
        }
        return t - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [simulationRunning, advanceNextCycle]);

  const handleAddMediaAssets = useCallback(
    (newAssets: TrafficMediaAsset[]) => {
      setMediaAssets((prev) => {
        const next = [...prev, ...newAssets];
        persistCustomAssets(next);
        return next;
      });
    },
    [persistCustomAssets]
  );

  const handleUpdateMediaAsset = useCallback(
    (updated: TrafficMediaAsset) => {
      setMediaAssets((prev) => {
        const next = prev.map((a) => (a.id === updated.id ? updated : a));
        persistCustomAssets(next);
        return next;
      });
    },
    [persistCustomAssets]
  );

  const handleDeleteMediaAsset = useCallback(
    (target: TrafficMediaAsset) => {
      if (target.isBuiltin) return;
      setMediaAssets((prev) => {
        const next = prev.filter((a) => a.id !== target.id);
        persistCustomAssets(next);
        return next;
      });
      deleteMediaItemsBatch([
        {
          id: target.id,
          datasetId: 'traffic',
          name: target.name,
          relativePath: target.relativePath,
          kind: target.kind,
          mimeType: target.mimeType,
          sizeBytes: target.sizeBytes,
          width: target.width,
          height: target.height,
          durationSec: target.durationSec,
          sha256: '',
          split: 'unassigned',
          status: 'unreviewed',
          labels: [],
          caption: '',
          boxes: [],
          segments: [],
          storageMode: 'opfs',
          hasThumbnail: true,
          createdAt: target.createdAt,
          updatedAt: target.createdAt,
        },
      ]).catch(() => undefined);
    },
    [persistCustomAssets]
  );

  const handleApplyCountsToRoad = useCallback(
    (road: RoadDirection, counts: ClassBreakdownCounts) => {
      setApproaches((prev) => ({
        ...prev,
        [road]: {
          ...prev[road],
          cars: counts.cars,
          bikes: counts.bikes,
          buses: counts.buses,
          trucks: counts.trucks,
          pedestrians: counts.pedestrians,
        },
      }));
    },
    []
  );

  const handleUpdateApproachField = useCallback(
    (
      road: RoadDirection,
      field: keyof ClassBreakdownCounts | 'waitSec',
      value: number
    ) => {
      setApproaches((prev) => ({
        ...prev,
        [road]: {
          ...prev[road],
          [field]: value,
        },
      }));
    },
    []
  );

  const handleUpdateSettings = useCallback(
    (patch: Partial<ControllerSettings>) => {
      setSettings((prev) => ({ ...prev, ...patch }));
    },
    []
  );

  const handleApplyPreset = useCallback((preset: ReferencePreset) => {
    setApproaches({
      North: { ...preset.approaches.North },
      South: { ...preset.approaches.South },
      East: { ...preset.approaches.East },
      West: { ...preset.approaches.West },
    });
    if (preset.settingsPatch) {
      setSettings((prev) => ({ ...prev, ...preset.settingsPatch }));
    }
    setForcePedestrianWalk(false);
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA] text-zinc-950">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 h-14 bg-white border-b border-zinc-200 px-6 flex items-center justify-between gap-8">
        <a
          href="#top"
          className="font-display text-lg font-bold tracking-tight text-zinc-950 whitespace-nowrap shrink-0"
        >
          SignalGrid
        </a>

        <nav
          aria-label="Primary sections"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-600"
        >
          <button
            type="button"
            onClick={() => scrollToSection('section-vision')}
            className="hover:text-zinc-950 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Vision Pipeline
          </button>
          <button
            type="button"
            onClick={() => scrollToSection('section-matrix')}
            className="hover:text-zinc-950 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Priority Matrix
          </button>
          <button
            type="button"
            onClick={() => scrollToSection('section-controller')}
            className="hover:text-zinc-950 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Binary Output
          </button>
          <button
            type="button"
            onClick={() => scrollToSection('section-python')}
            className="hover:text-zinc-950 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Python Source
          </button>
        </nav>

        <button
          type="button"
          onClick={() => setSimulationRunning((r) => !r)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {simulationRunning ? 'Pause Simulation' : 'Start Simulation'}
        </button>
      </header>

      {/* Hero Architecture Header & 5-Stage Pipeline Strip */}
      <section id="top" className="bg-white border-b border-zinc-200">
        <div className="max-w-[1440px] mx-auto px-6 py-8 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div className="max-w-3xl">
              <p className="text-xs font-medium text-zinc-500">
                Software-Only Control Architecture · 4-Direction Junction (North, South, East, West) · Digital Binary Output (0 &amp; 1)
              </p>
              <h1 className="mt-2 font-display text-2xl sm:text-4xl font-bold tracking-tight text-zinc-950 text-balance">
                Adaptive Traffic Signal Control Based on Pedestrian and Vehicle Density
              </h1>
              <p className="mt-3 text-sm sm:text-base text-zinc-600 leading-relaxed">
                Upload unlimited traffic camera images, folders, or videos to detect cars, bikes, buses, trucks, and waiting pedestrians locally with zero rate limits, compute priority scores with anti-starvation protection across four approaches, and inspect real-time simulated signals alongside binary 0 and 1 controller outputs.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setSimulationRunning((r) => !r)}
                className="h-10 px-5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {simulationRunning ? 'Pause Simulation' : 'Start Simulation'}
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('section-vision')}
                className="h-10 px-4 text-sm font-medium text-zinc-800 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Upload Traffic Image or Video
              </button>
            </div>
          </div>

          {/* 5-Stage Pipeline Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-4 border-t border-zinc-200">
            {PIPELINE_STEPS.map((step) => (
              <button
                key={step.num}
                type="button"
                onClick={() => scrollToSection(step.targetId)}
                className="p-3.5 text-left border border-zinc-200 hover:border-zinc-400 rounded-xl bg-zinc-50/50 transition-colors cursor-pointer"
              >
                <p className="font-mono text-xs font-semibold text-blue-700">
                  {step.num}. {step.title}
                </p>
                <p className="mt-1 text-xs text-zinc-600">{step.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Main 4-Stage Interactive Workspace */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-8 space-y-8">
        <VisionPipelineSection
          selectedRoad={selectedVisionRoad}
          onSelectRoad={setSelectedVisionRoad}
          mediaAssets={mediaAssets}
          onAddMediaAssets={handleAddMediaAssets}
          onUpdateMediaAsset={handleUpdateMediaAsset}
          onDeleteMediaAsset={handleDeleteMediaAsset}
          onApplyCountsToRoad={handleApplyCountsToRoad}
        />

        <PriorityMatrixSection
          approaches={approaches}
          settings={settings}
          decision={decision}
          onUpdateApproachField={handleUpdateApproachField}
          onUpdateSettings={handleUpdateSettings}
          onApplyPreset={handleApplyPreset}
        />

        <SignalControllerSection
          approaches={approaches}
          decision={decision}
          simulationRunning={simulationRunning}
          timerRemainingSec={timerRemainingSec}
          forcePedestrianWalk={forcePedestrianWalk}
          onToggleSimulation={() => setSimulationRunning((r) => !r)}
          onNextCycle={advanceNextCycle}
          onTogglePedestrianWalk={() => setForcePedestrianWalk((p) => !p)}
        />

        <PythonProjectSection approaches={approaches} settings={settings} />
      </main>

      <footer className="bg-white border-t border-zinc-200 px-6 py-5 text-xs text-zinc-500">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            Adaptive Traffic Signal Control Based on Pedestrian and Vehicle Density · Software Simulation &amp; Python Flask Reference
          </span>
          <span className="font-mono tabular-nums">
            Unlimited Local Image &amp; Video Dataset Pipeline · Zero API Rate Limits
          </span>
        </div>
      </footer>
    </div>
  );
}

export default App;
