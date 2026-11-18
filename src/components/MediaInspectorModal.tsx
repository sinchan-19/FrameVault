import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Plus,
  SquareDashedMousePointer,
  Trash2,
  X,
} from 'lucide-react';
import { loadMediaBlob, mediaUrlManager } from '../storage/mediaStorage';
import {
  BoundingBox,
  DatasetSplit,
  MediaItem,
  ReviewStatus,
  VideoSegment,
} from '../types/dataset';
import {
  createId,
  fileStem,
  formatBytes,
  formatDuration,
  formatTimecodePrecise,
} from '../utils/formatters';
import { IngestFileCandidate } from '../utils/mediaProcessor';

interface MediaInspectorModalProps {
  item: MediaItem;
  datasetClasses: string[];
  currentIndex: number;
  totalCount: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onUpdateItem: (updated: MediaItem) => Promise<void>;
  onDeleteItem: (item: MediaItem) => Promise<void>;
  onIngestExtractedFrame: (candidate: IngestFileCandidate, labels: string[], split: DatasetSplit) => Promise<void>;
}

const SPLIT_OPTIONS: Array<{ value: DatasetSplit; label: string }> = [
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'train', label: 'Train' },
  { value: 'val', label: 'Validation' },
  { value: 'test', label: 'Test' },
];

const STATUS_OPTIONS: Array<{ value: ReviewStatus; label: string }> = [
  { value: 'unreviewed', label: 'Unreviewed' },
  { value: 'approved', label: 'Approved' },
  { value: 'flagged', label: 'Flagged' },
];

