import React, { useEffect, useRef, useState } from 'react';
import { Check, Film, Image as ImageIcon, Play } from 'lucide-react';
import { mediaUrlManager } from '../storage/mediaStorage';
import { MediaItem } from '../types/dataset';
import { formatBytes, formatDuration } from '../utils/formatters';

interface VirtualizedMediaGridProps {
  items: MediaItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onInspectItem: (item: MediaItem) => void;
}

interface MediaCardTileProps {
  item: MediaItem;
  isSelected: boolean;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onInspectItem: (item: MediaItem) => void;
}

const SPLIT_LABELS: Record<MediaItem['split'], string> = {
  unassigned: 'Unassigned',
  train: 'Train',
  val: 'Val',
  test: 'Test',
};

const STATUS_LABELS: Record<MediaItem['status'], string> = {
  unreviewed: 'Unreviewed',
  approved: 'Approved',
  flagged: 'Flagged',
};

const MediaCardTile: React.FC<MediaCardTileProps> = React.memo(
  ({ item, isSelected, onToggleSelect, onInspectItem }) => {
    const [thumbUrl, setThumbUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
      let cancelled = false;
      setFailed(false);
      mediaUrlManager.getThumbnailUrl(item).then((url) => {
        if (!cancelled) {
          setThumbUrl(url);
        }
      });
      return () => {
        cancelled = true;
      };
    }, [item.id, item.hasThumbnail, item.updatedAt]);

    const annotationSummary =
      item.kind === 'photo'
        ? item.boxes.length > 0
          ? `${item.boxes.length} ${item.boxes.length === 1 ? 'box' : 'boxes'}`
          : ''
        : item.segments.length > 0
        ? `${item.segments.length} ${item.segments.length === 1 ? 'clip' : 'clips'}`
        : '';

    const labelLine = [
      item.labels.length > 0 ? item.labels.join(', ') : 'Unlabeled',
      annotationSummary,
    ]
      .filter(Boolean)
      .join(' · ');

    return (
      <article
        className={`group bg-white border rounded-xl overflow-hidden transition-colors flex flex-col ${
          isSelected
            ? 'border-blue-600 ring-1 ring-blue-600'
            : 'border-zinc-200 hover:border-zinc-400'
        }`}
      >
        <div
          onClick={() => onInspectItem(item)}
          className="relative aspect-[4/3] w-full bg-zinc-950 overflow-hidden cursor-pointer"
        >
          {thumbUrl && !failed ? (
            <img
              src={thumbUrl}
              alt={item.name}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setFailed(true)}
              className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900 text-zinc-400 px-4 text-center">
              {item.kind === 'video' ? (
                <Film className="w-7 h-7 mb-1.5 text-zinc-500" />
              ) : (
                <ImageIcon className="w-7 h-7 mb-1.5 text-zinc-500" />
              )}
              <span className="text-xs font-mono truncate max-w-full">{item.name}</span>
            </div>
          )}

          {/* Subtle top-left selection button */}
          <button
            type="button"
            aria-label={`Select ${item.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(item.id, e.shiftKey);
            }}
            className={`absolute top-2.5 left-2.5 w-7 h-7 rounded-md flex items-center justify-center border transition-opacity cursor-pointer ${
              isSelected
                ? 'bg-blue-600 border-blue-600 text-white opacity-100'
                : 'bg-black/60 border-white/40 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
            }`}
          >
            {isSelected && <Check className="w-4 h-4 stroke-[2.5]" />}
          </button>

          {/* Video duration scrim */}
          {item.kind === 'video' && (
            <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded bg-black/80 text-white font-mono tabular-nums text-[11px] inline-flex items-center gap-1">
              <Play className="w-3 h-3 fill-current" />
              <span>{formatDuration(item.durationSec)}</span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onInspectItem(item)}
          className="p-3.5 text-left flex-1 flex flex-col justify-between cursor-pointer focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-600"
        >
          <div>
            <h3 className="text-sm font-medium text-zinc-950 truncate" title={item.name}>
              {item.name}
            </h3>
            <p className="mt-1 text-xs text-zinc-500 font-mono tabular-nums truncate">
              {item.kind === 'photo' ? 'Photo' : 'Video'} · {item.width}×{item.height} ·{' '}
              {formatBytes(item.sizeBytes)} · {SPLIT_LABELS[item.split]}
            </p>
          </div>

          <div className="mt-2 pt-2 border-t border-zinc-100 flex items-center justify-between gap-2 text-xs">
            <span className="text-zinc-600 truncate">{labelLine}</span>
            <span
              className={`shrink-0 font-medium ${
                item.status === 'approved'
                  ? 'text-emerald-700'
                  : item.status === 'flagged'
                  ? 'text-amber-700'
                  : 'text-zinc-500'
              }`}
            >
              {STATUS_LABELS[item.status]}
            </span>
          </div>
        </button>
      </article>
    );
  }
);

export const VirtualizedMediaGrid: React.FC<VirtualizedMediaGridProps> = ({
  items,
  selectedIds,
  onToggleSelect,
  onInspectItem,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1280);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(760);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      setContainerWidth(el.clientWidth || 1280);
      setViewportHeight(window.innerHeight || 760);
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    window.addEventListener('resize', updateSize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const relativeScroll = Math.max(0, -rect.top);
      setScrollTop(relativeScroll);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const gap = 20;
  const cols =
    containerWidth >= 1160 ? 4 : containerWidth >= 820 ? 3 : containerWidth >= 520 ? 2 : 1;
  const cardWidth = Math.max(180, (containerWidth - gap * (cols - 1)) / cols);
  const thumbHeight = (cardWidth * 3) / 4;
  const metaHeight = 96;
  const rowHeight = Math.round(thumbHeight + metaHeight + gap);

  const totalRows = Math.ceil(items.length / cols);
  const totalHeight = Math.max(0, totalRows * rowHeight - gap);

  const overscanRows = 2;
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
  const visibleRowCount = Math.ceil(viewportHeight / rowHeight) + overscanRows * 2;
  const endRow = Math.min(totalRows - 1, startRow + visibleRowCount);

  const visibleItems: Array<{ item: MediaItem; row: number; col: number }> = [];
  for (let r = startRow; r <= endRow; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx < items.length) {
        visibleItems.push({ item: items[idx], row: r, col: c });
      }
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ height: `${totalHeight}px` }}
    >
      {visibleItems.map(({ item, row, col }) => {
        const top = row * rowHeight;
        const left = col * (cardWidth + gap);
        return (
          <div
            key={item.id}
            style={{
              position: 'absolute',
              top: `${top}px`,
              left: `${left}px`,
              width: `${cardWidth}px`,
            }}
          >
            <MediaCardTile
              item={item}
              isSelected={selectedIds.has(item.id)}
              onToggleSelect={onToggleSelect}
              onInspectItem={onInspectItem}
            />
          </div>
        );
      })}
    </div>
  );
};
