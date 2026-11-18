import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  FolderOpen,
  HardDrive,
  Layers,
  StopCircle,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { IngestionProgress } from '../types/dataset';
import { formatBytes, formatDuration } from '../utils/formatters';
import {
  collectDirectoryHandles,
  generateProceduralVideoBlob,
  generateSyntheticPhotoFile,
  IngestFileCandidate,
  traverseDroppedItems,
} from '../utils/mediaProcessor';

interface AddMediaModalProps {
  ingestionProgress: IngestionProgress;
  onClose: () => void;
  onIngestBatch: (
    candidates: IngestFileCandidate[],
    defaultLabels: string[],
    skipDuplicates: boolean
  ) => Promise<void>;
}

type ModalTab = 'files' | 'camera' | 'benchmark';

export const AddMediaModal: React.FC<AddMediaModalProps> = ({
  ingestionProgress,
  onClose,
  onIngestBatch,
}) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('files');
  const [isDragging, setIsDragging] = useState(false);
  const [defaultLabelsText, setDefaultLabelsText] = useState('');
  const [skipDuplicates, setSkipDuplicates] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Camera & Live Video Capture State
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const burstTimerRef = useRef<number | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [burstActive, setBurstActive] = useState(false);
  const [burstIntervalMs, setBurstIntervalMs] = useState(1000);
  const [burstCapturedCount, setBurstCapturedCount] = useState(0);
  const [recordingVideo, setRecordingVideo] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);

  // Synthetic benchmark generator state
  const [generatingBenchmark, setGeneratingBenchmark] = useState(false);

  const parsedDefaultLabels = defaultLabelsText
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, '_'))
    .filter(Boolean);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !ingestionProgress.active) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, ingestionProgress.active]);

  // Cleanup camera stream when modal closes or switches away
  const stopCameraTracks = () => {
    if (burstTimerRef.current) {
      window.clearInterval(burstTimerRef.current);
      burstTimerRef.current = null;
    }
    setBurstActive(false);

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setRecordingVideo(false);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCameraTracks();
    };
  }, []);

  useEffect(() => {
    if (!recordingVideo) return;
    const id = window.setInterval(() => {
      setRecordingSec((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [recordingVideo]);

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const candidates: IngestFileCandidate[] = files.map((file) => ({
      file,
      relativePath:
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    }));
    e.target.value = '';
    await onIngestBatch(candidates, parsedDefaultLabels, skipDuplicates);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    setNotice(null);
    const candidates = await traverseDroppedItems(e.dataTransfer);
    if (candidates.length === 0) {
      setNotice('No supported photo or video files detected in drop.');
      return;
    }
    await onIngestBatch(candidates, parsedDefaultLabels, skipDuplicates);
  };

  const handleMountLocalDirectory = async () => {
    setNotice(null);
    const picker = (
      window as unknown as {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;

    if (!picker) {
      setNotice(
        'Direct directory handles require Chrome/Edge top-level context. Use "Select Folder" or drag-and-drop any folder instead.'
      );
      return;
    }

    try {
      const dirHandle = await picker();
      const candidates = await collectDirectoryHandles(dirHandle);
      if (candidates.length === 0) {
        setNotice('Selected folder contains no supported photo or video files.');
        return;
      }
      await onIngestBatch(candidates, parsedDefaultLabels, skipDuplicates);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setNotice(
        'Directory handle mounting was blocked by iframe sandbox security. Use "Select Folder" or Drag & Drop folder — both support unlimited files.'
      );
    }
  };

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      window.setTimeout(() => {
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = stream;
          videoPreviewRef.current.play().catch(() => undefined);
        }
      }, 50);
    } catch {
      setCameraError(
        'Camera permission denied or no camera device detected in this browser.'
      );
    }
  };

  const captureSinglePhoto = async () => {
    const vid = videoPreviewRef.current;
    if (!vid || vid.readyState < 2) return;
    const canvas = document.createElement('canvas');
    canvas.width = vid.videoWidth || 1280;
    canvas.height = vid.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.92)
    );
    if (!blob) return;

    const file = new File([blob], `capture_${Date.now()}.webp`, {
      type: 'image/webp',
    });
    setBurstCapturedCount((c) => c + 1);
    await onIngestBatch(
      [{ file, relativePath: `camera_captures/${file.name}` }],
      parsedDefaultLabels,
      false
    );
  };

  const toggleBurstCapture = () => {
    if (burstActive) {
      if (burstTimerRef.current) {
        window.clearInterval(burstTimerRef.current);
        burstTimerRef.current = null;
      }
      setBurstActive(false);
    } else {
      setBurstActive(true);
      captureSinglePhoto();
      burstTimerRef.current = window.setInterval(() => {
        captureSinglePhoto();
      }, burstIntervalMs);
    }
  };

  const toggleVideoRecording = () => {
    if (recordingVideo) {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      setRecordingVideo(false);
      return;
    }

    if (!streamRef.current) return;
    const chunks: BlobPart[] = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      const file = new File([blob], `recorded_clip_${Date.now()}.webm`, {
        type: blob.type,
      });
      await onIngestBatch(
        [{ file, relativePath: `recorded_videos/${file.name}` }],
        parsedDefaultLabels,
        false
      );
    };
    recorderRef.current = recorder;
    setRecordingSec(0);
    setRecordingVideo(true);
    recorder.start(500);
  };

  const handleRunSyntheticBatch = async (photoCount: number, videoCount: number) => {
    if (generatingBenchmark || ingestionProgress.active) return;
    setGeneratingBenchmark(true);
    setNotice(null);
    try {
      const candidates: IngestFileCandidate[] = [];
      for (let i = 0; i < photoCount; i++) {
        const f = await generateSyntheticPhotoFile(i);
        candidates.push({
          file: f,
          relativePath: `synthetic_photos/${f.name}`,
        });
      }
      for (let v = 0; v < videoCount; v++) {
        const vBlob = await generateProceduralVideoBlob(v, 1500, 960, 540);
        const vFile = new File(
          [vBlob],
          `synthetic_motion_${String(v + 1).padStart(3, '0')}.webm`,
          { type: vBlob.type || 'video/webm' }
        );
        candidates.push({
          file: vFile,
          relativePath: `synthetic_videos/${vFile.name}`,
        });
      }
      await onIngestBatch(
        candidates,
        parsedDefaultLabels.length > 0 ? parsedDefaultLabels : ['calibration_target'],
        false
      );
    } finally {
      setGeneratingBenchmark(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add Media to Dataset"
      className="fixed inset-0 z-50 bg-zinc-950/60 flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
    >
      <div className="w-full max-w-3xl bg-white border border-zinc-200 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-zinc-950">
              Add Unlimited Photos &amp; Videos
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Zero item count caps and zero file size limits — streamed directly to local disk storage.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCameraTracks();
              onClose();
            }}
            aria-label="Close modal"
            className="w-8 h-8 rounded-lg hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900 inline-flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Segmented Source Tabs */}
        <div className="px-6 pt-4 border-b border-zinc-200 bg-zinc-50/70">
          <div className="inline-flex items-center gap-1 p-1 bg-zinc-200/70 rounded-lg mb-4">
            <button
              type="button"
              onClick={() => {
                stopCameraTracks();
                setActiveTab('files');
              }}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'files'
                  ? 'bg-white text-zinc-950'
                  : 'text-zinc-600 hover:text-zinc-950'
              }`}
            >
              Files &amp; Folders
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('camera')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'camera'
                  ? 'bg-white text-zinc-950'
                  : 'text-zinc-600 hover:text-zinc-950'
              }`}
            >
              Live Camera &amp; Burst
            </button>
            <button
              type="button"
              onClick={() => {
                stopCameraTracks();
                setActiveTab('benchmark');
              }}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'benchmark'
                  ? 'bg-white text-zinc-950'
                  : 'text-zinc-600 hover:text-zinc-950'
              }`}
            >
              Batch Sample Generator
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Batch Default Labels & Deduplication Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
            <div className="sm:col-span-7">
              <label
                htmlFor="batch-default-labels"
                className="block text-xs font-medium text-zinc-700 mb-1"
              >
                Auto-Assign Class Labels (comma-separated, optional)
              </label>
              <input
                id="batch-default-labels"
                type="text"
                placeholder="e.g. street_view, daylight, camera_front"
                value={defaultLabelsText}
                onChange={(e) => setDefaultLabelsText(e.target.value)}
                className="w-full h-9 px-3 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="sm:col-span-5 flex items-center h-9">
              <label className="inline-flex items-center gap-2 text-xs text-zinc-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-600"
                />
                <span>Skip exact SHA-256 duplicates</span>
              </label>
            </div>
          </div>

          {/* Tab 1: Unlimited Files & Directory Drop */}
          {activeTab === 'files' && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                  isDragging
                    ? 'border-blue-600 bg-blue-50/50'
                    : 'border-zinc-300 bg-zinc-50 hover:border-zinc-400'
                }`}
              >
                <Upload className="w-8 h-8 text-zinc-400 mx-auto mb-3" />
                <p className="text-sm font-medium text-zinc-900">
                  Drop unlimited photos, videos, or nested folders anywhere here
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Supports JPG, PNG, WebP, AVIF, MP4, WebM, MOV, MKV — subfolder names are automatically imported as class labels.
                </p>

                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    disabled={ingestionProgress.active}
                    onClick={() => fileInputRef.current?.click()}
                    className="h-10 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Select Files</span>
                  </button>

                  <button
                    type="button"
                    disabled={ingestionProgress.active}
                    onClick={() => folderInputRef.current?.click()}
                    className="h-10 px-4 text-sm font-medium text-zinc-800 bg-white border border-zinc-300 hover:bg-zinc-100 disabled:opacity-50 rounded-lg inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <FolderOpen className="w-4 h-4 text-zinc-600" />
                    <span>Select Folder Tree</span>
                  </button>

                  <button
                    type="button"
                    disabled={ingestionProgress.active}
                    onClick={handleMountLocalDirectory}
                    className="h-10 px-4 text-sm font-medium text-zinc-800 bg-white border border-zinc-300 hover:bg-zinc-100 disabled:opacity-50 rounded-lg inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <HardDrive className="w-4 h-4 text-zinc-600" />
                    <span>Link Disk Folder (Zero-Copy)</span>
                  </button>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  // @ts-expect-error webkitdirectory is standard in Chromium/WebKit/Firefox
                  webkitdirectory=""
                  directory=""
                  onChange={handleFileInputChange}
                  className="hidden"
                />
              </div>
            </div>
          )}

          {/* Tab 2: Live Camera Burst & Unlimited Video Recording */}
          {activeTab === 'camera' && (
            <div className="space-y-4">
              {!cameraActive ? (
                <div className="border border-zinc-200 rounded-xl p-8 text-center bg-zinc-50">
                  <Camera className="w-8 h-8 text-zinc-400 mx-auto mb-3" />
                  <p className="text-sm font-medium text-zinc-900">
                    Capture Unlimited Photos or Video Directly from Camera
                  </p>
                  <p className="mt-1 text-xs text-zinc-500 max-w-md mx-auto">
                    Use single-frame capture, automated burst intervalometer, or continuous video recording saved directly to your dataset.
                  </p>
                  {cameraError && (
                    <p className="mt-3 text-xs text-red-700 font-medium">{cameraError}</p>
                  )}
                  <button
                    type="button"
                    onClick={startCamera}
                    className="mt-5 h-10 px-5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Enable Camera Stream</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative aspect-video bg-zinc-950 rounded-xl overflow-hidden border border-zinc-200">
                    <video
                      ref={videoPreviewRef}
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                    {recordingVideo && (
                      <div className="absolute top-3 left-3 px-2.5 py-1 rounded bg-red-600 text-white font-mono tabular-nums text-xs font-medium">
                        REC {formatDuration(recordingSec)}
                      </div>
                    )}
                    {burstActive && (
                      <div className="absolute top-3 right-3 px-2.5 py-1 rounded bg-blue-600 text-white font-mono tabular-nums text-xs font-medium">
                        BURST · {burstCapturedCount} FRAMES
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={captureSinglePhoto}
                        className="h-9 px-3.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>Capture Photo</span>
                      </button>

                      <select
                        aria-label="Burst interval"
                        value={burstIntervalMs}
                        onChange={(e) => setBurstIntervalMs(Number(e.target.value))}
                        disabled={burstActive}
                        className="h-9 px-2.5 text-xs border border-zinc-300 rounded-lg bg-white font-mono"
                      >
                        <option value={500}>Every 0.5s</option>
                        <option value={1000}>Every 1.0s</option>
                        <option value={2000}>Every 2.0s</option>
                        <option value={5000}>Every 5.0s</option>
                      </select>

                      <button
                        type="button"
                        onClick={toggleBurstCapture}
                        className={`h-9 px-3.5 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 cursor-pointer ${
                          burstActive
                            ? 'bg-amber-600 text-white hover:bg-amber-700'
                            : 'bg-zinc-900 text-white hover:bg-zinc-800'
                        }`}
                      >
                        {burstActive ? (
                          <>
                            <StopCircle className="w-3.5 h-3.5" />
                            <span>Stop Burst</span>
                          </>
                        ) : (
                          <>
                            <Layers className="w-3.5 h-3.5" />
                            <span>Start Unlimited Burst</span>
                          </>
                        )}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={toggleVideoRecording}
                      className={`h-9 px-3.5 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 cursor-pointer ${
                        recordingVideo
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200'
                      }`}
                    >
                      <Video className="w-3.5 h-3.5" />
                      <span>{recordingVideo ? 'Stop & Save Video' : 'Record Video'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Batch Sample Generator for Unlimited Scale Testing */}
          {activeTab === 'benchmark' && (
            <div className="border border-zinc-200 rounded-xl p-6 bg-zinc-50 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-zinc-950">
                  Generate High-Volume Test Dataset
                </h3>
                <p className="mt-1 text-xs text-zinc-600">
                  Populate your dataset with real WebP calibration photos and playable WebM motion sequences to test virtualized scrolling, deduplication, and multi-format export at scale.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  disabled={generatingBenchmark || ingestionProgress.active}
                  onClick={() => handleRunSyntheticBatch(50, 2)}
                  className="p-4 text-left bg-white border border-zinc-200 hover:border-blue-600 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                >
                  <p className="font-mono tabular-nums text-base font-semibold text-zinc-950">
                    +52 Items
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">50 Photos · 2 Videos</p>
                </button>

                <button
                  type="button"
                  disabled={generatingBenchmark || ingestionProgress.active}
                  onClick={() => handleRunSyntheticBatch(250, 4)}
                  className="p-4 text-left bg-white border border-zinc-200 hover:border-blue-600 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                >
                  <p className="font-mono tabular-nums text-base font-semibold text-zinc-950">
                    +254 Items
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">250 Photos · 4 Videos</p>
                </button>

                <button
                  type="button"
                  disabled={generatingBenchmark || ingestionProgress.active}
                  onClick={() => handleRunSyntheticBatch(1000, 5)}
                  className="p-4 text-left bg-white border border-zinc-200 hover:border-blue-600 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                >
                  <p className="font-mono tabular-nums text-base font-semibold text-zinc-950">
                    +1,005 Items
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">1,000 Photos · 5 Videos</p>
                </button>
              </div>
            </div>
          )}

          {notice && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5">
              {notice}
            </p>
          )}

          {/* Live Ingestion Progress Bar */}
          {ingestionProgress.active && (
            <div className="border border-zinc-200 rounded-xl p-4 bg-zinc-50 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-900 truncate max-w-md">
                  Ingesting: {ingestionProgress.currentFileName}
                </span>
                <span className="font-mono tabular-nums text-zinc-600 shrink-0">
                  {ingestionProgress.processedFiles.toLocaleString()} /{' '}
                  {ingestionProgress.totalFiles.toLocaleString()} ·{' '}
                  {formatBytes(ingestionProgress.bytesProcessed)}
                </span>
              </div>
              <div className="w-full h-2 bg-zinc-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-150"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round(
                        (ingestionProgress.processedFiles /
                          Math.max(1, ingestionProgress.totalFiles)) *
                          100
                      )
                    )}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
