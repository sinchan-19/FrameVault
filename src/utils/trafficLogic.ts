import {
  ApproachState,
  ClassBreakdownCounts,
  ControllerSettings,
  RoadDirection,
  TrafficControlDecision,
} from '../types/traffic';

export const ROADS: RoadDirection[] = ['North', 'South', 'East', 'West'];

export function sumVehicles(counts: ClassBreakdownCounts): number {
  return counts.cars + counts.bikes + counts.buses + counts.trucks;
}

export function evaluateTrafficControl(
  approaches: Record<RoadDirection, ApproachState>,
  settings: ControllerSettings,
  forcePedestrianWalk = false
): TrafficControlDecision {
  const vehicleTotals: Record<RoadDirection, number> = {
    North: sumVehicles(approaches.North),
    South: sumVehicles(approaches.South),
    East: sumVehicles(approaches.East),
    West: sumVehicles(approaches.West),
  };

  const priority: Record<RoadDirection, number> = {
    North: 0,
    South: 0,
    East: 0,
    West: 0,
  };

  const starvationOverrides: RoadDirection[] = [];

  for (const road of ROADS) {
    const app = approaches[road];
    const vCount = vehicleTotals[road];
    let score =
      vCount * settings.vehicleWeight +
      app.pedestrians * settings.pedestrianWeight;

    if (app.waitSec >= settings.maxWaitThreshold) {
      score += 1000 + app.waitSec;
      starvationOverrides.push(road);
    }

    priority[road] = Math.round(score * 100) / 100;
  }

  const signals: Record<RoadDirection, 0 | 1> = {
    North: 0,
    South: 0,
    East: 0,
    West: 0,
  };

  const totalPedestrians = ROADS.reduce(
    (sum, r) => sum + approaches[r].pedestrians,
    0
  );

  let pedestrian: 0 | 1 = 0;
  let selectedRoad: RoadDirection | 'PEDESTRIAN_WALK_PHASE';
  let greenDurationSec = 30;
  let reason = '';

  const pedPhaseTriggered =
    forcePedestrianWalk ||
    (settings.dedicatedPedestrianPhase &&
      totalPedestrians >= settings.pedestrianThreshold);

  if (pedPhaseTriggered) {
    pedestrian = 1;
    selectedRoad = 'PEDESTRIAN_WALK_PHASE';
    greenDurationSec = 25;
    reason = forcePedestrianWalk
      ? `Manual Safe Pedestrian Walk activated (${totalPedestrians} waiting across 4 curbs). All vehicle signals locked to 0 (RED).`
      : `Dedicated Safe Pedestrian Phase triggered: ${totalPedestrians} waiting pedestrians reached threshold (${settings.pedestrianThreshold}). All vehicle signals set to 0 (RED).`;
  } else {
    let bestRoad: RoadDirection = 'North';
    let bestScore = -Infinity;
    for (const road of ROADS) {
      if (priority[road] > bestScore) {
        bestScore = priority[road];
        bestRoad = road;
      }
    }

    selectedRoad = bestRoad;
    signals[bestRoad] = 1;
    pedestrian = 0;

    const winningVehicles = vehicleTotals[bestRoad];
    const winningPeds = approaches[bestRoad].pedestrians;
    greenDurationSec = Math.min(
      60,
      Math.max(15, Math.round(18 + winningVehicles * 0.75))
    );

    if (starvationOverrides.includes(bestRoad)) {
      reason = `Anti-starvation override on Road ${ROADS.indexOf(bestRoad) + 1} (${bestRoad}): wait time ${approaches[bestRoad].waitSec}s reached ${settings.maxWaitThreshold}s limit (boosted score ${bestScore}).`;
    } else {
      reason = `Road ${ROADS.indexOf(bestRoad) + 1} (${bestRoad}) achieved highest composite score (${bestScore}) with ${winningVehicles} vehicles and ${winningPeds} pedestrians.`;
    }
  }

  return {
    signals,
    pedestrian,
    selectedRoad,
    priority,
    vehicleTotals,
    totalPedestrians,
    greenDurationSec,
    starvationOverrides,
    reason,
  };
}

export interface ReferencePreset {
  id: string;
  label: string;
  approaches: Record<RoadDirection, ApproachState>;
  settingsPatch?: Partial<ControllerSettings>;
}

export const REFERENCE_PRESETS: ReferencePreset[] = [
  {
    id: 'default_commuter',
    label: 'Commuter Corridor (East 79)',
    approaches: {
      North: { road: 'North', cars: 18, bikes: 5, buses: 1, trucks: 1, pedestrians: 5, waitSec: 32 },
      South: { road: 'South', cars: 6, bikes: 4, buses: 0, trucks: 0, pedestrians: 12, waitSec: 45 },
      East: { road: 'East', cars: 22, bikes: 6, buses: 2, trucks: 5, pedestrians: 3, waitSec: 18 },
      West: { road: 'West', cars: 6, bikes: 2, buses: 0, trucks: 0, pedestrians: 15, waitSec: 54 },
    },
    settingsPatch: { dedicatedPedestrianPhase: false },
  },
  {
    id: 'north_peak',
    label: 'North Peak (30V / 12P)',
    approaches: {
      North: { road: 'North', cars: 22, bikes: 5, buses: 2, trucks: 1, pedestrians: 12, waitSec: 28 },
      South: { road: 'South', cars: 8, bikes: 2, buses: 0, trucks: 0, pedestrians: 4, waitSec: 36 },
      East: { road: 'East', cars: 11, bikes: 3, buses: 1, trucks: 0, pedestrians: 3, waitSec: 22 },
      West: { road: 'West', cars: 5, bikes: 1, buses: 0, trucks: 0, pedestrians: 6, waitSec: 40 },
    },
    settingsPatch: { dedicatedPedestrianPhase: false },
  },
  {
    id: 'safe_ped_walk',
    label: 'Safe Pedestrian Walk',
    approaches: {
      North: { road: 'North', cars: 9, bikes: 2, buses: 1, trucks: 0, pedestrians: 11, waitSec: 25 },
      South: { road: 'South', cars: 7, bikes: 3, buses: 0, trucks: 0, pedestrians: 9, waitSec: 30 },
      East: { road: 'East', cars: 10, bikes: 2, buses: 0, trucks: 1, pedestrians: 8, waitSec: 19 },
      West: { road: 'West', cars: 5, bikes: 2, buses: 0, trucks: 0, pedestrians: 10, waitSec: 33 },
    },
    settingsPatch: { dedicatedPedestrianPhase: true, pedestrianThreshold: 22 },
  },
  {
    id: 'max_wait_override',
    label: 'Max-Wait Override',
    approaches: {
      North: { road: 'North', cars: 14, bikes: 3, buses: 1, trucks: 0, pedestrians: 4, waitSec: 24 },
      South: { road: 'South', cars: 4, bikes: 1, buses: 0, trucks: 0, pedestrians: 3, waitSec: 94 },
      East: { road: 'East', cars: 24, bikes: 5, buses: 2, trucks: 3, pedestrians: 4, waitSec: 12 },
      West: { road: 'West', cars: 7, bikes: 2, buses: 0, trucks: 0, pedestrians: 6, waitSec: 48 },
    },
    settingsPatch: { dedicatedPedestrianPhase: false, maxWaitThreshold: 90 },
  },
];
