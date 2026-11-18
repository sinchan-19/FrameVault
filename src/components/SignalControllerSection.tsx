import React, { useState } from 'react';
import { Check, Copy, Download, Footprints, Pause, Play, SkipForward } from 'lucide-react';
import {
  ApproachState,
  RoadDirection,
  TrafficControlDecision,
} from '../types/traffic';
import { ROADS } from '../utils/trafficLogic';
import { JunctionCanvas } from './JunctionCanvas';

interface SignalControllerSectionProps {
  approaches: Record<RoadDirection, ApproachState>;
  decision: TrafficControlDecision;
  simulationRunning: boolean;
  timerRemainingSec: number;
  forcePedestrianWalk: boolean;
  onToggleSimulation: () => void;
  onNextCycle: () => void;
  onTogglePedestrianWalk: () => void;
}

export const SignalControllerSection: React.FC<SignalControllerSectionProps> = ({
  approaches,
  decision,
  simulationRunning,
  timerRemainingSec,
  forcePedestrianWalk,
  onToggleSimulation,
  onNextCycle,
  onTogglePedestrianWalk,
}) => {
  const [copiedRegister, setCopiedRegister] = useState(false);

  const registerText = `TRAFFIC SIGNAL BINARY OUTPUT
North = ${decision.signals.North}
South = ${decision.signals.South}
East  = ${decision.signals.East}
West  = ${decision.signals.West}

Pedestrian = ${decision.pedestrian}`;

  const handleCopyRegister = async () => {
    try {
      await navigator.clipboard.writeText(registerText);
      setCopiedRegister(true);
      window.setTimeout(() => setCopiedRegister(false), 2000);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const handleExportJson = () => {
    const payload = {
      timestamp: new Date().toISOString(),
      selected_phase: decision.selectedRoad,
      green_window_sec: decision.greenDurationSec,
      signals: decision.signals,
      pedestrian: decision.pedestrian,
      priority_scores: decision.priority,
      vehicle_totals: decision.vehicleTotals,
      total_pedestrians_waiting: decision.totalPedestrians,
      starvation_overrides: decision.starvationOverrides,
      approaches,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'traffic_signal_binary_output.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  };

  const activePhaseLabel =
    decision.selectedRoad === 'PEDESTRIAN_WALK_PHASE'
      ? 'Safe Pedestrian Crossing Phase (Pedestrian = 1)'
      : `${decision.selectedRoad} Green Corridor (${decision.selectedRoad} = 1)`;

  return (
    <section
      id="section-controller"
      className="bg-white border border-zinc-200 rounded-xl p-6 space-y-6"
    >
      {/* Header & Simulation Controls */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 border-b border-zinc-200 pb-5">
        <div>
          <p className="text-xs font-medium text-zinc-500">
            03. Adaptive Signal Controller &amp; Digital Binary Output · Live Four-Way Junction
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold text-zinc-950">
            Simulated Traffic Signals &amp; Binary Register (0 and 1)
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onToggleSimulation}
            className="h-9 px-4 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            {simulationRunning ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Pause Simulation</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Start Simulation</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onNextCycle}
            className="h-9 px-3.5 text-xs font-medium text-zinc-800 bg-zinc-100 hover:bg-zinc-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <SkipForward className="w-3.5 h-3.5 text-zinc-600" />
            <span>Next Cycle</span>
          </button>

          <button
            type="button"
            onClick={onTogglePedestrianWalk}
            className={`h-9 px-3.5 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              forcePedestrianWalk
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-zinc-100 text-zinc-800 hover:bg-zinc-200'
            }`}
          >
            <Footprints className="w-3.5 h-3.5" />
            <span>
              {forcePedestrianWalk ? 'Exit Pedestrian Walk' : 'Pedestrian Walk'}
            </span>
          </button>
        </div>
      </div>

      {/* Main Split: Left 4-Way Junction Stage, Right Binary Status Table & Register */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Columns: Live 4-Way Junction Canvas */}
        <div className="lg:col-span-7 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-zinc-900">
              Four-Road Adaptive Junction Stage
            </span>
            <span className="font-mono tabular-nums text-zinc-700">
              Active Phase: {activePhaseLabel} · Timer: {timerRemainingSec}s /{' '}
              {decision.greenDurationSec}s
            </span>
          </div>

          <JunctionCanvas
            approaches={approaches}
            decision={decision}
            simulationRunning={simulationRunning}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600">
            <span>{decision.reason}</span>
            <span className="font-mono tabular-nums font-medium text-zinc-900 shrink-0">
              Green Window: {decision.greenDurationSec}s
            </span>
          </div>
        </div>

        {/* Right 5 Columns: Adaptive Signal Status Table + Final Binary Register Readout */}
        <div className="lg:col-span-5 space-y-5">
          {/* Binary Status Table */}
          <div className="border border-zinc-200 rounded-xl overflow-hidden bg-white">
            <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
              <h3 className="text-sm font-semibold text-zinc-950">
                Adaptive Signal Status &amp; Binary Output
              </h3>
              <p className="text-xs text-zinc-500">
                Simulated digital output states (0 = OFF / RED / STOP · 1 = ON / GREEN / WALK)
              </p>
            </div>

            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-200 text-zinc-500 bg-zinc-50/50">
                  <th className="py-2.5 px-4 font-medium">Direction</th>
                  <th className="py-2.5 px-3 font-medium text-right">Score</th>
                  <th className="py-2.5 px-3 font-medium text-right">Binary</th>
                  <th className="py-2.5 px-4 font-medium text-right">Signal Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {ROADS.map((road) => {
                  const bin = decision.signals[road];
                  return (
                    <tr key={road}>
                      <td className="py-2.5 px-4 font-medium text-zinc-950">
                        {road}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-700">
                        {decision.priority[road]}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-zinc-950">
                        {bin}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right font-mono font-semibold ${
                          bin === 1 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {bin === 1 ? 'GREEN' : 'RED'}
                      </td>
                    </tr>
                  );
                })}

                <tr className="bg-zinc-50 font-medium">
                  <td className="py-2.5 px-4 text-zinc-950">Pedestrian Signal</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-600">
                    {decision.totalPedestrians} waiting
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-zinc-950">
                    {decision.pedestrian}
                  </td>
                  <td
                    className={`py-2.5 px-4 text-right font-mono font-semibold ${
                      decision.pedestrian === 1
                        ? 'text-emerald-700'
                        : 'text-red-700'
                    }`}
                  >
                    {decision.pedestrian === 1 ? 'WALK' : 'STOP'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Final Binary Register Readout */}
          <div className="border border-zinc-200 rounded-xl overflow-hidden bg-zinc-950 text-zinc-100">
            <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-zinc-300">
                Final Binary Register Readout
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyRegister}
                  className="h-7 px-2.5 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 inline-flex items-center gap-1 cursor-pointer"
                >
                  {copiedRegister ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleExportJson}
                  className="h-7 px-2.5 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 inline-flex items-center gap-1 cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  <span>Export JSON</span>
                </button>
              </div>
            </div>
            <pre className="p-4 text-xs font-mono leading-relaxed text-emerald-300 overflow-x-auto">
              {registerText}
            </pre>
            <p className="px-4 pb-3 text-[11px] text-zinc-400">
              Simulated software logic outputs (0 = OFF / RED / STOP, 1 = ON / GREEN / WALK). No external microcontroller or physical relay hardware required.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
