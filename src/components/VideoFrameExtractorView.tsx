import React, { useEffect, useState } from 'react';
import { Check, Film, Layers, Upload } from 'lucide-react';
import { loadMediaBlob, mediaUrlManager } from '../storage/mediaStorage';
import { DatasetSplit, MediaItem } from '../types/dataset';
import { fileStem, formatBytes, formatDuration } from '../utils/formatters';
import { extractFramesFromVideo, IngestFileCandidate } from '../utils/mediaProcessor';

interface VideoFrameExtractorViewProps {
  videos: MediaItem[];
  allItems: MediaItem[];
  onOpenAddMedia: () => void;
  onIngestExtractedFrames: (
    candidates: IngestFileCandidate[],
    labels: string[],
    split: DatasetSplit,
    sourceVideoId: string,
    timestamps: number[]
  ) => Promise<void>;
}

export const VideoFrameExtractorView: React.FC<VideoFrameExtractorViewProps> = ({
  videos,
  allItems,
  onOpenAddMedia,
  onIngestExtractedFrames,
}) => {
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(() =>
    videos[0] ? new Set([videos[0].id]) : new Set()
  );
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(
    videos[0]?.id ?? null
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [mode, setMode] = useState<'interval' | 'count'>('interval');
  const [intervalSec, setIntervalSec] = useState<number>(0.5);
  const [frameCount, setFrameCount] = useState<number>(20);
  const [format, setFormat] = useState<'image/webp' | 'image/jpeg' | 'image/png'>(
    'image/webp'
  );
  const [quality, setQuality] = useState<number>(0.9);
  const [inheritMetadata, setInheritMetadata] = useState<boolean>(true);

  const [extracting, setExtracting] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [completedNotice, setCompletedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (videos.length > 0 && !previewVideoId) {
      setPreviewVideoId(videos[0].id);
      setSelectedVideoIds(new Set([videos[0].id]));
    }
  }, [videos, previewVideoId]);

  const activePreviewVideo =
    videos.find((v) => v.id === previewVideoId) || videos[0] || null;

  useEffect(() => {
    if (!activePreviewVideo) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    mediaUrlManager.getFullMediaUrl(activePreviewVideo).then((url) => {
      if (!cancelled) setPreviewUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [activePreviewVideo?.id]);

  const toggleVideoSelection = (id: string) => {
    setSelectedVideoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const computeTimestampsForVideo = (video: MediaItem): number[] => {
    const dur = Math.max(0.1, video.durationSec || 1);
    if (mode === 'interval') {
      const step = Math.max(0.05, intervalSec);
      const timestamps: number[] = [];
      for (let t = 0; t < dur - 0.01; t += step) {
        timestamps.push(Number(t.toFixed(3)));
      }
      if (timestamps.length === 0) timestamps.push(0);
      return timestamps;
    } else {
      const count = Math.max(1, Math.floor(frameCount));
      if (count === 1) return [0];
      const timestamps: number[] = [];
      for (let i = 0; i < count; i++) {
        const t = (i / (count - 1)) * Math.max(0, dur - 0.05);
        timestamps.push(Number(t.toFixed(3)));
      }
      return timestamps;
    }
  };

  const selectedVideos = videos.filter((v) => selectedVideoIds.has(v.id));
  const estimatedTotalFrames = selectedVideos.reduce(
    (sum, v) => sum + computeTimestampsForVideo(v).length,
    0
  );

  const handleRunBatchExtraction = async () => {
    if (selectedVideos.length === 0 || extracting) return;
    setExtracting(true);
    setCompletedNotice(null);
    let totalExtracted = 0;

    try {
      const ext =
        format === 'image/png' ? 'png' : format === 'image/jpeg' ? 'jpg' : 'webp';

      for (let vIdx = 0; vIdx < selectedVideos.length; vIdx++) {
        const video = selectedVideos[vIdx];
        const blob = await loadMediaBlob(video);
        if (!blob) continue;

        const timestamps = computeTimestampsForVideo(video);
        const frames = await extractFramesFromVideo(
          blob,
          timestamps,
          format,
          quality,
          (done, total) => {
            setProgressText(
              `Video ${vIdx + 1}/${selectedVideos.length} (${video.name}): Frame ${done} of ${total}`
            );
          }
        );

        const stem = fileStem(video.name);
        const candidates: IngestFileCandidate[] = frames.map((f, idx) => {
          const tsTag = f.timestampSec.toFixed(2).replace('.', 's');
          const fileName = `${stem}_f${String(idx + 1).padStart(4, '0')}_${tsTag}.${ext}`;
          return {
            file: new File([f.blob], fileName, { type: format }),
            relativePath: `extracted_frames/${stem}/${fileName}`,
          };
        });

        await onIngestExtractedFrames(
          candidates,
          inheritMetadata ? video.labels : [],
          inheritMetadata ? video.split : 'unassigned',
          video.id,
          frames.map((f) => f.timestampSec)
        );

        totalExtracted += frames.length;
      }

      setCompletedNotice(
        `Extracted ${totalExtracted.toLocaleString()} frames from ${selectedVideos.length} ${
          selectedVideos.length === 1 ? 'video' : 'videos'
        } into the active dataset.`
      );
    } finally {
      setExtracting(false);
      setProgressText(null);
    }
  };

  if (videos.length === 0) {
    return (
      <section className="max-w-[1440px] mx-auto px-6 py-10">
        <div className="bg-white border border-zinc-200 rounded-2xl p-12 text-center max-w-xl mx-auto">
          <Film className="w-9 h-9 text-zinc-400 mx-auto mb-3" />
          <h2 className="font-display text-xl font-semibold text-zinc-950">
            No Videos in Active Dataset
          </h2>
          <p className="mt-2 text-sm text-zinc-600">
            Import MP4, WebM, MOV, or MKV videos to extract unlimited high-resolution training frames at any interval or frame count.
          </p>
          <button
            type="button"
            onClick={onOpenAddMedia}
            className="mt-6 h-10 px-5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center gap-2 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>Import Video Files</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-[1440px] mx-auto px-6 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Video Source Selection List */}
        <div className="lg:col-span-5 bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-zinc-950">
                Source Videos ({videos.length})
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Select one or multiple videos for batch frame extraction
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (selectedVideoIds.size === videos.length) {
                  setSelectedVideoIds(new Set());
                } else {
                  setSelectedVideoIds(new Set(videos.map((v) => v.id)));
                }
              }}
              className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
            >
              {selectedVideoIds.size === videos.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <div className="divide-y divide-zinc-100 max-h-[540px] overflow-y-auto">
            {videos.map((video) => {
              const checked = selectedVideoIds.has(video.id);
              const isPreview = activePreviewVideo?.id === video.id;
              const derivedCount = allItems.filter(
                (i) => i.sourceVideoId === video.id
              ).length;

              return (
                <div
                  key={video.id}
                  onClick={() => setPreviewVideoId(video.id)}
                  className={`px-5 py-3.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                    isPreview ? 'bg-blue-50/60' : 'hover:bg-zinc-50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      aria-label={`Select ${video.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleVideoSelection(video.id);
                      }}
                      className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center cursor-pointer ${
                        checked
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white border-zinc-300'
                      }`}
                    >
                      {checked && <Check className="w-3 h-3 stroke-[3]" />}
                    </button>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-950 truncate">
                        {video.name}
                      </p>
                      <p className="text-xs font-mono tabular-nums text-zinc-500 mt-0.5">
                        {formatDuration(video.durationSec)} · {video.width}×{video.height} ·{' '}
                        {formatBytes(video.sizeBytes)}
                      </p>
                    </div>
                  </div>

                  {derivedCount > 0 && (
                    <span className="text-xs font-mono tabular-nums text-zinc-600 shrink-0">
                      {derivedCount} extracted
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Extraction Configuration & Preview */}
        <div className="lg:col-span-7 bg-white border border-zinc-200 rounded-xl p-6 space-y-6">
          <div>
            <h2 className="font-display text-lg font-semibold text-zinc-950">
              Unlimited Video-to-Image Frame Extractor
            </h2>
            <p className="text-sm text-zinc-600 mt-1">
              Decode full-resolution frames directly from selected videos into your dataset without frame count caps.
            </p>
          </div>

          {activePreviewVideo && previewUrl && (
            <div className="bg-zinc-950 rounded-xl overflow-hidden border border-zinc-200">
              <video
                src={previewUrl}
                controls
                muted
                playsInline
                className="w-full max-h-[280px] object-contain"
              />
            </div>
          )}

          {/* Extraction Mode */}
          <div className="space-y-4">
            <div>
              <span className="block text-xs font-medium text-zinc-700 mb-1.5">
                Sampling Strategy
              </span>
              <div className="inline-flex items-center gap-1 p-1 bg-zinc-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setMode('interval')}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    mode === 'interval'
                      ? 'bg-white text-zinc-950'
                      : 'text-zinc-600 hover:text-zinc-950'
                  }`}
                >
                  Time Interval (Every N sec)
                </button>
                <button
                  type="button"
                  onClick={() => setMode('count')}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    mode === 'count'
                      ? 'bg-white text-zinc-950'
                      : 'text-zinc-600 hover:text-zinc-950'
                  }`}
                >
                  Fixed Frame Count per Video
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {mode === 'interval' ? (
                <div>
                  <label
                    htmlFor="extract-interval"
                    className="block text-xs font-medium text-zinc-700 mb-1"
                  >
                    Interval (Seconds)
                  </label>
                  <input
                    id="extract-interval"
                    type="number"
                    step="0.05"
                    min="0.05"
                    value={intervalSec}
                    onChange={(e) =>
                      setIntervalSec(Math.max(0.05, parseFloat(e.target.value) || 0.5))
                    }
                    className="w-full h-10 px-3 font-mono tabular-nums text-sm border border-zinc-300 rounded-lg"
                  />
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="extract-count"
                    className="block text-xs font-medium text-zinc-700 mb-1"
                  >
                    Frames per Video
                  </label>
                  <input
                    id="extract-count"
                    type="number"
                    min="1"
                    step="1"
                    value={frameCount}
                    onChange={(e) =>
                      setFrameCount(Math.max(1, parseInt(e.target.value, 10) || 1))
                    }
                    className="w-full h-10 px-3 font-mono tabular-nums text-sm border border-zinc-300 rounded-lg"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="extract-format"
                  className="block text-xs font-medium text-zinc-700 mb-1"
                >
                  Output Image Format
                </label>
                <select
                  id="extract-format"
                  value={format}
                  onChange={(e) =>
                    setFormat(
                      e.target.value as 'image/webp' | 'image/jpeg' | 'image/png'
                    )
                  }
                  className="w-full h-10 px-3 text-sm bg-white border border-zinc-300 rounded-lg"
                >
                  <option value="image/webp">WebP (Lossy/Crisp)</option>
                  <option value="image/jpeg">JPEG (Standard)</option>
                  <option value="image/png">PNG (Lossless)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="extract-quality"
                  className="block text-xs font-medium text-zinc-700 mb-1"
                >
                  Encoding Quality
                </label>
                <select
                  id="extract-quality"
                  value={quality}
                  onChange={(e) => setQuality(parseFloat(e.target.value))}
                  disabled={format === 'image/png'}
                  className="w-full h-10 px-3 font-mono text-sm bg-white border border-zinc-300 rounded-lg disabled:opacity-50"
                >
                  <option value={1}>100% Max</option>
                  <option value={0.92}>92% High</option>
                  <option value={0.85}>85% Balanced</option>
                  <option value={0.75}>75% Compact</option>
                </select>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
              <input
                type="checkbox"
                checked={inheritMetadata}
                onChange={(e) => setInheritMetadata(e.target.checked)}
                className="w-4 h-4 rounded border-zinc-300 text-blue-600"
              />
              <span>Inherit class labels and dataset split from parent video</span>
            </label>
          </div>

          {/* Action Row */}
          <div className="pt-4 border-t border-zinc-200 flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs text-zinc-600 font-mono tabular-nums">
              Selected: {selectedVideos.length} videos · Output:{' '}
              <strong className="text-zinc-950">
                {estimatedTotalFrames.toLocaleString()} frames
              </strong>
            </div>

            <button
              type="button"
              disabled={selectedVideos.length === 0 || extracting}
              onClick={handleRunBatchExtraction}
              className="h-10 px-5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Layers className="w-4 h-4" />
              <span>
                {extracting
                  ? 'Extracting Frames...'
                  : `Extract ${estimatedTotalFrames.toLocaleString()} Frames`}
              </span>
            </button>
          </div>

          {progressText && (
            <p className="text-xs font-mono text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3.5 py-2.5">
              {progressText}
            </p>
          )}

          {completedNotice && (
            <p className="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
              {completedNotice}
            </p>
          )}
        </div>
      </div>
    </section>
  );
};
