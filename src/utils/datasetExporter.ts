import JSZip from 'jszip';
import { loadMediaBlob } from '../storage/mediaStorage';
import { DatasetCollection, MediaItem } from '../types/dataset';
import { fileStem } from './formatters';

export type ExportFormat = 'coco' | 'yolo' | 'jsonl' | 'csv';

export interface ExportOptions {
  format: ExportFormat;
  includeMediaFiles: boolean;
  organizeBySplit: boolean;
  onlyApproved: boolean;
}

export function buildCocoJson(dataset: DatasetCollection, items: MediaItem[]): string {
  const classSet = new Set<string>(dataset.classes);
  for (const item of items) {
    item.labels.forEach((l) => classSet.add(l));
    item.boxes.forEach((b) => classSet.add(b.label));
  }
  const categories = Array.from(classSet).map((name, index) => ({
    id: index + 1,
    name,
    supercategory: 'object',
  }));
  const categoryIdMap = new Map(categories.map((c) => [c.name, c.id]));

  const images = items.map((item, idx) => ({
    id: idx + 1,
    file_name: item.relativePath || item.name,
    width: item.width,
    height: item.height,
    date_captured: new Date(item.createdAt).toISOString(),
    extra: {
      dataset_id: item.id,
      kind: item.kind,
      split: item.split,
      status: item.status,
      duration_sec: item.durationSec ?? null,
      labels: item.labels,
      caption: item.caption,
      sha256: item.sha256,
    },
  }));

  const annotations: Array<{
    id: number;
    image_id: number;
    category_id: number;
    bbox: [number, number, number, number];
    area: number;
    iscrowd: number;
  }> = [];

  let annId = 1;
  items.forEach((item, idx) => {
    const imageId = idx + 1;
    const w = item.width || 1;
    const h = item.height || 1;
    for (const box of item.boxes) {
      const catId = categoryIdMap.get(box.label) ?? 1;
      const px = Math.round(box.x * w);
      const py = Math.round(box.y * h);
      const pw = Math.round(box.width * w);
      const ph = Math.round(box.height * h);
      annotations.push({
        id: annId++,
        image_id: imageId,
        category_id: catId,
        bbox: [px, py, pw, ph],
        area: pw * ph,
        iscrowd: 0,
      });
    }
  });

  return JSON.stringify(
    {
      info: {
        description: dataset.name,
        version: '1.0',
        year: new Date().getFullYear(),
        date_created: new Date().toISOString(),
      },
      licenses: [{ id: 1, name: 'Dataset Owner License', url: '' }],
      categories,
      images,
      annotations,
    },
    null,
    2
  );
}

export function buildJsonlManifest(items: MediaItem[]): string {
  return items
    .map((item) =>
      JSON.stringify({
        id: item.id,
        file_name: item.name,
        relative_path: item.relativePath,
        kind: item.kind,
        mime_type: item.mimeType,
        size_bytes: item.sizeBytes,
        width: item.width,
        height: item.height,
        duration_sec: item.durationSec ?? null,
        split: item.split,
        status: item.status,
        labels: item.labels,
        caption: item.caption,
        boxes: item.boxes,
        temporal_segments: item.segments,
        source_video_id: item.sourceVideoId ?? null,
        source_timestamp_sec: item.sourceTimestampSec ?? null,
        sha256: item.sha256,
        created_at: new Date(item.createdAt).toISOString(),
      })
    )
    .join('\n');
}

