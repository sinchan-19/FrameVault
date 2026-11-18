export type RoadDirection = 'North' | 'South' | 'East' | 'West';

export type TrafficObjectClass = 'car' | 'bike' | 'bus' | 'truck' | 'pedestrian';

export interface DetectedTrafficBox {
  id: string;
  label: TrafficObjectClass;
  confidence: number;
  /** Normalized [0..1] top-left X */
  x: number;
  /** Normalized [0..1] top-left Y */
  y: number;
  /** Normalized [0..1] width */
  width: number;
  /** Normalized [0..1] height */
  height: number;
}

export interface ClassBreakdownCounts {
  cars: number;
  bikes: number;
  buses: number;
  trucks: number;
  pedestrians: number;
}

export interface ApproachState extends ClassBreakdownCounts {
  road: RoadDirection;
  waitSec: number;
}

export interface ControllerSettings {
  vehicleWeight: number;
  pedestrianWeight: number;
  maxWaitThreshold: number;
  dedicatedPedestrianPhase: boolean;
  pedestrianThreshold: number;
}

export interface TrafficControlDecision {
  signals: Record<RoadDirection, 0 | 1>;
  pedestrian: 0 | 1;
  selectedRoad: RoadDirection | 'PEDESTRIAN_WALK_PHASE';
  priority: Record<RoadDirection, number>;
  vehicleTotals: Record<RoadDirection, number>;
  totalPedestrians: number;
  greenDurationSec: number;
  starvationOverrides: RoadDirection[];
  reason: string;
}

export interface TrafficMediaAsset {
  id: string;
  name: string;
  relativePath: string;
  kind: 'photo' | 'video';
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  durationSec?: number;
  assignedRoad: RoadDirection;
  isBuiltin?: boolean;
  builtinUrl?: string;
  lastDetection?: {
    counts: ClassBreakdownCounts;
    boxes: DetectedTrafficBox[];
    summary: string;
    analyzedAt: number;
  };
  createdAt: number;
}

export interface BatchScanLogEntry {
  id: string;
  mediaName: string;
  road: RoadDirection;
  timestampSec?: number;
  counts: ClassBreakdownCounts;
  totalVehicles: number;
}
