export type MediaKind = 'photo' | 'video';

export type DatasetSplit = 'unassigned' | 'train' | 'val' | 'test';

export type ReviewStatus = 'unreviewed' | 'approved' | 'flagged';

export interface BoundingBox {
  id: string;
  label: string;
  /** Normalized [0..1] X coordinate of top-left corner */
  x: number;
  /** Normalized [0..1] Y coordinate of top-left corner */
  y: number;
  /** Normalized [0..1] box width */
  width: number;
  /** Normalized [0..1] box height */
  height: number;
}

export interface VideoSegment {
  id: string;
  label: string;
  startSec: number;
  endSec: number;
  notes?: string;
}

export interface DatasetCollection {
  id: string;
  name: string;
  description: string;
  classes: string[];
  createdAt: number;
  updatedAt: number;
}

export interface MediaItem {
  id: string;
  datasetId: string;
  name: string;
  relativePath: string;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  durationSec?: number;
  sha256: string;
  split: DatasetSplit;
  status: ReviewStatus;
  labels: string[];
  caption: string;
  boxes: BoundingBox[];
  segments: VideoSegment[];
  sourceVideoId?: string;
  sourceTimestampSec?: number;
  storageMode: 'opfs' | 'idb' | 'handle';
  hasThumbnail: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StorageQuotaStats {
  usageBytes: number;
  quotaBytes: number;
  engine: 'OPFS' | 'IndexedDB';
}

export interface IngestionProgress {
  active: boolean;
  totalFiles: number;
  processedFiles: number;
  currentFileName: string;
  bytesProcessed: number;
  skippedDuplicates: number;
  errors: string[];
}

export type WorkspaceView = 'library' | 'frames' | 'audit' | 'export';

export type LibraryLayout = 'grid' | 'table';

export type SortField = 'createdAt' | 'name' | 'sizeBytes' | 'resolution' | 'durationSec';

export type SortDirection = 'asc' | 'desc';