export const MediaInspectorModal: React.FC<MediaInspectorModalProps> = ({
  item,
  datasetClasses,
  currentIndex,
  totalCount,
  onClose,
  onPrev,
  onNext,
  onUpdateItem,
  onDeleteItem,
  onIngestExtractedFrame,
}) => {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(true);
  const [newLabelInput, setNewLabelInput] = useState('');
  const [captionDraft, setCaptionDraft] = useState(item.caption);

  // Photo bounding-box drawing state
  const [drawMode, setDrawMode] = useState(false);
  const [showBoxes, setShowBoxes] = useState(true);
  const [activeBoxLabel, setActiveBoxLabel] = useState<string>(
    item.labels[0] || datasetClasses[0] || 'object'
  );
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [draftBox, setDraftBox] = useState<{
    startX: number;
    startY: number;
    currX: number;
    currY: number;
  } | null>(null);
  const imageStageRef = useRef<HTMLDivElement>(null);

  // Video player & temporal segment state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [segStart, setSegStart] = useState<number>(0);
  const [segEnd, setSegEnd] = useState<number>(1);
  const [segLabel, setSegLabel] = useState<string>(
    item.labels[0] || datasetClasses[0] || 'action'
  );
  const [extractingFrame, setExtractingFrame] = useState(false);
  const [frameNotice, setFrameNotice] = useState<string | null>(null);

  useEffect(() => {
    setCaptionDraft(item.caption);
    setSelectedBoxId(null);
    setDraftBox(null);
    setFrameNotice(null);
    setCurrentTime(0);
    setSegStart(0);
    setSegEnd(Math.min(item.durationSec || 1, 2));
    if (item.labels[0]) {
      setActiveBoxLabel(item.labels[0]);
      setSegLabel(item.labels[0]);
    }
  }, [item.id]);

  useEffect(() => {
    let cancelled = false;
    setLoadingUrl(true);
    mediaUrlManager.getFullMediaUrl(item).then((url) => {
      if (!cancelled) {
        setMediaUrl(url);
        setLoadingUrl(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT';
      if (e.key === 'Escape') {
        onClose();
      } else if (!isInput && e.key === 'ArrowLeft') {
        onPrev();
      } else if (!isInput && e.key === 'ArrowRight') {
        onNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, onPrev, onNext]);

  const handleSplitChange = (split: DatasetSplit) => {
    onUpdateItem({ ...item, split, updatedAt: Date.now() });
  };

  const handleStatusChange = (status: ReviewStatus) => {
    onUpdateItem({ ...item, status, updatedAt: Date.now() });
  };

  const handleToggleLabel = (label: string) => {
    const exists = item.labels.includes(label);
    const nextLabels = exists
      ? item.labels.filter((l) => l !== label)
      : [...item.labels, label];
    onUpdateItem({ ...item, labels: nextLabels, updatedAt: Date.now() });
  };

  const handleAddCustomLabel = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newLabelInput.trim().toLowerCase().replace(/\s+/g, '_');
    if (!cleaned) return;
    if (!item.labels.includes(cleaned)) {
      onUpdateItem({
        ...item,
        labels: [...item.labels, cleaned],
        updatedAt: Date.now(),
      });
    }
    setActiveBoxLabel(cleaned);
    setSegLabel(cleaned);
    setNewLabelInput('');
  };

  const handleCaptionBlur = () => {
    if (captionDraft !== item.caption) {
      onUpdateItem({ ...item, caption: captionDraft, updatedAt: Date.now() });
    }
  };

  // Bounding box mouse handlers on photo stage
  const getNormalizedPoint = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = imageStageRef.current;
    if (!el) return { nx: 0, ny: 0 };
    const rect = el.getBoundingClientRect();
    const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { nx, ny };
  };

  const handleStageMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!drawMode || item.kind !== 'photo') return;
    e.preventDefault();
    const { nx, ny } = getNormalizedPoint(e);
    setDraftBox({ startX: nx, startY: ny, currX: nx, currY: ny });
  };

  const handleStageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!draftBox) return;
    const { nx, ny } = getNormalizedPoint(e);
    setDraftBox((prev) => (prev ? { ...prev, currX: nx, currY: ny } : null));
  };

  const handleStageMouseUp = () => {
    if (!draftBox) return;
    const x = Math.min(draftBox.startX, draftBox.currX);
    const y = Math.min(draftBox.startY, draftBox.currY);
    const width = Math.abs(draftBox.currX - draftBox.startX);
    const height = Math.abs(draftBox.currY - draftBox.startY);
    setDraftBox(null);

    if (width < 0.015 || height < 0.015) return;

    const label = activeBoxLabel.trim() || 'object';
    const newBox: BoundingBox = {
      id: createId('box'),
      label,
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4)),
      width: Number(width.toFixed(4)),
      height: Number(height.toFixed(4)),
    };

    const nextLabels = item.labels.includes(label) ? item.labels : [...item.labels, label];
    onUpdateItem({
      ...item,
      labels: nextLabels,
      boxes: [...item.boxes, newBox],
      updatedAt: Date.now(),
    });
    setSelectedBoxId(newBox.id);
  };

  const handleDeleteBox = (boxId: string) => {
    onUpdateItem({
      ...item,
      boxes: item.boxes.filter((b) => b.id !== boxId),
      updatedAt: Date.now(),
    });
    if (selectedBoxId === boxId) setSelectedBoxId(null);
  };

  // Video controls & snapshot extraction
  const handleStepFrame = (frames: number) => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.pause();
    const next = Math.max(0, Math.min(vid.duration || 0, vid.currentTime + frames / 30));
    vid.currentTime = next;
    setCurrentTime(next);
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const handleAddSegment = (e: React.FormEvent) => {
    e.preventDefault();
    const start = Math.min(segStart, segEnd);
    const end = Math.max(segStart, segEnd);
    if (end - start < 0.05) return;
    const label = segLabel.trim() || 'segment';
    const newSeg: VideoSegment = {
      id: createId('seg'),
      label,
      startSec: Number(start.toFixed(2)),
      endSec: Number(end.toFixed(2)),
    };
    const nextLabels = item.labels.includes(label) ? item.labels : [...item.labels, label];
    onUpdateItem({
      ...item,
      labels: nextLabels,
      segments: [...item.segments, newSeg],
      updatedAt: Date.now(),
    });
  };

  const handleDeleteSegment = (segId: string) => {
    onUpdateItem({
      ...item,
      segments: item.segments.filter((s) => s.id !== segId),
      updatedAt: Date.now(),
    });
  };

  const handleCaptureCurrentVideoFrame = async () => {
    const vid = videoRef.current;
    if (!vid || extractingFrame) return;
    setExtractingFrame(true);
    setFrameNotice(null);
    try {
      const w = vid.videoWidth || item.width || 1280;
      const h = vid.videoHeight || item.height || 720;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(vid, 0, 0, w, h);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/webp', 0.92)
      );
      if (!blob) throw new Error('Frame capture failed');

      const tsLabel = vid.currentTime.toFixed(2).replace('.', 's');
      const frameFile = new File(
        [blob],
        `${fileStem(item.name)}_frame_${tsLabel}.webp`,
        { type: 'image/webp' }
      );
      await onIngestExtractedFrame(
        { file: frameFile, relativePath: `extracted_frames/${frameFile.name}` },
        item.labels,
        item.split
      );
      setFrameNotice(`Saved frame at ${formatTimecodePrecise(vid.currentTime)} to dataset`);
    } catch {
      setFrameNotice('Unable to capture frame from this video codec');
    } finally {
      setExtractingFrame(false);
    }
  };

  const handleDownloadOriginal = async () => {
    const blob = await loadMediaBlob(item);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  };

  const suggestedClasses = Array.from(new Set([...datasetClasses, ...item.labels]));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Inspecting ${item.name}`}
      className="fixed inset-0 z-50 bg-zinc-950/90 flex flex-col lg:flex-row overflow-hidden"
    >
      {/* Left/Center Darkroom Media Stage */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-zinc-950 text-zinc-100">
        {/* Stage Header */}
        <div className="h-14 px-5 border-b border-zinc-800 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-mono tabular-nums text-xs text-zinc-400 shrink-0">
              {currentIndex + 1} / {totalCount}
            </span>
            <h2 className="text-sm font-medium text-white truncate">{item.name}</h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {item.kind === 'photo' && (
              <>
                <button
                  type="button"
                  onClick={() => setDrawMode((d) => !d)}
                  className={`h-8 px-3 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    drawMode
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                  }`}
                >
                  <SquareDashedMousePointer className="w-3.5 h-3.5" />
                  <span>{drawMode ? 'Drawing Boxes' : 'Draw Bounding Box'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowBoxes((s) => !s)}
                  className="h-8 px-2.5 rounded-md text-xs font-medium bg-zinc-800 text-zinc-200 hover:bg-zinc-700 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {showBoxes ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  <span>{showBoxes ? 'Hide Boxes' : 'Show Boxes'}</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onPrev}
              disabled={currentIndex <= 0}
              aria-label="Previous item"
              className="w-8 h-8 rounded-md bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-35 inline-flex items-center justify-center cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={currentIndex >= totalCount - 1}
              aria-label="Next item"
              className="w-8 h-8 rounded-md bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-35 inline-flex items-center justify-center cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close inspector"
              className="h-8 px-3 rounded-md bg-zinc-800 text-zinc-200 hover:bg-zinc-700 text-xs font-medium inline-flex items-center gap-1 cursor-pointer ml-1"
            >
              <X className="w-4 h-4" />
              <span>Close</span>
            </button>
          </div>
        </div>

        {/* Draw Mode Class Bar (when drawing boxes on photo) */}
        {item.kind === 'photo' && drawMode && (
          <div className="px-5 py-2.5 bg-zinc-900 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-zinc-300">
              Click and drag on the photograph to draw a normalized bounding box.
            </span>
            <div className="flex items-center gap-2">
              <label htmlFor="active-box-class" className="text-zinc-400">
                Active Box Class:
              </label>
              <input
                id="active-box-class"
                type="text"
                value={activeBoxLabel}
                onChange={(e) => setActiveBoxLabel(e.target.value)}
                list="dataset-class-suggestions"
                className="h-7 px-2.5 bg-zinc-950 border border-zinc-700 rounded text-white font-mono text-xs focus:outline-none focus:border-blue-500"
              />
              <datalist id="dataset-class-suggestions">
                {suggestedClasses.map((cls) => (
                  <option key={cls} value={cls} />
                ))}
              </datalist>
            </div>
          </div>
        )}

        {/* Main Viewport Canvas */}
        <div className="flex-1 p-6 flex items-center justify-center overflow-auto min-h-0">
          {loadingUrl || !mediaUrl ? (
            <div className="text-sm text-zinc-400 font-mono">Loading full-resolution stream...</div>
          ) : item.kind === 'photo' ? (
            <div
              ref={imageStageRef}
              onMouseDown={handleStageMouseDown}
              onMouseMove={handleStageMouseMove}
              onMouseUp={handleStageMouseUp}
              onMouseLeave={handleStageMouseUp}
              className={`relative inline-block max-w-full max-h-full select-none ${
                drawMode ? 'cursor-crosshair' : 'cursor-default'
              }`}
            >
              <img
                src={mediaUrl}
                alt={item.name}
                draggable={false}
                referrerPolicy="no-referrer"
                className="max-w-full max-h-[75vh] object-contain block rounded"
              />

              {/* Saved Bounding Boxes */}
              {showBoxes &&
                item.boxes.map((box) => {
                  const isBoxSelected = selectedBoxId === box.id;
                  return (
                    <div
                      key={box.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedBoxId(box.id);
                      }}
                      style={{
                        left: `${box.x * 100}%`,
                        top: `${box.y * 100}%`,
                        width: `${box.width * 100}%`,
                        height: `${box.height * 100}%`,
                      }}
                      className={`absolute border-2 transition-colors ${
                        isBoxSelected
                          ? 'border-amber-400 bg-amber-400/15'
                          : 'border-blue-500 bg-blue-500/10 hover:bg-blue-500/20'
                      }`}
                    >
                      <span
                        className={`absolute -top-5 left-0 px-1.5 py-0.5 text-[11px] font-mono leading-none rounded-t ${
                          isBoxSelected
                            ? 'bg-amber-400 text-zinc-950 font-semibold'
                            : 'bg-blue-600 text-white'
                        }`}
                      >
                        {box.label}
                      </span>
                    </div>
                  );
                })}

              {/* Active Dragging Draft Box */}
              {draftBox && (
                <div
                  style={{
                    left: `${Math.min(draftBox.startX, draftBox.currX) * 100}%`,
                    top: `${Math.min(draftBox.startY, draftBox.currY) * 100}%`,
                    width: `${Math.abs(draftBox.currX - draftBox.startX) * 100}%`,
                    height: `${Math.abs(draftBox.currY - draftBox.startY) * 100}%`,
                  }}
                  className="absolute border-2 border-dashed border-white bg-blue-500/20 pointer-events-none"
                />
              )}
            </div>
          ) : (
            <div className="w-full max-w-4xl flex flex-col items-center gap-4">
              <video
                ref={videoRef}
                src={mediaUrl}
                controls
                playsInline
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                className="w-full max-h-[64vh] bg-black rounded border border-zinc-800"
              />

              {/* Video Frame & Temporal Segment Bar */}
              <div className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleStepFrame(-1)}
                    className="h-8 px-2.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono cursor-pointer"
                  >
                    -1f
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStepFrame(1)}
                    className="h-8 px-2.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono cursor-pointer"
                  >
                    +1f
                  </button>
                  <span className="font-mono tabular-nums text-zinc-300 px-2">
                    {formatTimecodePrecise(currentTime)} /{' '}
                    {formatTimecodePrecise(item.durationSec || 0)}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {[0.25, 0.5, 1, 1.5, 2].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => handleRateChange(rate)}
                      className={`h-7 px-2 rounded font-mono text-xs cursor-pointer ${
                        playbackRate === rate
                          ? 'bg-blue-600 text-white'
                          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={extractingFrame}
                  onClick={handleCaptureCurrentVideoFrame}
                  className="h-8 px-3 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>{extractingFrame ? 'Saving Frame...' : 'Extract Current Frame'}</span>
                </button>
              </div>

              {frameNotice && (
                <p className="text-xs font-mono text-emerald-400">{frameNotice}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Light Studio Inspector Sidebar */}
      <aside className="w-full lg:w-[390px] bg-white border-t lg:border-t-0 lg:border-l border-zinc-200 flex flex-col max-h-[45vh] lg:max-h-full overflow-y-auto shrink-0">
        <div className="p-5 space-y-6">
          {/* Curation Status & Dataset Split */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="inspector-split"
                className="block text-xs font-medium text-zinc-600 mb-1"
              >
                Dataset Split
              </label>
              <select
                id="inspector-split"
                value={item.split}
                onChange={(e) => handleSplitChange(e.target.value as DatasetSplit)}
                className="w-full h-9 px-2.5 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-600"
              >
                {SPLIT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="inspector-status"
                className="block text-xs font-medium text-zinc-600 mb-1"
              >
                Review Status
              </label>
              <select
                id="inspector-status"
                value={item.status}
                onChange={(e) => handleStatusChange(e.target.value as ReviewStatus)}
                className="w-full h-9 px-2.5 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-600"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Class Labels */}
          <div className="pt-5 border-t border-zinc-200">
            <h3 className="text-xs font-semibold text-zinc-900">Class Labels</h3>
            <form onSubmit={handleAddCustomLabel} className="mt-2 flex gap-2">
              <input
                type="text"
                placeholder="Add class label..."
                value={newLabelInput}
                onChange={(e) => setNewLabelInput(e.target.value)}
                className="flex-1 h-9 px-3 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-600"
              />
              <button
                type="submit"
                className="h-9 px-3 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1 cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </form>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {suggestedClasses.map((label) => {
                const active = item.labels.includes(label);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => handleToggleLabel(label)}
                    className={`px-2.5 py-1 text-xs font-mono rounded-md border transition-colors cursor-pointer ${
                      active
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-zinc-50 border-zinc-200 text-zinc-700 hover:border-zinc-400'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Caption / Description */}
          <div className="pt-5 border-t border-zinc-200">
            <label
              htmlFor="inspector-caption"
              className="block text-xs font-semibold text-zinc-900 mb-1.5"
            >
              Caption &amp; Notes
            </label>
            <textarea
              id="inspector-caption"
              rows={2}
              placeholder="Describe scene contents, lighting, or action..."
              value={captionDraft}
              onChange={(e) => setCaptionDraft(e.target.value)}
              onBlur={handleCaptionBlur}
              className="w-full p-2.5 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>

          {/* Photo Bounding Boxes OR Video Temporal Segments */}
          {item.kind === 'photo' ? (
            <div className="pt-5 border-t border-zinc-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-zinc-900">
                  Bounding Boxes ({item.boxes.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setDrawMode((d) => !d)}
                  className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
                >
                  {drawMode ? 'Done Drawing' : '+ Draw Box'}
                </button>
              </div>

              {item.boxes.length === 0 ? (
                <p className="mt-2 text-xs text-zinc-500">
                  No bounding boxes yet. Enable Draw Bounding Box to annotate regions.
                </p>
              ) : (
                <div className="mt-2.5 divide-y divide-zinc-100 border border-zinc-200 rounded-lg">
                  {item.boxes.map((box) => (
                    <div
                      key={box.id}
                      onClick={() => setSelectedBoxId(box.id)}
                      className={`px-3 py-2 flex items-center justify-between gap-2 text-xs cursor-pointer ${
                        selectedBoxId === box.id ? 'bg-blue-50' : 'hover:bg-zinc-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-mono font-medium text-zinc-900 truncate">
                          {box.label}
                        </p>
                        <p className="font-mono tabular-nums text-[11px] text-zinc-500">
                          x:{box.x.toFixed(2)} y:{box.y.toFixed(2)} w:{box.width.toFixed(2)} h:
                          {box.height.toFixed(2)}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove box ${box.label}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteBox(box.id);
                        }}
                        className="p-1 text-zinc-400 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="pt-5 border-t border-zinc-200">
              <h3 className="text-xs font-semibold text-zinc-900">
                Temporal Video Segments ({item.segments.length})
              </h3>
              <form onSubmit={handleAddSegment} className="mt-2.5 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-zinc-500 mb-1">
                      <span>Start (s)</span>
                      <button
                        type="button"
                        onClick={() => setSegStart(Number(currentTime.toFixed(2)))}
                        className="text-blue-600 hover:underline cursor-pointer"
                      >
                        Use Playhead
                      </button>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={segStart}
                      onChange={(e) => setSegStart(parseFloat(e.target.value) || 0)}
                      className="w-full h-8 px-2 font-mono tabular-nums text-xs border border-zinc-300 rounded"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-zinc-500 mb-1">
                      <span>End (s)</span>
                      <button
                        type="button"
                        onClick={() => setSegEnd(Number(currentTime.toFixed(2)))}
                        className="text-blue-600 hover:underline cursor-pointer"
                      >
                        Use Playhead
                      </button>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={segEnd}
                      onChange={(e) => setSegEnd(parseFloat(e.target.value) || 0)}
                      className="w-full h-8 px-2 font-mono tabular-nums text-xs border border-zinc-300 rounded"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Segment action label..."
                    value={segLabel}
                    onChange={(e) => setSegLabel(e.target.value)}
                    className="flex-1 h-8 px-2.5 text-xs border border-zinc-300 rounded"
                  />
                  <button
                    type="submit"
                    className="h-8 px-3 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium rounded cursor-pointer shrink-0"
                  >
                    Mark Clip
                  </button>
                </div>
              </form>

              {item.segments.length > 0 && (
                <div className="mt-3 divide-y divide-zinc-100 border border-zinc-200 rounded-lg">
                  {item.segments.map((seg) => (
                    <div
                      key={seg.id}
                      onClick={() => {
                        if (videoRef.current) {
                          videoRef.current.currentTime = seg.startSec;
                          videoRef.current.play().catch(() => undefined);
                        }
                      }}
                      className="px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-zinc-50 cursor-pointer"
                    >
                      <div>
                        <p className="font-mono font-medium text-zinc-900">{seg.label}</p>
                        <p className="font-mono tabular-nums text-[11px] text-zinc-500">
                          {formatTimecodePrecise(seg.startSec)} —{' '}
                          {formatTimecodePrecise(seg.endSec)}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Delete segment ${seg.label}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSegment(seg.id);
                        }}
                        className="p-1 text-zinc-400 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Technical File Telemetry */}
          <div className="pt-5 border-t border-zinc-200">
            <h3 className="text-xs font-semibold text-zinc-900 mb-2.5">File Specifications</h3>
            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500">Dimensions</dt>
                <dd className="font-mono tabular-nums text-zinc-900">
                  {item.width} × {item.height} px
                </dd>
              </div>
              {item.kind === 'video' && (
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500">Duration</dt>
                  <dd className="font-mono tabular-nums text-zinc-900">
                    {formatDuration(item.durationSec)} ({(item.durationSec ?? 0).toFixed(2)}s)
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500">File Size</dt>
                <dd className="font-mono tabular-nums text-zinc-900">
                  {formatBytes(item.sizeBytes)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500">MIME Type</dt>
                <dd className="font-mono text-zinc-900">{item.mimeType}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500">Storage Backend</dt>
                <dd className="font-mono uppercase text-zinc-900">{item.storageMode}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500">SHA-256</dt>
                <dd className="font-mono text-zinc-700 truncate max-w-[200px]" title={item.sha256}>
                  {item.sha256.slice(0, 16)}…
                </dd>
              </div>
            </dl>
          </div>

          {/* Actions Footer */}
          <div className="pt-5 border-t border-zinc-200 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleDownloadOriginal}
              className="h-9 px-3.5 text-xs font-medium text-zinc-800 bg-zinc-100 hover:bg-zinc-200 rounded-lg cursor-pointer"
            >
              Download Original
            </button>

            <button
              type="button"
              onClick={() => onDeleteItem(item)}
              className="h-9 px-3.5 text-xs font-medium text-red-700 hover:bg-red-50 border border-red-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Item</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};
