import React, { useMemo, useState } from 'react';
import { Download, FolderOutput } from 'lucide-react';
import { DatasetCollection, MediaItem } from '../types/dataset';
import {
  buildCocoJson,
  buildCsvIndex,
  buildJsonlManifest,
  buildYoloFiles,
  exportDatasetAsZip,
  exportDatasetToLocalFolder,
  ExportFormat,
  triggerBlobDownload,
} from '../utils/datasetExporter';
import { formatBytes } from '../utils/formatters';

interface ExportDatasetViewProps {
  dataset: DatasetCollection;
  items: MediaItem[];
}

const FORMAT_CARDS: Array<{
  id: ExportFormat;
  title: string;
  subtitle: string;
}> = [
  {
    id: 'coco',
    title: 'COCO Detection JSON',
    subtitle: 'Standard instances_default.json with pixel bounding boxes, categories, and media metadata.',
  },
  {
    id: 'yolo',
    title: 'YOLO Bounding Box Bundle',
    subtitle: 'Normalized label .txt files paired with classes.txt and data.yaml training config.',
  },
  {
    id: 'jsonl',
    title: 'JSONL Multimodal Manifest',
    subtitle: 'Line-delimited JSON records including captions, video temporal segments, splits, and SHA-256.',
  },
  {
    id: 'csv',
    title: 'CSV Tabular Index',
    subtitle: 'Spreadsheet-compatible index of all photo/video dimensions, durations, splits, and labels.',
  },
];