function escapeCsvCell(val: string | number | undefined): string {
  const s = val === undefined ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsvIndex(items: MediaItem[]): string {
  const headers = [
    'id',
    'name',
    'relative_path',
    'kind',
    'mime_type',
    'size_bytes',
    'width',
    'height',
    'duration_sec',
    'split',
    'status',
    'labels',
    'caption',
    'box_count',
    'segment_count',
    'sha256',
    'created_at',
  ];
  const rows = items.map((item) =>
    [
      item.id,
      item.name,
      item.relativePath,
      item.kind,
      item.mimeType,
      item.sizeBytes,
      item.width,
      item.height,
      item.durationSec ?? '',
      item.split,
      item.status,
      item.labels.join('|'),
      item.caption,
      item.boxes.length,
      item.segments.length,
      item.sha256,
      new Date(item.createdAt).toISOString(),
    ]
      .map(escapeCsvCell)
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

export function buildYoloFiles(
  dataset: DatasetCollection,
  items: MediaItem[]
): {
  classesTxt: string;
  dataYaml: string;
  labelFiles: Array<{ path: string; content: string }>;
} {
  const classSet = new Set<string>(dataset.classes);
  for (const item of items) {
    item.labels.forEach((l) => classSet.add(l));
    item.boxes.forEach((b) => classSet.add(b.label));
  }
  const classList = Array.from(classSet);
  const classIndexMap = new Map(classList.map((name, idx) => [name, idx]));

  const classesTxt = classList.join('\n');
  const dataYaml = [
    `path: .`,
    `train: train/images`,
    `val: val/images`,
    `test: test/images`,
    `nc: ${classList.length}`,
    `names: [${classList.map((c) => `'${c.replace(/'/g, "\\'")}'`).join(', ')}]`,
  ].join('\n');

  const labelFiles: Array<{ path: string; content: string }> = [];
  const usedPaths = new Set<string>();

  for (const item of items) {
    if (item.kind !== 'photo') continue;
    const stem = fileStem(item.name);
    let candidatePath = `${stem}.txt`;
    let counter = 1;
    while (usedPaths.has(candidatePath)) {
      candidatePath = `${stem}_${counter++}.txt`;
    }
    usedPaths.add(candidatePath);

    const lines = item.boxes.map((box) => {
      const clsIdx = classIndexMap.get(box.label) ?? 0;
      const xc = (box.x + box.width / 2).toFixed(6);
      const yc = (box.y + box.height / 2).toFixed(6);
      const w = box.width.toFixed(6);
      const h = box.height.toFixed(6);
      return `${clsIdx} ${xc} ${yc} ${w} ${h}`;
    });

    labelFiles.push({
      path: candidatePath,
      content: lines.join('\n'),
    });
  }

  return { classesTxt, dataYaml, labelFiles };
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportDatasetAsZip(
  dataset: DatasetCollection,
  items: MediaItem[],
  options: ExportOptions,
  onProgress?: (completed: number, total: number, currentName: string) => void
): Promise<Blob> {
  const zip = new JSZip();
  const filtered = options.onlyApproved
    ? items.filter((i) => i.status === 'approved')
    : items;

  if (options.format === 'coco') {
    zip.file('annotations/instances_default.json', buildCocoJson(dataset, filtered));
  } else if (options.format === 'jsonl') {
    zip.file('manifest.jsonl', buildJsonlManifest(filtered));
  } else if (options.format === 'csv') {
    zip.file('dataset_index.csv', buildCsvIndex(filtered));
  } else if (options.format === 'yolo') {
    const yolo = buildYoloFiles(dataset, filtered);
    zip.file('classes.txt', yolo.classesTxt);
    zip.file('data.yaml', yolo.dataYaml);
    for (const lf of yolo.labelFiles) {
      zip.file(`labels/${lf.path}`, lf.content);
    }
  }

  if (options.includeMediaFiles) {
    const usedNames = new Set<string>();
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      onProgress?.(i + 1, filtered.length, item.name);
      const blob = await loadMediaBlob(item);
      if (!blob) continue;

      const folderPrefix = options.organizeBySplit
        ? `${item.split}/${item.kind === 'photo' ? 'images' : 'videos'}`
        : item.kind === 'photo'
        ? 'images'
        : 'videos';

      let targetName = `${folderPrefix}/${item.name}`;
      let dupIdx = 1;
      while (usedNames.has(targetName)) {
        const dot = item.name.lastIndexOf('.');
        const base = dot > 0 ? item.name.slice(0, dot) : item.name;
        const ext = dot > 0 ? item.name.slice(dot) : '';
        targetName = `${folderPrefix}/${base}_${dupIdx++}${ext}`;
      }
      usedNames.add(targetName);
      zip.file(targetName, blob);
    }
  }

  return zip.generateAsync({ type: 'blob' });
}

/**
 * Streams dataset files directly to a chosen OS folder via File System Access API
 * so multi-gigabyte photo & video datasets export without exhausting browser RAM.
 */
export async function exportDatasetToLocalFolder(
  dirHandle: FileSystemDirectoryHandle,
  dataset: DatasetCollection,
  items: MediaItem[],
  options: ExportOptions,
  onProgress?: (completed: number, total: number, currentName: string) => void
): Promise<number> {
  const filtered = options.onlyApproved
    ? items.filter((i) => i.status === 'approved')
    : items;

  const writeTextFile = async (
    parent: FileSystemDirectoryHandle,
    name: string,
    text: string
  ) => {
    const fh = await parent.getFileHandle(name, { create: true });
    const writable = await fh.createWritable();
    await writable.write(text);
    await writable.close();
  };

  if (options.format === 'coco') {
    const annDir = await dirHandle.getDirectoryHandle('annotations', { create: true });
    await writeTextFile(annDir, 'instances_default.json', buildCocoJson(dataset, filtered));
  } else if (options.format === 'jsonl') {
    await writeTextFile(dirHandle, 'manifest.jsonl', buildJsonlManifest(filtered));
  } else if (options.format === 'csv') {
    await writeTextFile(dirHandle, 'dataset_index.csv', buildCsvIndex(filtered));
  } else if (options.format === 'yolo') {
    const yolo = buildYoloFiles(dataset, filtered);
    await writeTextFile(dirHandle, 'classes.txt', yolo.classesTxt);
    await writeTextFile(dirHandle, 'data.yaml', yolo.dataYaml);
    const labelsDir = await dirHandle.getDirectoryHandle('labels', { create: true });
    for (const lf of yolo.labelFiles) {
      await writeTextFile(labelsDir, lf.path, lf.content);
    }
  }

  let writtenCount = 0;
  if (options.includeMediaFiles) {
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      onProgress?.(i + 1, filtered.length, item.name);
      const blob = await loadMediaBlob(item);
      if (!blob) continue;

      let targetDir = dirHandle;
      if (options.organizeBySplit) {
        targetDir = await targetDir.getDirectoryHandle(item.split, { create: true });
      }
      targetDir = await targetDir.getDirectoryHandle(
        item.kind === 'photo' ? 'images' : 'videos',
        { create: true }
      );

      const fh = await targetDir.getFileHandle(item.name, { create: true });
      const writable = await fh.createWritable();
      await writable.write(blob);
      await writable.close();
      writtenCount++;
    }
  }

  return writtenCount;
}
