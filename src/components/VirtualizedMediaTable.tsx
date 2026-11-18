import React, { useEffect, useRef, useState } from 'react';
import { Check, Film, Image as ImageIcon } from 'lucide-react';
import { mediaUrlManager } from '../storage/mediaStorage';
import { MediaItem } from '../types/dataset';
import { formatBytes, formatDuration } from '../utils/formatters';

interface VirtualizedMediaTableProps {
  items: MediaItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onToggleSelectAll: () => void;
  onInspectItem: (item: MediaItem) => void;
}

const ROW_HEIGHT = 44;

const TableRowThumb: React.FC<{ item: MediaItem }> = React.memo(({ item }) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    mediaUrlManager.getThumbnailUrl(item).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.hasThumbnail]);

  return (
    <div className="w-9 h-7 rounded bg-zinc-900 overflow-hidden shrink-0 flex items-center justify-center">
      {url ? (
        <img
          src={url}
          alt={item.name}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
        />
      ) : item.kind === 'video' ? (
        <Film className="w-3.5 h-3.5 text-zinc-400" />
      ) : (
        <ImageIcon className="w-3.5 h-3.5 text-zinc-400" />
      )}
    </div>
  );
});

export const VirtualizedMediaTable: React.FC<VirtualizedMediaTableProps> = ({
  items,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onInspectItem,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const update = () => setContainerHeight(el.clientHeight || 600);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const totalHeight = items.length * ROW_HEIGHT;
  const overscan = 6;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - overscan);
  const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT) + overscan * 2;
  const endIndex = Math.min(items.length - 1, startIndex + visibleCount);

  const visibleSlice = items.slice(startIndex, endIndex + 1);

  return (
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
      <div
        ref={scrollContainerRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="max-h-[680px] overflow-auto"
      >
        <div className="min-w-[920px]">
          {/* Sticky Header */}
          <div className="sticky top-0 z-10 h-10 bg-zinc-50 border-b border-zinc-200 px-4 grid grid-cols-12 gap-3 items-center text-xs font-medium text-zinc-600">
            <div className="col-span-5 flex items-center gap-3">
              <button
                type="button"
                aria-label="Select all filtered items"
                onClick={onToggleSelectAll}
                className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer ${
                  allSelected
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-zinc-300'
                }`}
              >
                {allSelected && <Check className="w-3 h-3 stroke-[3]" />}
              </button>
              <span>File &amp; Relative Path</span>
            </div>
            <div className="col-span-1">Type</div>
            <div className="col-span-2 text-right">Resolution</div>
            <div className="col-span-1 text-right">Size</div>
            <div className="col-span-1">Split</div>
            <div className="col-span-2">Labels &amp; Status</div>
          </div>

          {/* Virtualized Rows */}
          <div className="relative" style={{ height: `${totalHeight}px` }}>
            {visibleSlice.map((item, offsetIdx) => {
              const rowIndex = startIndex + offsetIdx;
              const isSelected = selectedIds.has(item.id);
              return (
                <div
                  key={item.id}
                  onClick={() => onInspectItem(item)}
                  style={{
                    position: 'absolute',
                    top: `${rowIndex * ROW_HEIGHT}px`,
                    left: 0,
                    right: 0,
                    height: `${ROW_HEIGHT}px`,
                  }}
                  className={`px-4 grid grid-cols-12 gap-3 items-center border-b border-zinc-100 text-xs cursor-pointer transition-colors ${
                    isSelected ? 'bg-blue-50/70' : 'hover:bg-zinc-50'
                  }`}
                >
                  <div className="col-span-5 flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      aria-label={`Select ${item.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect(item.id, e.shiftKey);
                      }}
                      className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center cursor-pointer ${
                        isSelected
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white border-zinc-300'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                    </button>
                    <TableRowThumb item={item} />
                    <span className="font-medium text-zinc-900 truncate" title={item.relativePath}>
                      {item.relativePath || item.name}
                    </span>
                  </div>

                  <div className="col-span-1 text-zinc-600 font-mono">
                    {item.kind === 'photo'
                      ? 'Photo'
                      : `Video ${formatDuration(item.durationSec)}`}
                  </div>

                  <div className="col-span-2 text-right font-mono tabular-nums text-zinc-700">
                    {item.width}×{item.height}
                  </div>

                  <div className="col-span-1 text-right font-mono tabular-nums text-zinc-700">
                    {formatBytes(item.sizeBytes)}
                  </div>

                  <div className="col-span-1 text-zinc-700 capitalize">
                    {item.split === 'val' ? 'Validation' : item.split}
                  </div>

                  <div className="col-span-2 flex items-center justify-between gap-2 min-w-0">
                    <span className="text-zinc-600 truncate">
                      {item.labels.length > 0 ? item.labels.join(', ') : 'Unlabeled'}
                    </span>
                    <span
                      className={`shrink-0 font-medium ${
                        item.status === 'approved'
                          ? 'text-emerald-700'
                          : item.status === 'flagged'
                          ? 'text-amber-700'
                          : 'text-zinc-500'
                      }`}
                    >
                      {item.status === 'approved'
                        ? 'Approved'
                        : item.status === 'flagged'
                        ? 'Flagged'
                        : 'Unreviewed'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
