import React, { useEffect, useRef } from 'react';
import {
  ApproachState,
  RoadDirection,
  TrafficControlDecision,
} from '../types/traffic';
import { sumVehicles } from '../utils/trafficLogic';

interface JunctionCanvasProps {
  approaches: Record<RoadDirection, ApproachState>;
  decision: TrafficControlDecision;
  simulationRunning: boolean;
}

export const JunctionCanvas: React.FC<JunctionCanvasProps> = ({
  approaches,
  decision,
  simulationRunning,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseOffsetRef = useRef<number>(0);

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const draw = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (simulationRunning) {
        phaseOffsetRef.current = (phaseOffsetRef.current + dt * 75) % 10000;
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          renderIntersection(ctx, canvas.width, canvas.height, approaches, decision, phaseOffsetRef.current);
        }
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [approaches, decision, simulationRunning]);

  return (
    <div className="w-full bg-zinc-950 border border-zinc-200 rounded-xl overflow-hidden">
      <canvas
        ref={canvasRef}
        width={760}
        height={440}
        className="w-full h-auto block"
      />
    </div>
  );
};

function renderIntersection(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  approaches: Record<RoadDirection, ApproachState>,
  decision: TrafficControlDecision,
  offset: number
) {
  const cx = W / 2;
  const cy = H / 2;
  const roadHalf = 74;

  // Urban block ground
  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, W, H);

  // Subtle corner land parcels
  ctx.fillStyle = '#27272a';
  ctx.fillRect(16, 16, cx - roadHalf - 28, cy - roadHalf - 28);
  ctx.fillRect(cx + roadHalf + 12, 16, cx - roadHalf - 28, cy - roadHalf - 28);
  ctx.fillRect(16, cy + roadHalf + 12, cx - roadHalf - 28, cy - roadHalf - 28);
  ctx.fillRect(cx + roadHalf + 12, cy + roadHalf + 12, cx - roadHalf - 28, cy - roadHalf - 28);

  // Asphalt roads (North-South & East-West)
  ctx.fillStyle = '#09090b';
  ctx.fillRect(cx - roadHalf, 0, roadHalf * 2, H);
  ctx.fillRect(0, cy - roadHalf, W, roadHalf * 2);

  // Center yellow double lines
  ctx.strokeStyle = '#eab308';
  ctx.lineWidth = 2;
  // North center line
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, cy - roadHalf - 24);
  ctx.stroke();
  // South center line
  ctx.beginPath();
  ctx.moveTo(cx, cy + roadHalf + 24);
  ctx.lineTo(cx, H);
  ctx.stroke();
  // West center line
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(cx - roadHalf - 24, cy);
  ctx.stroke();
  // East center line
  ctx.beginPath();
  ctx.moveTo(cx + roadHalf + 24, cy);
  ctx.lineTo(W, cy);
  ctx.stroke();

  // Crosswalk zebra stripes on all 4 approaches
  ctx.fillStyle = decision.pedestrian === 1 ? '#34d399' : '#d4d4d8';
  for (let x = cx - roadHalf + 10; x < cx + roadHalf - 6; x += 16) {
    ctx.fillRect(x, cy - roadHalf - 20, 8, 16);
    ctx.fillRect(x, cy + roadHalf + 4, 8, 16);
  }
  for (let y = cy - roadHalf + 10; y < cy + roadHalf - 6; y += 16) {
    ctx.fillRect(cx - roadHalf - 20, y, 16, 8);
    ctx.fillRect(cx + roadHalf + 4, y, 16, 8);
  }

  // Draw vehicles for each approach
  drawApproachVehicles(ctx, 'North', cx, cy, roadHalf, W, H, approaches.North, decision.signals.North === 1, offset);
  drawApproachVehicles(ctx, 'South', cx, cy, roadHalf, W, H, approaches.South, decision.signals.South === 1, offset);
  drawApproachVehicles(ctx, 'East', cx, cy, roadHalf, W, H, approaches.East, decision.signals.East === 1, offset);
  drawApproachVehicles(ctx, 'West', cx, cy, roadHalf, W, H, approaches.West, decision.signals.West === 1, offset);

  // Draw waiting/crossing pedestrians
  drawApproachPedestrians(ctx, 'North', cx, cy, roadHalf, approaches.North.pedestrians, decision.pedestrian === 1, offset);
  drawApproachPedestrians(ctx, 'South', cx, cy, roadHalf, approaches.South.pedestrians, decision.pedestrian === 1, offset);
  drawApproachPedestrians(ctx, 'East', cx, cy, roadHalf, approaches.East.pedestrians, decision.pedestrian === 1, offset);
  drawApproachPedestrians(ctx, 'West', cx, cy, roadHalf, approaches.West.pedestrians, decision.pedestrian === 1, offset);

  // Signal Heads & Binary Readout Badges on all 4 Approaches
  drawSignalIndicator(ctx, cx - roadHalf - 62, cy - roadHalf - 46, 'NORTH', decision.signals.North, decision.priority.North);
  drawSignalIndicator(ctx, cx + roadHalf + 62, cy + roadHalf + 46, 'SOUTH', decision.signals.South, decision.priority.South);
  drawSignalIndicator(ctx, cx + roadHalf + 62, cy - roadHalf - 46, 'EAST', decision.signals.East, decision.priority.East);
  drawSignalIndicator(ctx, cx - roadHalf - 62, cy + roadHalf + 46, 'WEST', decision.signals.West, decision.priority.West);

  // Center Junction Phase Status Box
  ctx.fillStyle = 'rgba(9, 9, 11, 0.9)';
  ctx.strokeStyle = decision.pedestrian === 1 ? '#10b981' : '#3b82f6';
  ctx.lineWidth = 1.5;
  ctx.fillRect(cx - 58, cy - 26, 116, 52);
  ctx.strokeRect(cx - 58, cy - 26, 116, 52);

  ctx.fillStyle = '#a1a1aa';
  ctx.font = '600 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('PEDESTRIAN', cx, cy - 8);

  ctx.fillStyle = decision.pedestrian === 1 ? '#34d399' : '#f87171';
  ctx.font = '700 13px monospace';
  ctx.fillText(
    decision.pedestrian === 1 ? '1 · WALK' : '0 · STOP',
    cx,
    cy + 12
  );
  ctx.textAlign = 'left';
}

