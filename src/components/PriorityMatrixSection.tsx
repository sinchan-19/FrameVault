import React from 'react';
import {
  ApproachState,
  ClassBreakdownCounts,
  ControllerSettings,
  RoadDirection,
  TrafficControlDecision,
} from '../types/traffic';
import {
  REFERENCE_PRESETS,
  ReferencePreset,
  ROADS,
  sumVehicles,
} from '../utils/trafficLogic';

interface PriorityMatrixSectionProps {
  approaches: Record<RoadDirection, ApproachState>;
  settings: ControllerSettings;
  decision: TrafficControlDecision;
  onUpdateApproachField: (
    road: RoadDirection,
    field: keyof ClassBreakdownCounts | 'waitSec',
    value: number
  ) => void;
  onUpdateSettings: (patch: Partial<ControllerSettings>) => void;
  onApplyPreset: (preset: ReferencePreset) => void;
}

export const PriorityMatrixSection: React.FC<PriorityMatrixSectionProps> = ({
  approaches,
  settings,
  decision,
  onUpdateApproachField,
  onUpdateSettings,
  onApplyPreset,
}) => {
  const handleNumericChange = (
    road: RoadDirection,
    field: keyof ClassBreakdownCounts | 'waitSec',
    raw: string
  ) => {
    const num = Math.max(0, Math.floor(Number(raw) || 0));
    onUpdateApproachField(road, field, num);
  };

  return (
    <section
      id="section-matrix"
      className="bg-white border border-zinc-200 rounded-xl p-6 space-y-6"
    >
      {/* Header + Reference Dataset Presets */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 border-b border-zinc-200 pb-5">
        <div>
          <p className="text-xs font-medium text-zinc-500">
            02. Density Calculation &amp; Priority Calibration · Four-Direction Input Matrix
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold text-zinc-950">
            Four-Road Density &amp; Priority Scoring
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <span className="text-xs font-medium text-zinc-500 mr-1">
            Reference Dataset:
          </span>
          {REFERENCE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset)}
              className="h-8 px-3 text-xs font-medium text-zinc-800 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Approach Density Register Table */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-zinc-950">
              Approach Density Register
            </h3>
            <p className="text-xs text-zinc-500">
              Edit object counts directly or populate automatically from the vision detector above.
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-zinc-700 bg-zinc-100 px-3 py-1 rounded-md">
            Score = (V × {settings.vehicleWeight}) + (P × {settings.pedestrianWeight})
          </span>
        </div>

        <div className="border border-zinc-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[820px] text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <th className="py-3 px-4 font-medium">Approach</th>
                <th className="py-3 px-3 font-medium text-right">Cars</th>
                <th className="py-3 px-3 font-medium text-right">Bikes</th>
                <th className="py-3 px-3 font-medium text-right">Buses</th>
                <th className="py-3 px-3 font-medium text-right">Trucks</th>
                <th className="py-3 px-3 font-medium text-right">Vehicles</th>
                <th className="py-3 px-3 font-medium text-right">Pedestrians</th>
                <th className="py-3 px-3 font-medium text-right">Wait (s)</th>
                <th className="py-3 px-4 font-medium text-right">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {ROADS.map((road, idx) => {
                const app = approaches[road];
                const totalVehicles = sumVehicles(app);
                const isGreen = decision.signals[road] === 1;
                const isStarved = decision.starvationOverrides.includes(road);

                return (
                  <tr
                    key={road}
                    className={isGreen ? 'bg-emerald-50/40' : 'hover:bg-zinc-50/70'}
                  >
                    <td className="py-3 px-4">
                      <p className="font-semibold text-zinc-950">
                        Road {idx + 1} — {road}
                      </p>
                      <p
                        className={`text-[11px] font-mono mt-0.5 ${
                          isGreen
                            ? 'text-emerald-700 font-semibold'
                            : 'text-zinc-500'
                        }`}
                      >
                        {isGreen ? 'Active Green (1)' : 'Red Hold (0)'}
                        {isStarved ? ' · Max-Wait Boost' : ''}
                      </p>
                    </td>

                    {(
                      ['cars', 'bikes', 'buses', 'trucks'] as const
                    ).map((field) => (
                      <td key={field} className="py-2.5 px-2 text-right">
                        <input
                          type="number"
                          min="0"
                          aria-label={`${road} ${field}`}
                          value={app[field]}
                          onChange={(e) =>
                            handleNumericChange(road, field, e.target.value)
                          }
                          className="w-16 h-8 px-2 text-right font-mono tabular-nums text-xs bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-blue-600"
                        />
                      </td>
                    ))}

                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-zinc-900">
                      {totalVehicles}
                    </td>

                    <td className="py-2.5 px-2 text-right">
                      <input
                        type="number"
                        min="0"
                        aria-label={`${road} pedestrians`}
                        value={app.pedestrians}
                        onChange={(e) =>
                          handleNumericChange(road, 'pedestrians', e.target.value)
                        }
                        className="w-16 h-8 px-2 text-right font-mono tabular-nums text-xs bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-blue-600"
                      />
                    </td>

                    <td className="py-2.5 px-2 text-right">
                      <input
                        type="number"
                        min="0"
                        aria-label={`${road} wait time`}
                        value={app.waitSec}
                        onChange={(e) =>
                          handleNumericChange(road, 'waitSec', e.target.value)
                        }
                        className={`w-16 h-8 px-2 text-right font-mono tabular-nums text-xs bg-white border rounded-md focus:outline-none focus:border-blue-600 ${
                          app.waitSec >= settings.maxWaitThreshold
                            ? 'border-amber-500 text-amber-800 font-semibold'
                            : 'border-zinc-300'
                        }`}
                      />
                    </td>

                    <td className="py-3 px-4 text-right font-mono tabular-nums text-sm font-bold text-zinc-950">
                      {decision.priority[road]}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Decision Weights & Safety Rules */}
      <div className="pt-4 border-t border-zinc-200 space-y-4">
        <h3 className="text-sm font-semibold text-zinc-950">
          Decision Weights &amp; Safety Rules
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="border border-zinc-200 rounded-xl p-4">
            <label
              htmlFor="weight-vehicle"
              className="block text-xs font-medium text-zinc-600"
            >
              Vehicle Density Weight
            </label>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="weight-vehicle"
                type="number"
                min="1"
                max="20"
                value={settings.vehicleWeight}
                onChange={(e) =>
                  onUpdateSettings({
                    vehicleWeight: Math.max(1, Number(e.target.value) || 2),
                  })
                }
                className="w-20 h-9 px-2.5 font-mono tabular-nums text-sm font-semibold border border-zinc-300 rounded-lg"
              />
              <span className="text-xs text-zinc-500 font-mono">pts/vehicle</span>
            </div>
          </div>

          <div className="border border-zinc-200 rounded-xl p-4">
            <label
              htmlFor="weight-pedestrian"
              className="block text-xs font-medium text-zinc-600"
            >
              Pedestrian Density Weight
            </label>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="weight-pedestrian"
                type="number"
                min="1"
                max="20"
                value={settings.pedestrianWeight}
                onChange={(e) =>
                  onUpdateSettings({
                    pedestrianWeight: Math.max(1, Number(e.target.value) || 3),
                  })
                }
                className="w-20 h-9 px-2.5 font-mono tabular-nums text-sm font-semibold border border-zinc-300 rounded-lg"
              />
              <span className="text-xs text-zinc-500 font-mono">pts/person</span>
            </div>
          </div>

          <div className="border border-zinc-200 rounded-xl p-4">
            <label
              htmlFor="max-wait-limit"
              className="block text-xs font-medium text-zinc-600"
            >
              Maximum Waiting Time Limit
            </label>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="max-wait-limit"
                type="number"
                min="15"
                max="300"
                value={settings.maxWaitThreshold}
                onChange={(e) =>
                  onUpdateSettings({
                    maxWaitThreshold: Math.max(15, Number(e.target.value) || 90),
                  })
                }
                className="w-20 h-9 px-2.5 font-mono tabular-nums text-sm font-semibold border border-zinc-300 rounded-lg"
              />
              <span className="text-xs text-zinc-500 font-mono">seconds</span>
            </div>
          </div>

          <div className="border border-zinc-200 rounded-xl p-4 flex flex-col justify-between">
            <label className="inline-flex items-start gap-2 text-xs font-medium text-zinc-900 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.dedicatedPedestrianPhase}
                onChange={(e) =>
                  onUpdateSettings({
                    dedicatedPedestrianPhase: e.target.checked,
                  })
                }
                className="w-4 h-4 mt-0.5 rounded border-zinc-300 text-blue-600"
              />
              <span>Dedicated Safe Pedestrian Crossing Phase</span>
            </label>

            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-zinc-500">Threshold:</span>
              <input
                type="number"
                min="1"
                aria-label="Pedestrian demand threshold"
                value={settings.pedestrianThreshold}
                onChange={(e) =>
                  onUpdateSettings({
                    pedestrianThreshold: Math.max(1, Number(e.target.value) || 22),
                  })
                }
                className="w-16 h-8 px-2 font-mono tabular-nums text-xs border border-zinc-300 rounded-md"
              />
              <span className="text-[11px] text-zinc-500">
                (now {decision.totalPedestrians})
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
