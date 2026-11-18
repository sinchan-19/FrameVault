import React, { useEffect, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  Film,
  FolderOpen,
  Layers,
  Play,
  Scan,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  loadMediaBlob,
  mediaUrlManager,
  storeMediaBinary,
} from '../storage/mediaStorage';
import {
  BatchScanLogEntry,
  ClassBreakdownCounts,
  DetectedTrafficBox,
  RoadDirection,
  TrafficMediaAsset,
} from '../types/traffic';
import { createId, formatBytes, formatDuration } from '../utils/formatters';
import {
  detectMediaKind,
  extractFramesFromVideo,
  extractPhotoMetadataAndThumb,
  extractVideoMetadataAndThumb,
  inferMimeType,
  traverseDroppedItems,
} from '../utils/mediaProcessor';
import { ROADS, sumVehicles } from '../utils/trafficLogic';
import {
  generateSampleTrafficVideoBlob,
  runLocalVisionDetectorOnElement,
} from '../utils/trafficVisionEngine';

interface VisionPipelineSectionProps {
  selectedRoad: RoadDirection;
  onSelectRoad: (road: RoadDirection) => void;
  mediaAssets: TrafficMediaAsset[];
  onAddMediaAssets: (newAssets: TrafficMediaAsset[]) => void;
  onUpdateMediaAsset: (updated: TrafficMediaAsset) => void;
  onDeleteMediaAsset: (asset: TrafficMediaAsset) => void;
  onApplyCountsToRoad: (road: RoadDirection, counts: ClassBreakdownCounts) => void;
}

const BOX_COLORS: Record<DetectedTrafficBox['label'], string> = {
  car: '#3b82f6',
  bike: '#10b981',
  bus: '#f59e0b',
  truck: '#a855f7',
  pedestrian: '#ef4444',
};

