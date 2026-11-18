import React, { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { DatasetSplit, MediaItem } from '../types/dataset';
import { formatBytes } from '../utils/formatters';

interface SplitAuditViewProps {
  items: MediaItem[];
  onApplySplitAllocation: (
    updates: Array<{ id: string; split: DatasetSplit }>
  ) => Promise<void>;
  onDeleteDuplicates: (duplicateItems: MediaItem[]) => Promise<void>;
  onInspectItem: (item: MediaItem) => void;
}

export const SplitAuditView: React.FC<SplitAuditViewProps> = ({
  items,
  onApplySplitAllocation,
  onDeleteDuplicates,
  onInspectItem,
}) => {
  const [trainPct, setTrainPct] = useState(80);
  const [valPct, setValPct] = useState(10);
  const [testPct, setTestPct] = useState(10);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [stratifyByLabel, setStratifyByLabel] = useState(true);
  const [applyingSplit, setApplyingSplit] = useState(false);
  const [splitNotice, setSplitNotice] = useState<string | null>(null);

  const [purgingDuplicates, setPurgingDuplicates] = useState(false);
  const [auditNotice, setAuditNotice] = useState<string | null>(null);

  const pctSum = trainPct + valPct + testPct;

  const splitCounts = useMemo(() => {
    const counts = { unassigned: 0, train: 0, val: 0, test: 0 };
    for (const item of items) {
      counts[item.split]++;
    }
    return counts;
  }, [items]);

  // Exact SHA-256 duplicate clusters
  const duplicateClusters = useMemo(() => {
    const byHash = new Map<string, MediaItem[]>();
    for (const item of items) {
      if (!item.sha256) continue;
      const list = byHash.get(item.sha256) || [];
      list.push(item);
      byHash.set(item.sha256, list);
    }
    const clusters: Array<{
      sha256: string;
      keep: MediaItem;
      duplicates: MediaItem[];
      reclaimableBytes: number;
    }> = [];

    for (const [sha256, group] of byHash.entries()) {
      if (group.length > 1) {
        const sorted = [...group].sort((a, b) => a.createdAt - b.createdAt);
        const [keep, ...duplicates] = sorted;
        const reclaimableBytes = duplicates.reduce((s, d) => s + d.sizeBytes, 0);
        clusters.push({ sha256, keep, duplicates, reclaimableBytes });
      }
    }
    return clusters;
  }, [items]);

  const totalDuplicateCount = duplicateClusters.reduce(
    (s, c) => s + c.duplicates.length,
    0
  );
  const totalReclaimableBytes = duplicateClusters.reduce(
    (s, c) => s + c.reclaimableBytes,
    0
  );

  const handleRunSplitBalancer = async () => {
    if (pctSum !== 100 || items.length === 0 || applyingSplit) return;
    setApplyingSplit(true);
    setSplitNotice(null);

    try {
      const targetItems = onlyUnassigned
        ? items.filter((i) => i.split === 'unassigned')
        : [...items];

      if (targetItems.length === 0) {
        setSplitNotice('No matching items to assign.');
        return;
      }

      const allocateGroup = (group: MediaItem[]): Array<{ id: string; split: DatasetSplit }> => {
        const shuffled = [...group];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const n = shuffled.length;
        const nTrain = Math.round((n * trainPct) / 100);
        const nVal = Math.round((n * valPct) / 100);

        return shuffled.map((item, idx) => {
          let split: DatasetSplit;
          if (idx < nTrain) split = 'train';
          else if (idx < nTrain + nVal) split = 'val';
          else split = 'test';
          return { id: item.id, split };
        });
      };

      let updates: Array<{ id: string; split: DatasetSplit }> = [];
      if (stratifyByLabel) {
        const strata = new Map<string, MediaItem[]>();
        for (const item of targetItems) {
          const key = item.labels[0] || '__unlabeled__';
          const arr = strata.get(key) || [];
          arr.push(item);
          strata.set(key, arr);
        }
        for (const group of strata.values()) {
          updates.push(...allocateGroup(group));
        }
      } else {
        updates = allocateGroup(targetItems);
      }

      await onApplySplitAllocation(updates);
      setSplitNotice(
        `Allocated ${updates.length.toLocaleString()} items across Train (${trainPct}%), Validation (${valPct}%), and Test (${testPct}%).`
      );
    } finally {
      setApplyingSplit(false);
    }
  };

  const handlePurgeAllDuplicates = async () => {
    if (totalDuplicateCount === 0 || purgingDuplicates) return;
    setPurgingDuplicates(true);
    setAuditNotice(null);
    try {
      const allDups = duplicateClusters.flatMap((c) => c.duplicates);
      await onDeleteDuplicates(allDups);
      setAuditNotice(
        `Removed ${allDups.length.toLocaleString()} duplicate files and reclaimed ${formatBytes(
          totalReclaimableBytes
        )}.`
      );
    } finally {
      setPurgingDuplicates(false);
    }
  };

  return (
    <section className="max-w-[1440px] mx-auto px-6 py-8 space-y-8">
      {/* Section 1: Train / Val / Test Split Balancer */}
      <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-zinc-950">
              Train / Validation / Test Split Balancer
            </h2>
            <p className="text-sm text-zinc-600 mt-0.5">
              Automatically partition datasets of any size with optional class stratification.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {[
              { label: '80 / 10 / 10', tr: 80, va: 10, te: 10 },
              { label: '70 / 20 / 10', tr: 70, va: 20, te: 10 },
              { label: '90 / 10 / 0', tr: 90, va: 10, te: 0 },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setTrainPct(preset.tr);
                  setValPct(preset.va);
                  setTestPct(preset.te);
                }}
                className="h-8 px-3 text-xs font-mono tabular-nums bg-zinc-100 hover:bg-zinc-200 text-zinc-800 rounded-md cursor-pointer whitespace-nowrap shrink-0"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Ratio Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="split-train-pct"
              className="block text-xs font-medium text-zinc-700 mb-1"
            >
              Train Ratio (%) — Currently {splitCounts.train.toLocaleString()} items
            </label>
            <input
              id="split-train-pct"
              type="number"
              min="0"
              max="100"
              value={trainPct}
              onChange={(e) => setTrainPct(Math.max(0, Math.min(100, Number(e.target.value))))}
              className="w-full h-10 px-3 font-mono tabular-nums text-sm border border-zinc-300 rounded-lg"
            />
          </div>

          <div>
            <label
              htmlFor="split-val-pct"
              className="block text-xs font-medium text-zinc-700 mb-1"
            >
              Validation Ratio (%) — Currently {splitCounts.val.toLocaleString()} items
            </label>
            <input
              id="split-val-pct"
              type="number"
              min="0"
              max="100"
              value={valPct}
              onChange={(e) => setValPct(Math.max(0, Math.min(100, Number(e.target.value))))}
              className="w-full h-10 px-3 font-mono tabular-nums text-sm border border-zinc-300 rounded-lg"
            />
          </div>

          <div>
            <label
              htmlFor="split-test-pct"
              className="block text-xs font-medium text-zinc-700 mb-1"
            >
              Test Ratio (%) — Currently {splitCounts.test.toLocaleString()} items
            </label>
            <input
              id="split-test-pct"
              type="number"
              min="0"
              max="100"
              value={testPct}
              onChange={(e) => setTestPct(Math.max(0, Math.min(100, Number(e.target.value))))}
              className="w-full h-10 px-3 font-mono tabular-nums text-sm border border-zinc-300 rounded-lg"
            />
          </div>
        </div>

        {/* Options & Execute */}
        <div className="pt-4 border-t border-zinc-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-6 text-xs text-zinc-700">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={stratifyByLabel}
                onChange={(e) => setStratifyByLabel(e.target.checked)}
                className="w-4 h-4 rounded border-zinc-300 text-blue-600"
              />
              <span>Stratify by primary class label</span>
            </label>

            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyUnassigned}
                onChange={(e) => setOnlyUnassigned(e.target.checked)}
                className="w-4 h-4 rounded border-zinc-300 text-blue-600"
              />
              <span>
                Only assign unassigned items ({splitCounts.unassigned.toLocaleString()})
              </span>
            </label>
          </div>

          <div className="flex items-center gap-3">
            {pctSum !== 100 && (
              <span className="text-xs font-mono text-red-700">
                Sum must equal 100% (currently {pctSum}%)
              </span>
            )}
            <button
              type="button"
              disabled={pctSum !== 100 || items.length === 0 || applyingSplit}
              onClick={handleRunSplitBalancer}
              className="h-10 px-5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
            >
              {applyingSplit ? 'Allocating...' : 'Apply Split Allocation'}
            </button>
          </div>
        </div>

        {splitNotice && (
          <p className="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
            {splitNotice}
          </p>
        )}
      </div>

      {/* Section 2: Exact SHA-256 Duplicate Audit */}
      <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-zinc-950">
              Exact Content Duplicate Audit (SHA-256)
            </h2>
            <p className="text-sm text-zinc-600 mt-0.5">
              Detects byte-identical photos and videos across nested folders so training splits never leak duplicates.
            </p>
          </div>

          {totalDuplicateCount > 0 && (
            <button
              type="button"
              disabled={purgingDuplicates}
              onClick={handlePurgeAllDuplicates}
              className="h-10 px-4 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-4 h-4" />
              <span>
                Purge {totalDuplicateCount.toLocaleString()} Duplicates (
                {formatBytes(totalReclaimableBytes)})
              </span>
            </button>
          )}
        </div>

        {auditNotice && (
          <p className="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
            {auditNotice}
          </p>
        )}

        {duplicateClusters.length === 0 ? (
          <div className="border border-zinc-200 rounded-lg p-6 text-center bg-zinc-50">
            <p className="text-sm font-medium text-zinc-900">
              Zero Exact Duplicates Detected
            </p>
            <p className="text-xs text-zinc-500 mt-1 font-mono tabular-nums">
              All {items.length.toLocaleString()} media files in this dataset have unique content hashes.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-200 border border-zinc-200 rounded-lg">
            {duplicateClusters.map((cluster) => (
              <div
                key={cluster.sha256}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-950">
                    {cluster.keep.name}{' '}
                    <span className="font-mono text-xs text-zinc-500">
                      ({cluster.duplicates.length + 1} identical copies ·{' '}
                      {formatBytes(cluster.keep.sizeBytes)} each)
                    </span>
                  </p>
                  <p className="text-xs font-mono text-zinc-500 mt-0.5 truncate">
                    SHA-256: {cluster.sha256}
                  </p>
                  <p className="text-xs text-zinc-600 mt-1">
                    Duplicate paths:{' '}
                    {cluster.duplicates.map((d) => d.relativePath || d.name).join(', ')}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onInspectItem(cluster.keep)}
                    className="h-8 px-3 text-xs font-medium text-zinc-800 bg-zinc-100 hover:bg-zinc-200 rounded-md cursor-pointer"
                  >
                    Inspect Original
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteDuplicates(cluster.duplicates)}
                    className="h-8 px-3 text-xs font-medium text-red-700 hover:bg-red-50 border border-red-200 rounded-md cursor-pointer"
                  >
                    Keep 1 &amp; Remove {cluster.duplicates.length}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