export const ExportDatasetView: React.FC<ExportDatasetViewProps> = ({
  dataset,
  items,
}) => {
  const [format, setFormat] = useState<ExportFormat>('coco');
  const [includeMediaFiles, setIncludeMediaFiles] = useState<boolean>(true);
  const [organizeBySplit, setOrganizeBySplit] = useState<boolean>(true);
  const [onlyApproved, setOnlyApproved] = useState<boolean>(false);

  const [exporting, setExporting] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const filteredItems = useMemo(
    () => (onlyApproved ? items.filter((i) => i.status === 'approved') : items),
    [items, onlyApproved]
  );

  const totalExportBytes = useMemo(
    () => filteredItems.reduce((s, i) => s + i.sizeBytes, 0),
    [filteredItems]
  );

  const previewSnippet = useMemo(() => {
    const sample = filteredItems.slice(0, 3);
    if (format === 'coco') {
      return buildCocoJson(dataset, sample).slice(0, 1400);
    }
    if (format === 'jsonl') {
      return buildJsonlManifest(sample).slice(0, 1400);
    }
    if (format === 'csv') {
      return buildCsvIndex(sample).slice(0, 1400);
    }
    const yolo = buildYoloFiles(dataset, sample);
    return `# data.yaml\n${yolo.dataYaml}\n\n# classes.txt\n${yolo.classesTxt}`;
  }, [dataset, filteredItems, format]);

  const handleDownloadZip = async () => {
    if (filteredItems.length === 0 || exporting) return;
    setExporting(true);
    setStatusMessage(null);
    setProgressText('Compiling dataset archive...');
    try {
      const slug = dataset.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      const zipBlob = await exportDatasetAsZip(
        dataset,
        items,
        {
          format,
          includeMediaFiles,
          organizeBySplit,
          onlyApproved,
        },
        (done, total, name) => {
          setProgressText(`Packaging ${done.toLocaleString()} / ${total.toLocaleString()}: ${name}`);
        }
      );
      triggerBlobDownload(zipBlob, `${slug || 'dataset'}_${format}.zip`);
      setStatusMessage(
        `Exported ${filteredItems.length.toLocaleString()} items (${formatBytes(
          zipBlob.size
        )} archive).`
      );
    } finally {
      setExporting(false);
      setProgressText(null);
    }
  };

  const handleExportToDiskFolder = async () => {
    if (filteredItems.length === 0 || exporting) return;
    const picker = (
      window as unknown as {
        showDirectoryPicker?: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;

    if (!picker) {
      setStatusMessage(
        'Direct folder writing requires Chrome/Edge top-level window context. Use "Download .zip Archive" instead.'
      );
      return;
    }

    setExporting(true);
    setStatusMessage(null);
    try {
      const dirHandle = await picker({ mode: 'readwrite' });
      const written = await exportDatasetToLocalFolder(
        dirHandle,
        dataset,
        items,
        {
          format,
          includeMediaFiles,
          organizeBySplit,
          onlyApproved,
        },
        (done, total, name) => {
          setProgressText(`Writing ${done.toLocaleString()} / ${total.toLocaleString()}: ${name}`);
        }
      );
      setStatusMessage(
        `Wrote ${format.toUpperCase()} annotations${
          includeMediaFiles ? ` and ${written.toLocaleString()} media files` : ''
        } directly to selected folder.`
      );
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setStatusMessage(
          'Folder picker blocked in iframe sandbox. Use "Download .zip Archive" to export your dataset.'
        );
      }
    } finally {
      setExporting(false);
      setProgressText(null);
    }
  };

  return (
    <section className="max-w-[1440px] mx-auto px-6 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Export Schema & Bundle Settings */}
        <div className="lg:col-span-7 bg-white border border-zinc-200 rounded-xl p-6 space-y-6">
          <div>
            <h2 className="font-display text-lg font-semibold text-zinc-950">
              Compile &amp; Export Dataset
            </h2>
            <p className="text-sm text-zinc-600 mt-0.5">
              Package annotations, bounding boxes, video temporal clips, and full-resolution media with no item limit.
            </p>
          </div>

          {/* Format Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FORMAT_CARDS.map((card) => {
              const active = format === card.id;
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setFormat(card.id)}
                  className={`p-4 text-left border rounded-xl transition-colors cursor-pointer ${
                    active
                      ? 'border-blue-600 bg-blue-50/40'
                      : 'border-zinc-200 hover:border-zinc-400 bg-white'
                  }`}
                >
                  <p className="text-sm font-semibold text-zinc-950">{card.title}</p>
                  <p className="mt-1 text-xs text-zinc-600 leading-relaxed">
                    {card.subtitle}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Bundle Options */}
          <div className="pt-4 border-t border-zinc-200 space-y-3">
            <h3 className="text-xs font-semibold text-zinc-900">Packaging Options</h3>

            <label className="flex items-center gap-2.5 text-sm text-zinc-700 cursor-pointer">
              <input
                type="checkbox"
                checked={includeMediaFiles}
                onChange={(e) => setIncludeMediaFiles(e.target.checked)}
                className="w-4 h-4 rounded border-zinc-300 text-blue-600"
              />
              <span>
                Include original photo &amp; video files (
                <span className="font-mono tabular-nums">{formatBytes(totalExportBytes)}</span>)
              </span>
            </label>

            <label className="flex items-center gap-2.5 text-sm text-zinc-700 cursor-pointer">
              <input
                type="checkbox"
                checked={organizeBySplit}
                disabled={!includeMediaFiles}
                onChange={(e) => setOrganizeBySplit(e.target.checked)}
                className="w-4 h-4 rounded border-zinc-300 text-blue-600 disabled:opacity-40"
              />
              <span>Organize media into train / val / test subdirectories</span>
            </label>

            <label className="flex items-center gap-2.5 text-sm text-zinc-700 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyApproved}
                onChange={(e) => setOnlyApproved(e.target.checked)}
                className="w-4 h-4 rounded border-zinc-300 text-blue-600"
              />
              <span>Export approved items only</span>
            </label>
          </div>

          {/* Export Action Buttons */}
          <div className="pt-4 border-t border-zinc-200 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs font-mono tabular-nums text-zinc-600">
              Ready: {filteredItems.length.toLocaleString()} items
            </span>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={filteredItems.length === 0 || exporting}
                onClick={handleExportToDiskFolder}
                className="h-10 px-4 text-sm font-medium text-zinc-800 bg-zinc-100 hover:bg-zinc-200 disabled:opacity-50 rounded-lg inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
              >
                <FolderOutput className="w-4 h-4 text-zinc-600" />
                <span>Write to Local Folder</span>
              </button>

              <button
                type="button"
                disabled={filteredItems.length === 0 || exporting}
                onClick={handleDownloadZip}
                className="h-10 px-5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>{exporting ? 'Exporting...' : 'Download .zip Archive'}</span>
              </button>
            </div>
          </div>

          {progressText && (
            <p className="text-xs font-mono text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3.5 py-2.5">
              {progressText}
            </p>
          )}

          {statusMessage && (
            <p className="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
              {statusMessage}
            </p>
          )}
        </div>

        {/* Right Column: Live Schema Preview */}
        <div className="lg:col-span-5 bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-200 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-900">
              Schema Preview ({format.toUpperCase()})
            </h3>
            <span className="text-xs font-mono text-zinc-500">First 3 items</span>
          </div>
          <pre className="p-5 text-xs font-mono text-zinc-800 bg-zinc-50 overflow-x-auto max-h-[460px] leading-relaxed">
            {filteredItems.length === 0
              ? 'No items match the current export filter.'
              : previewSnippet}
          </pre>
        </div>
      </div>
    </section>
  );
};