export const VisionPipelineSection: React.FC<VisionPipelineSectionProps> = ({
  selectedRoad,
  onSelectRoad,
  mediaAssets,
  onAddMediaAssets,
  onUpdateMediaAsset,
  onDeleteMediaAsset,
  onApplyCountsToRoad,
}) => {
  const roadAssets = mediaAssets.filter((a) => a.assignedRoad === selectedRoad);
  const [activeAssetId, setActiveAssetId] = useState<string>('');
  const [activeMediaUrl, setActiveMediaUrl] = useState<string | null>(null);

  const [showBoxes, setShowBoxes] = useState(true);
  const [autoUpdateRoad, setAutoUpdateRoad] = useState(true);
  const [liveVideoDetect, setLiveVideoDetect] = useState(false);

  const [ingestingNotice, setIngestingNotice] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgressText, setBatchProgressText] = useState<string | null>(null);
  const [scanLogs, setScanLogs] = useState<BatchScanLogEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Keep activeAssetId synced when switching roads
  useEffect(() => {
    const current = roadAssets.find((a) => a.id === activeAssetId);
    if (!current && roadAssets[0]) {
      setActiveAssetId(roadAssets[0].id);
    }
  }, [selectedRoad, roadAssets, activeAssetId]);

  const activeAsset =
    roadAssets.find((a) => a.id === activeAssetId) || roadAssets[0] || null;

  // Load media URL (builtin static asset OR OPFS/IndexedDB blob)
  useEffect(() => {
    setLiveVideoDetect(false);
    if (!activeAsset) {
      setActiveMediaUrl(null);
      return;
    }
    if (activeAsset.isBuiltin && activeAsset.builtinUrl) {
      setActiveMediaUrl(activeAsset.builtinUrl);
      return;
    }

    let cancelled = false;
    mediaUrlManager
      .getFullMediaUrl({
        id: activeAsset.id,
        datasetId: 'traffic',
        name: activeAsset.name,
        relativePath: activeAsset.relativePath,
        kind: activeAsset.kind,
        mimeType: activeAsset.mimeType,
        sizeBytes: activeAsset.sizeBytes,
        width: activeAsset.width,
        height: activeAsset.height,
        durationSec: activeAsset.durationSec,
        sha256: '',
        split: 'unassigned',
        status: 'unreviewed',
        labels: [],
        caption: '',
        boxes: [],
        segments: [],
        storageMode: 'opfs',
        hasThumbnail: true,
        createdAt: activeAsset.createdAt,
        updatedAt: activeAsset.createdAt,
      })
      .then((url) => {
        if (!cancelled) setActiveMediaUrl(url);
      });

    return () => {
      cancelled = true;
    };
  }, [activeAsset?.id]);

  // Ingest unlimited files or folder candidates into OPFS/IndexedDB
  const handleIngestFiles = async (
    fileList: Array<{ file: File; relativePath: string }>
  ) => {
    const supported = fileList.filter((c) => detectMediaKind(c.file) !== null);
    if (supported.length === 0) {
      setIngestingNotice('No supported traffic photo or video files detected.');
      return;
    }

    setIngestingNotice(`Importing ${supported.length.toLocaleString()} media files into ${selectedRoad} queue...`);
    const created: TrafficMediaAsset[] = [];

    for (let i = 0; i < supported.length; i++) {
      const { file, relativePath } = supported[i];
      const kind = detectMediaKind(file);
      if (!kind) continue;

      const id = createId(kind === 'photo' ? 'timg' : 'tvid');
      const mimeType = inferMimeType(file.name, file.type, kind);

      let width = 1280;
      let height = 720;
      let durationSec: number | undefined;
      let thumbnail: Blob | null = null;

      if (kind === 'photo') {
        const meta = await extractPhotoMetadataAndThumb(file);
        width = meta.width || 1280;
        height = meta.height || 720;
        thumbnail = meta.thumbnail;
      } else {
        const meta = await extractVideoMetadataAndThumb(file);
        width = meta.width || 1280;
        height = meta.height || 720;
        durationSec = meta.durationSec;
        thumbnail = meta.thumbnail;
      }

      await storeMediaBinary(id, file, thumbnail);

      // Infer road from path if folder names contain north/south/east/west
      const lowerPath = relativePath.toLowerCase();
      let targetRoad: RoadDirection = selectedRoad;
      if (lowerPath.includes('north')) targetRoad = 'North';
      else if (lowerPath.includes('south')) targetRoad = 'South';
      else if (lowerPath.includes('east')) targetRoad = 'East';
      else if (lowerPath.includes('west')) targetRoad = 'West';

      created.push({
        id,
        name: file.name,
        relativePath,
        kind,
        mimeType,
        sizeBytes: file.size,
        width,
        height,
        durationSec,
        assignedRoad: targetRoad,
        createdAt: Date.now() + i,
      });
    }

    if (created.length > 0) {
      onAddMediaAssets(created);
      const firstForRoad = created.find((c) => c.assignedRoad === selectedRoad) || created[0];
      if (firstForRoad) {
        onSelectRoad(firstForRoad.assignedRoad);
        setActiveAssetId(firstForRoad.id);
      }
      setIngestingNotice(
        `Added ${created.length.toLocaleString()} media ${
          created.length === 1 ? 'item' : 'items'
        } to local storage (no dataset or video limit).`
      );
    }
  };

  const handleGenerateTestTrafficVideo = async () => {
    setIngestingNotice(`Synthesizing playable ${selectedRoad} CCTV traffic video stream...`);
    const blob = await generateSampleTrafficVideoBlob(selectedRoad, 3200);
    const file = new File(
      [blob],
      `CCTV_${selectedRoad}_Stream_${Date.now().toString().slice(-4)}.webm`,
      { type: blob.type || 'video/webm' }
    );
    await handleIngestFiles([{ file, relativePath: `videos/${file.name}` }]);
  };

  const handleRunSingleDetection = () => {
    if (!activeAsset) return;

    let result;
    if (activeAsset.kind === 'photo' && imgRef.current) {
      result = runLocalVisionDetectorOnElement(
        imgRef.current,
        imgRef.current.naturalWidth || activeAsset.width,
        imgRef.current.naturalHeight || activeAsset.height,
        selectedRoad,
        activeAsset.id
      );
    } else if (activeAsset.kind === 'video' && videoRef.current) {
      result = runLocalVisionDetectorOnElement(
        videoRef.current,
        videoRef.current.videoWidth || activeAsset.width,
        videoRef.current.videoHeight || activeAsset.height,
        selectedRoad
      );
    } else {
      return;
    }

    const updated: TrafficMediaAsset = {
      ...activeAsset,
      lastDetection: {
        ...result,
        analyzedAt: Date.now(),
      },
    };
    onUpdateMediaAsset(updated);

    if (autoUpdateRoad) {
      onApplyCountsToRoad(selectedRoad, result.counts);
    }
  };

  // Continuous live frame-by-frame detection while video plays
  useEffect(() => {
    if (!liveVideoDetect || activeAsset?.kind !== 'video') return;
    const intervalId = window.setInterval(() => {
      const vid = videoRef.current;
      if (!vid || vid.readyState < 2 || vid.paused) return;
      const result = runLocalVisionDetectorOnElement(
        vid,
        vid.videoWidth || activeAsset.width,
        vid.videoHeight || activeAsset.height,
        selectedRoad
      );
      onUpdateMediaAsset({
        ...activeAsset,
        lastDetection: {
          ...result,
          analyzedAt: Date.now(),
        },
      });
      if (autoUpdateRoad) {
        onApplyCountsToRoad(selectedRoad, result.counts);
      }
    }, 650);

    return () => window.clearInterval(intervalId);
  }, [liveVideoDetect, activeAsset, selectedRoad, autoUpdateRoad]);

  // Scan entire video timeline OR entire uploaded dataset queue with zero rate limit
  const handleRunUnlimitedBatchScan = async () => {
    if (batchRunning || mediaAssets.length === 0) return;
    setBatchRunning(true);
    setLiveVideoDetect(false);
    const logs: BatchScanLogEntry[] = [];

    try {
      // If active item is a video and user clicks Scan Full Video, scan every 0.8s across full duration
      if (activeAsset?.kind === 'video') {
        const blob = await loadMediaBlob({
          id: activeAsset.id,
          datasetId: 'traffic',
          name: activeAsset.name,
          relativePath: activeAsset.relativePath,
          kind: 'video',
          mimeType: activeAsset.mimeType,
          sizeBytes: activeAsset.sizeBytes,
          width: activeAsset.width,
          height: activeAsset.height,
          durationSec: activeAsset.durationSec,
          sha256: '',
          split: 'unassigned',
          status: 'unreviewed',
          labels: [],
          caption: '',
          boxes: [],
          segments: [],
          storageMode: 'opfs',
          hasThumbnail: true,
          createdAt: activeAsset.createdAt,
          updatedAt: activeAsset.createdAt,
        });

        if (blob) {
          const dur = Math.max(1, activeAsset.durationSec || 3);
          const timestamps: number[] = [];
          for (let t = 0; t < dur; t += 0.8) {
            timestamps.push(Number(t.toFixed(2)));
          }
          const frames = await extractFramesFromVideo(
            blob,
            timestamps,
            'image/webp',
            0.85,
            (done, total) => {
              setBatchProgressText(
                `Scanning video ${activeAsset.name}: frame ${done} / ${total}`
              );
            }
          );

          let peakCounts: ClassBreakdownCounts = {
            cars: 0,
            bikes: 0,
            buses: 0,
            trucks: 0,
            pedestrians: 0,
          };

          for (const frame of frames) {
            const bmp = await createImageBitmap(frame.blob);
            const det = runLocalVisionDetectorOnElement(
              bmp,
              frame.width,
              frame.height,
              selectedRoad
            );
            bmp.close();

            peakCounts = {
              cars: Math.max(peakCounts.cars, det.counts.cars),
              bikes: Math.max(peakCounts.bikes, det.counts.bikes),
              buses: Math.max(peakCounts.buses, det.counts.buses),
              trucks: Math.max(peakCounts.trucks, det.counts.trucks),
              pedestrians: Math.max(peakCounts.pedestrians, det.counts.pedestrians),
            };

            logs.push({
              id: createId('log'),
              mediaName: activeAsset.name,
              road: selectedRoad,
              timestampSec: frame.timestampSec,
              counts: det.counts,
              totalVehicles: sumVehicles(det.counts),
            });
          }

          onUpdateMediaAsset({
            ...activeAsset,
            lastDetection: {
              counts: peakCounts,
              boxes: activeAsset.lastDetection?.boxes || [],
              summary: `Full video scan complete (${frames.length} frames analyzed, zero rate limits). Peak density applied.`,
              analyzedAt: Date.now(),
            },
          });
          if (autoUpdateRoad) {
            onApplyCountsToRoad(selectedRoad, peakCounts);
          }
          setScanLogs(logs.slice(0, 40));
          setBatchProgressText(
            `Completed full video scan (${frames.length} frames analyzed across ${dur.toFixed(1)}s).`
          );
          return;
        }
      }

      // Otherwise batch-scan all queued media items across all approaches
      for (let i = 0; i < mediaAssets.length; i++) {
        const asset = mediaAssets[i];
        setBatchProgressText(
          `Scanning dataset item ${i + 1} / ${mediaAssets.length}: ${asset.name}`
        );

        let detResult;
        if (asset.isBuiltin && asset.builtinUrl) {
          const img = new Image();
          img.src = asset.builtinUrl;
          await new Promise<void>((res) => {
            img.onload = () => res();
            img.onerror = () => res();
          });
          detResult = runLocalVisionDetectorOnElement(
            img,
            img.naturalWidth || asset.width,
            img.naturalHeight || asset.height,
            asset.assignedRoad,
            asset.id
          );
        } else {
          const blob = await loadMediaBlob({
            id: asset.id,
            datasetId: 'traffic',
            name: asset.name,
            relativePath: asset.relativePath,
            kind: asset.kind,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            width: asset.width,
            height: asset.height,
            durationSec: asset.durationSec,
            sha256: '',
            split: 'unassigned',
            status: 'unreviewed',
            labels: [],
            caption: '',
            boxes: [],
            segments: [],
            storageMode: 'opfs',
            hasThumbnail: true,
            createdAt: asset.createdAt,
            updatedAt: asset.createdAt,
          });
          if (blob && asset.kind === 'photo') {
            const bmp = await createImageBitmap(blob);
            detResult = runLocalVisionDetectorOnElement(
              bmp,
              bmp.width,
              bmp.height,
              asset.assignedRoad
            );
            bmp.close();
          } else if (blob && asset.kind === 'video') {
            const frames = await extractFramesFromVideo(
              blob,
              [Math.min(0.5, (asset.durationSec || 1) * 0.25)],
              'image/webp',
              0.85
            );
            if (frames[0]) {
              const bmp = await createImageBitmap(frames[0].blob);
              detResult = runLocalVisionDetectorOnElement(
                bmp,
                bmp.width,
                bmp.height,
                asset.assignedRoad
              );
              bmp.close();
            }
          }
        }

        if (detResult) {
          onUpdateMediaAsset({
            ...asset,
            lastDetection: {
              ...detResult,
              analyzedAt: Date.now(),
            },
          });
          if (autoUpdateRoad) {
            onApplyCountsToRoad(asset.assignedRoad, detResult.counts);
          }
          logs.push({
            id: createId('log'),
            mediaName: asset.name,
            road: asset.assignedRoad,
            counts: detResult.counts,
            totalVehicles: sumVehicles(detResult.counts),
          });
        }
      }

      setScanLogs(logs.slice(0, 40));
      setBatchProgressText(
        `Batch detection finished across ${mediaAssets.length.toLocaleString()} dataset items with zero rate limits.`
      );
    } finally {
      setBatchRunning(false);
    }
  };

  const currentDetection = activeAsset?.lastDetection;
  const currentCounts: ClassBreakdownCounts = currentDetection?.counts || {
    cars: 0,
    bikes: 0,
    buses: 0,
    trucks: 0,
    pedestrians: 0,
  };
  const combinedVehicles = sumVehicles(currentCounts);

  return (
    <section
      id="section-vision"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setIsDragging(false);
        const candidates = await traverseDroppedItems(e.dataTransfer);
        await handleIngestFiles(candidates);
      }}
      className={`bg-white border rounded-xl p-6 space-y-6 transition-colors ${
        isDragging ? 'border-blue-600 bg-blue-50/20' : 'border-zinc-200'
      }`}
    >
      {/* Section Header & Approach Selector Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-zinc-200 pb-5">
        <div>
          <p className="text-xs font-medium text-zinc-500">
            01. Traffic Input &amp; Object Detection · Unlimited Image &amp; Video Vision Pipeline
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold text-zinc-950">
            Vehicle &amp; Pedestrian Density Detection
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-zinc-100 rounded-lg shrink-0">
          {ROADS.map((road, idx) => {
            const active = selectedRoad === road;
            const countForRoad = mediaAssets.filter(
              (a) => a.assignedRoad === road
            ).length;
            return (
              <button
                key={road}
                type="button"
                onClick={() => onSelectRoad(road)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 font-mono tabular-nums ${
                  active
                    ? 'bg-white text-zinc-950'
                    : 'text-zinc-600 hover:text-zinc-950'
                }`}
              >
                Road {idx + 1}: {road} ({countForRoad})
              </button>
            );
          })}
        </div>
      </div>

      {/* Unlimited Media Queue Strip + Upload & Detection Action Bar */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-9 px-3.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Images or Videos</span>
            </button>

            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="h-9 px-3.5 text-xs font-medium text-zinc-800 bg-zinc-100 hover:bg-zinc-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5 text-zinc-600" />
              <span>Upload Folder</span>
            </button>

            <button
              type="button"
              onClick={handleGenerateTestTrafficVideo}
              className="h-9 px-3.5 text-xs font-medium text-zinc-800 bg-zinc-100 hover:bg-zinc-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Film className="w-3.5 h-3.5 text-zinc-600" />
              <span>Add Sample Traffic Video</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*"
              onChange={(e) => {
                const files = Array.from(e.target.files || []).map((file) => ({
                  file,
                  relativePath: file.name,
                }));
                e.target.value = '';
                handleIngestFiles(files);
              }}
              className="hidden"
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              // @ts-expect-error webkitdirectory supported across desktop browsers
              webkitdirectory=""
              directory=""
              onChange={(e) => {
                const files = Array.from(e.target.files || []).map((file) => ({
                  file,
                  relativePath:
                    (file as File & { webkitRelativePath?: string })
                      .webkitRelativePath || file.name,
                }));
                e.target.value = '';
                handleIngestFiles(files);
              }}
              className="hidden"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowBoxes((s) => !s)}
              className="h-9 px-3 text-xs font-medium text-zinc-700 border border-zinc-200 hover:bg-zinc-50 rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              {showBoxes ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span>{showBoxes ? 'Hide Boxes' : 'Show Boxes'}</span>
            </button>

            <button
              type="button"
              disabled={!activeAsset}
              onClick={handleRunSingleDetection}
              className="h-9 px-4 text-xs font-medium text-white bg-zinc-950 hover:bg-zinc-800 disabled:opacity-40 rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Scan className="w-3.5 h-3.5" />
              <span>Start Detection</span>
            </button>

            {activeAsset?.kind === 'video' && (
              <button
                type="button"
                onClick={() => setLiveVideoDetect((v) => !v)}
                className={`h-9 px-3.5 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  liveVideoDetect
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200'
                }`}
              >
                <Play className="w-3.5 h-3.5" />
                <span>
                  {liveVideoDetect ? 'Live Video Detection: ON' : 'Live Video Detection'}
                </span>
              </button>
            )}

            <button
              type="button"
              disabled={batchRunning || mediaAssets.length === 0}
              onClick={handleRunUnlimitedBatchScan}
              className="h-9 px-3.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 disabled:opacity-40 rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>
                {batchRunning
                  ? 'Scanning...'
                  : activeAsset?.kind === 'video'
                  ? 'Scan Full Video'
                  : `Batch Detect All (${mediaAssets.length})`}
              </span>
            </button>
          </div>
        </div>

        {/* Horizontal Scrollable Media Queue for Selected Approach */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {roadAssets.map((asset) => {
            const isSelected = activeAsset?.id === asset.id;
            return (
              <div
                key={asset.id}
                onClick={() => setActiveAssetId(asset.id)}
                className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-2 cursor-pointer shrink-0 transition-colors ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50/60 text-zinc-950 font-medium'
                    : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-400'
                }`}
              >
                <span className="font-mono uppercase text-[10px] text-zinc-500">
                  {asset.kind === 'video' ? 'VID' : 'IMG'}
                </span>
                <span className="truncate max-w-[180px]">{asset.name}</span>
                {asset.kind === 'video' && asset.durationSec !== undefined && (
                  <span className="font-mono tabular-nums text-[11px] text-zinc-500">
                    {formatDuration(asset.durationSec)}
                  </span>
                )}
                {!asset.isBuiltin && (
                  <button
                    type="button"
                    aria-label={`Remove ${asset.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteMediaAsset(asset);
                    }}
                    className="text-zinc-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {ingestingNotice && (
          <p className="text-xs font-mono text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3.5 py-2">
            {ingestingNotice}
          </p>
        )}
        {batchProgressText && (
          <p className="text-xs font-mono text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2">
            {batchProgressText}
          </p>
        )}
      </div>

      {/* Main Split: Left 16:9 Vision Stage, Right Detected Density Breakdown Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Columns: Visual Media + Bounding Boxes */}
        <div className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-600 font-mono tabular-nums">
            <span>
              {activeAsset
                ? `${activeAsset.name} · ${activeAsset.width}×${activeAsset.height} · ${formatBytes(
                    activeAsset.sizeBytes
                  )}`
                : `No media loaded for ${selectedRoad}`}
            </span>
            <span>Assigned to {selectedRoad} Approach</span>
          </div>

          <div className="relative aspect-video w-full bg-zinc-950 border border-zinc-200 rounded-xl overflow-hidden flex items-center justify-center">
            {!activeAsset || !activeMediaUrl ? (
              <div className="text-center px-6 text-zinc-400">
                <p className="text-sm font-medium text-zinc-200">
                  Drop unlimited traffic photos or videos here
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Zero file limits · Zero API rate limits
                </p>
              </div>
            ) : activeAsset.kind === 'photo' ? (
              <div className="relative w-full h-full">
                <img
                  ref={imgRef}
                  src={activeMediaUrl}
                  alt={`${selectedRoad} approach camera feed`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover block"
                />
                {showBoxes &&
                  currentDetection?.boxes.map((box) => {
                    const color = BOX_COLORS[box.label] || '#3b82f6';
                    return (
                      <div
                        key={box.id}
                        style={{
                          left: `${box.x * 100}%`,
                          top: `${box.y * 100}%`,
                          width: `${box.width * 100}%`,
                          height: `${box.height * 100}%`,
                          borderColor: color,
                        }}
                        className="absolute border-2 pointer-events-none"
                      >
                        <span
                          style={{ backgroundColor: color }}
                          className="absolute -top-4 left-0 px-1 py-0.5 text-[10px] font-mono leading-none text-white whitespace-nowrap"
                        >
                          {box.label} {Math.round(box.confidence * 100)}%
                        </span>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="relative w-full h-full">
                <video
                  ref={videoRef}
                  src={activeMediaUrl}
                  controls
                  playsInline
                  loop
                  className="w-full h-full object-cover block"
                />
                {showBoxes &&
                  currentDetection?.boxes.map((box) => {
                    const color = BOX_COLORS[box.label] || '#3b82f6';
                    return (
                      <div
                        key={box.id}
                        style={{
                          left: `${box.x * 100}%`,
                          top: `${box.y * 100}%`,
                          width: `${box.width * 100}%`,
                          height: `${box.height * 100}%`,
                          borderColor: color,
                        }}
                        className="absolute border-2 pointer-events-none"
                      >
                        <span
                          style={{ backgroundColor: color }}
                          className="absolute -top-4 left-0 px-1 py-0.5 text-[10px] font-mono leading-none text-white whitespace-nowrap"
                        >
                          {box.label} {Math.round(box.confidence * 100)}%
                        </span>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          <p className="text-xs text-zinc-600 leading-relaxed">
            {currentDetection?.summary ||
              `Click "Start Detection" to analyze vehicles and pedestrians on ${selectedRoad} approach.`}
          </p>
        </div>

        {/* Right 5 Columns: Detected Density Breakdown Table */}
        <div className="lg:col-span-5 border border-zinc-200 rounded-xl overflow-hidden bg-white">
          <div className="px-4 py-3.5 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-zinc-950">
                Detected Density Breakdown
              </h3>
              <p className="text-xs text-zinc-500">
                Target: Road {ROADS.indexOf(selectedRoad) + 1} ({selectedRoad}) · 5 Object Classes
              </p>
            </div>
            <span className="font-mono tabular-nums text-xs font-semibold text-zinc-900">
              Total Vehicles: {combinedVehicles}
            </span>
          </div>

          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-500 bg-zinc-50/50">
                <th className="py-2.5 px-4 font-medium">Parameter</th>
                <th className="py-2.5 px-4 font-medium">Classification</th>
                <th className="py-2.5 px-4 font-medium text-right">Detected Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              <tr>
                <td className="py-2.5 px-4 font-medium text-zinc-900">Cars</td>
                <td className="py-2.5 px-4 text-zinc-600">Sedans, SUVs, vans</td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-zinc-950">
                  {currentCounts.cars}
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-medium text-zinc-900">Bikes</td>
                <td className="py-2.5 px-4 text-zinc-600">
                  Motorcycles, scooters, cycles
                </td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-zinc-950">
                  {currentCounts.bikes}
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-medium text-zinc-900">Buses</td>
                <td className="py-2.5 px-4 text-zinc-600">
                  Transit &amp; commuter coaches
                </td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-zinc-950">
                  {currentCounts.buses}
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-medium text-zinc-900">Trucks</td>
                <td className="py-2.5 px-4 text-zinc-600">Freight &amp; box trucks</td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-zinc-950">
                  {currentCounts.trucks}
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-medium text-zinc-900">Pedestrians</td>
                <td className="py-2.5 px-4 text-zinc-600">
                  Curbside &amp; crosswalk users
                </td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-zinc-950">
                  {currentCounts.pedestrians}
                </td>
              </tr>
              <tr className="bg-zinc-50 font-semibold">
                <td colSpan={2} className="py-2.5 px-4 text-zinc-900">
                  Combined {selectedRoad} Vehicle Density (Cars + Bikes + Buses + Trucks)
                </td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums text-blue-700">
                  {combinedVehicles}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="p-4 border-t border-zinc-200 space-y-3 bg-zinc-50/40">
            <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
              <input
                type="checkbox"
                checked={autoUpdateRoad}
                onChange={(e) => setAutoUpdateRoad(e.target.checked)}
                className="w-4 h-4 rounded border-zinc-300 text-blue-600"
              />
              <span>Automatically update {selectedRoad} road density after detection</span>
            </label>

            <button
              type="button"
              onClick={() => onApplyCountsToRoad(selectedRoad, currentCounts)}
              className="w-full h-9 px-4 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer transition-colors"
            >
              Apply Counts to {selectedRoad} Approach
            </button>
          </div>
        </div>
      </div>

      {/* Unlimited Batch / Video Frame Scan Log (shown when batch or video scan runs) */}
      {scanLogs.length > 0 && (
        <div className="border border-zinc-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between text-xs">
            <span className="font-semibold text-zinc-900">
              Video &amp; Dataset Scan Telemetry Log ({scanLogs.length} entries)
            </span>
            <button
              type="button"
              onClick={() => setScanLogs([])}
              className="text-zinc-500 hover:text-zinc-900 cursor-pointer"
            >
              Clear Log
            </button>
          </div>
          <div className="max-h-44 overflow-y-auto divide-y divide-zinc-100 text-xs font-mono tabular-nums">
            {scanLogs.map((entry) => (
              <div
                key={entry.id}
                className="px-4 py-2 flex items-center justify-between gap-4 hover:bg-zinc-50"
              >
                <span className="text-zinc-900 truncate">
                  {entry.mediaName}
                  {entry.timestampSec !== undefined ? ` @ ${entry.timestampSec}s` : ''}
                </span>
                <span className="text-zinc-600 shrink-0">
                  {entry.road} · V:{entry.totalVehicles} (C:{entry.counts.cars} B:
                  {entry.counts.bikes} Bus:{entry.counts.buses} T:{entry.counts.trucks}) · P:
                  {entry.counts.pedestrians}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
