import React, { useState } from 'react';
import { FolderPlus, Trash2 } from 'lucide-react';
import { DatasetCollection, MediaItem, StorageQuotaStats } from '../types/dataset';
import { formatBytes } from '../utils/formatters';

interface DatasetSummaryBarProps {
  datasets: DatasetCollection[];
  activeDataset: DatasetCollection;
  items: MediaItem[];
  storageStats: StorageQuotaStats;
  onSelectDataset: (id: string) => void;
  onCreateDataset: (name: string, description: string) => Promise<void>;
  onDeleteDataset: (id: string) => Promise<void>;
}

export const DatasetSummaryBar: React.FC<DatasetSummaryBarProps> = ({
  datasets,
  activeDataset,
  items,
  storageStats,
  onSelectDataset,
  onCreateDataset,
  onDeleteDataset,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  let photoCount = 0;
  let videoCount = 0;
  let totalBytes = 0;
  let approvedCount = 0;
  let boxCount = 0;
  let segmentCount = 0;
  let trainCount = 0;
  let valCount = 0;
  let testCount = 0;

  for (const item of items) {
    if (item.kind === 'photo') photoCount++;
    else videoCount++;
    totalBytes += item.sizeBytes;
    if (item.status === 'approved') approvedCount++;
    boxCount += item.boxes.length;
    segmentCount += item.segments.length;
    if (item.split === 'train') trainCount++;
    else if (item.split === 'val') valCount++;
    else if (item.split === 'test') testCount++;
  }

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onCreateDataset(trimmed, newDesc.trim());
      setNewName('');
      setNewDesc('');
      setIsCreating(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="bg-white border-b border-zinc-200">
      <div className="max-w-[1440px] mx-auto px-6 py-6">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="text-xs font-medium text-zinc-500">
              Active Dataset Collection · Unlimited Local Media Storage
            </p>
            <h1 className="mt-1 font-display text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-950 text-balance">
              {activeDataset.name}
            </h1>
            {activeDataset.description && (
              <p className="mt-1.5 text-sm text-zinc-600 max-w-2xl">
                {activeDataset.description}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <label htmlFor="dataset-switcher" className="sr-only">
              Select Dataset Collection
            </label>
            <select
              id="dataset-switcher"
              value={activeDataset.id}
              onChange={(e) => onSelectDataset(e.target.value)}
              className="h-10 px-3 text-sm font-medium text-zinc-900 bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-600"
            >
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setIsCreating((prev) => !prev)}
              className="h-10 px-4 inline-flex items-center gap-2 text-sm font-medium text-zinc-800 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FolderPlus className="w-4 h-4 text-zinc-600" />
              <span>New Dataset</span>
            </button>

            {datasets.length > 1 && (
              <button
                type="button"
                onClick={() => onDeleteDataset(activeDataset.id)}
                title="Delete current dataset collection"
                className="h-10 px-3 inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:bg-red-50 border border-zinc-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete</span>
              </button>
            )}
          </div>
        </div>

        {isCreating && (
          <form
            onSubmit={handleCreateSubmit}
            className="mt-5 pt-5 border-t border-zinc-200 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
          >
            <div className="md:col-span-4">
              <label
                htmlFor="new-dataset-name"
                className="block text-xs font-medium text-zinc-700 mb-1"
              >
                Dataset Name
              </label>
              <input
                id="new-dataset-name"
                type="text"
                required
                placeholder="e.g. Autonomous Dashcam 4K"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full h-10 px-3 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div className="md:col-span-5">
              <label
                htmlFor="new-dataset-desc"
                className="block text-xs font-medium text-zinc-700 mb-1"
              >
                Description (Optional)
              </label>
              <input
                id="new-dataset-desc"
                type="text"
                placeholder="Classes, camera rig, or curation notes"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="w-full h-10 px-3 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div className="md:col-span-3 flex items-center gap-2">
              <button
                type="submit"
                disabled={submitting || !newName.trim()}
                className="h-10 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Create Dataset
              </button>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="h-10 px-3 text-sm font-medium text-zinc-600 hover:text-zinc-900 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* 4-Column Tabular Metrics Strip (Flat hairline dividers, zero nested cards, zero pills) */}
        <div className="mt-6 pt-5 border-t border-zinc-200 grid grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <p className="text-xs font-medium text-zinc-500">Total Media Items</p>
            <p className="mt-1 font-mono tabular-nums text-2xl font-semibold text-zinc-950">
              {items.length.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-zinc-600 font-mono tabular-nums">
              {photoCount.toLocaleString()} Photos · {videoCount.toLocaleString()} Videos
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-zinc-500">Dataset Volume</p>
            <p className="mt-1 font-mono tabular-nums text-2xl font-semibold text-zinc-950">
              {formatBytes(totalBytes)}
            </p>
            <p className="mt-0.5 text-xs text-zinc-600 font-mono tabular-nums">
              {storageStats.engine} · {formatBytes(storageStats.quotaBytes)} Disk Quota
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-zinc-500">Approved &amp; Annotated</p>
            <p className="mt-1 font-mono tabular-nums text-2xl font-semibold text-zinc-950">
              {approvedCount.toLocaleString()}
              <span className="text-sm font-normal text-zinc-400">
                {' '}
                / {items.length.toLocaleString()}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-zinc-600 font-mono tabular-nums">
              {boxCount.toLocaleString()} Boxes · {segmentCount.toLocaleString()} Video Clips
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-zinc-500">Split Allocation</p>
            <p className="mt-1 font-mono tabular-nums text-2xl font-semibold text-zinc-950">
              {trainCount.toLocaleString()} / {valCount.toLocaleString()} /{' '}
              {testCount.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-zinc-600">
              Train · Validation · Test
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