function drawApproachVehicles(
  ctx: CanvasRenderingContext2D,
  road: RoadDirection,
  cx: number,
  cy: number,
  roadHalf: number,
  W: number,
  H: number,
  state: ApproachState,
  isGreen: boolean,
  offset: number
) {
  const totalV = sumVehicles(state);
  const visibleCount = Math.min(8, Math.max(0, totalV));
  if (visibleCount === 0) return;

  for (let i = 0; i < visibleCount; i++) {
    const isHeavy = i < state.buses + state.trucks;
    const len = isHeavy ? 26 : 18;
    const wid = isHeavy ? 14 : 11;
    const laneOffset = i % 2 === 0 ? 22 : 48;

    ctx.fillStyle =
      i < state.buses
        ? '#f59e0b'
        : i < state.buses + state.trucks
        ? '#a855f7'
        : '#3b82f6';

    if (road === 'North') {
      // Moving southbound (top -> bottom) on left-hand incoming lanes
      const stopY = cy - roadHalf - 34 - Math.floor(i / 2) * 32;
      const y = isGreen
        ? ((stopY + offset) % (H + 60)) - 30
        : stopY;
      ctx.fillRect(cx - laneOffset - wid / 2, y - len / 2, wid, len);
    } else if (road === 'South') {
      // Moving northbound (bottom -> top) on right-hand incoming lanes
      const stopY = cy + roadHalf + 34 + Math.floor(i / 2) * 32;
      const y = isGreen
        ? H - (((H - stopY + offset) % (H + 60)) - 30)
        : stopY;
      ctx.fillRect(cx + laneOffset - wid / 2, y - len / 2, wid, len);
    } else if (road === 'East') {
      // Moving westbound (right -> left) on top incoming lanes
      const stopX = cx + roadHalf + 34 + Math.floor(i / 2) * 32;
      const x = isGreen
        ? W - (((W - stopX + offset) % (W + 60)) - 30)
        : stopX;
      ctx.fillRect(x - len / 2, cy - laneOffset - wid / 2, len, wid);
    } else if (road === 'West') {
      // Moving eastbound (left -> right) on bottom incoming lanes
      const stopX = cx - roadHalf - 34 - Math.floor(i / 2) * 32;
      const x = isGreen
        ? ((stopX + offset) % (W + 60)) - 30
        : stopX;
      ctx.fillRect(x - len / 2, cy + laneOffset - wid / 2, len, wid);
    }
  }
}

function drawApproachPedestrians(
  ctx: CanvasRenderingContext2D,
  road: RoadDirection,
  cx: number,
  cy: number,
  roadHalf: number,
  pedCount: number,
  walkActive: boolean,
  offset: number
) {
  const count = Math.min(8, Math.max(0, pedCount));
  if (count === 0) return;

  const crossProgress = walkActive ? (offset % 140) / 140 : 0;

  for (let i = 0; i < count; i++) {
    ctx.fillStyle = walkActive ? '#34d399' : '#f4f4f5';
    const spread = (i - (count - 1) / 2) * 10;

    let px = cx;
    let py = cy;

    if (road === 'North') {
      px = cx + roadHalf + 14 - crossProgress * (roadHalf * 2 + 28);
      py = cy - roadHalf - 12 + spread * 0.4;
    } else if (road === 'South') {
      px = cx - roadHalf - 14 + crossProgress * (roadHalf * 2 + 28);
      py = cy + roadHalf + 12 + spread * 0.4;
    } else if (road === 'East') {
      px = cx + roadHalf + 12 + spread * 0.4;
      py = cy + roadHalf + 14 - crossProgress * (roadHalf * 2 + 28);
    } else {
      px = cx - roadHalf - 12 + spread * 0.4;
      py = cy - roadHalf - 14 + crossProgress * (roadHalf * 2 + 28);
    }

    ctx.beginPath();
    ctx.arc(px, py, 3.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSignalIndicator(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  binary: 0 | 1,
  score: number
) {
  const boxW = 96;
  const boxH = 44;
  ctx.fillStyle = '#09090b';
  ctx.strokeStyle = binary === 1 ? '#22c55e' : '#ef4444';
  ctx.lineWidth = 1.5;
  ctx.fillRect(x - boxW / 2, y - boxH / 2, boxW, boxH);
  ctx.strokeRect(x - boxW / 2, y - boxH / 2, boxW, boxH);

  ctx.fillStyle = '#a1a1aa';
  ctx.font = '600 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${label} · P:${score}`, x, y - 5);

  ctx.fillStyle = binary === 1 ? '#4ade80' : '#f87171';
  ctx.font = '700 12px monospace';
  ctx.fillText(binary === 1 ? '1 · GREEN' : '0 · RED', x, y + 13);
  ctx.textAlign = 'left';
}
