import urbanCrosswalkImg from '../assets/images/dataset_urban_crosswalk_1793859741607.jpg';
import pcbInspectionImg from '../assets/images/dataset_pcb_inspection_1793859742281.jpg';
import botanicalSpecimenImg from '../assets/images/dataset_botanical_specimen_1793859741844.jpg';
import coastalAerialImg from '../assets/images/dataset_coastal_aerial_1793859742872.jpg';
import {
  getMetaValue,
  listDatasets,
  loadMediaBlob,
  saveDataset,
  saveMediaItem,
  setMetaValue,
} from '../storage/mediaStorage';
import { DatasetCollection, MediaItem } from '../types/dataset';
import { createId } from './formatters';
import { generateProceduralVideoBlob, ingestMediaCandidate } from './mediaProcessor';

const STARTER_PHOTOS = [
  {
    url: urbanCrosswalkImg,
    fileName: 'urban_crosswalk_0142.jpg',
    relativePath: 'urban/urban_crosswalk_0142.jpg',
    labels: ['pedestrian', 'bicycle', 'delivery_van', 'crosswalk'],
    split: 'train' as const,
    status: 'approved' as const,
    caption: 'Daylight city intersection with pedestrians, cyclists, and delivery vehicle crossing.',
    boxes: [
      { id: 'bx_1', label: 'pedestrian', x: 0.14, y: 0.52, width: 0.11, height: 0.36 },
      { id: 'bx_2', label: 'bicycle', x: 0.38, y: 0.52, width: 0.14, height: 0.27 },
      { id: 'bx_3', label: 'delivery_van', x: 0.74, y: 0.45, width: 0.25, height: 0.26 },
    ],
  },
  {
    url: pcbInspectionImg,
    fileName: 'pcb_stm32_macro_0089.jpg',
    relativePath: 'inspection/pcb_stm32_macro_0089.jpg',
    labels: ['microcontroller', 'copper_trace', 'smd_capacitor'],
    split: 'train' as const,
    status: 'approved' as const,
    caption: 'Macro optical inspection of ARM Cortex-M4 microcontroller and gold-plated PCB traces.',
    boxes: [
      { id: 'bx_4', label: 'microcontroller', x: 0.51, y: 0.33, width: 0.26, height: 0.28 },
      { id: 'bx_5', label: 'smd_capacitor', x: 0.11, y: 0.31, width: 0.16, height: 0.19 },
    ],
  },
  {
    url: botanicalSpecimenImg,
    fileName: 'conservatory_fern_0311.jpg',
    relativePath: 'botanical/conservatory_fern_0311.jpg',
    labels: ['fern_frond', 'monstera', 'water_droplets'],
    split: 'val' as const,
    status: 'approved' as const,
    caption: 'Glass conservatory specimen showing unfurling fern fronds and surface condensation.',
    boxes: [
      { id: 'bx_6', label: 'fern_frond', x: 0.35, y: 0.23, width: 0.29, height: 0.69 },
    ],
  },
  {
    url: coastalAerialImg,
    fileName: 'coastal_nadir_survey_0017.jpg',
    relativePath: 'aerial/coastal_nadir_survey_0017.jpg',
    labels: ['research_vessel', 'rocky_shoreline', 'shallow_reef'],
    split: 'test' as const,
    status: 'unreviewed' as const,
    caption: 'Nadir aerial survey of rocky cove and marine research vessel in clear turquoise water.',
    boxes: [
      { id: 'bx_7', label: 'research_vessel', x: 0.39, y: 0.55, width: 0.08, height: 0.07 },
    ],
  },
];

export async function initializeWorkspaceIfEmpty(): Promise<{
  datasets: DatasetCollection[];
  activeDatasetId: string;
}> {
  const existingDatasets = await listDatasets();
  const alreadySeeded = await getMetaValue<boolean>('seeded');

  if (existingDatasets.length > 0) {
    return {
      datasets: existingDatasets,
      activeDatasetId: existingDatasets[0].id,
    };
  }

  const now = Date.now();
  const defaultDataset: DatasetCollection = {
    id: createId('ds'),
    name: 'Multimodal Vision Corpus',
    description:
      'Unlimited photo and video dataset workspace supporting raw local media, frame extraction, bounding boxes, and temporal action segments.',
    classes: [
      'pedestrian',
      'bicycle',
      'delivery_van',
      'crosswalk',
      'microcontroller',
      'copper_trace',
      'fern_frond',
      'research_vessel',
      'moving_target',
      'calibration_grid',
    ],
    createdAt: now,
    updatedAt: now,
  };

  await saveDataset(defaultDataset);

  if (!alreadySeeded) {
    await seedStarterMediaIntoDataset(defaultDataset.id);
    await setMetaValue('seeded', true);
  }

  return {
    datasets: [defaultDataset],
    activeDatasetId: defaultDataset.id,
  };
}

export async function seedStarterMediaIntoDataset(datasetId: string): Promise<MediaItem[]> {
  const createdItems: MediaItem[] = [];

  for (const spec of STARTER_PHOTOS) {
    try {
      const response = await fetch(spec.url);
      if (!response.ok) continue;
      const blob = await response.blob();
      const file = new File([blob], spec.fileName, { type: blob.type || 'image/jpeg' });
      const item = await ingestMediaCandidate(
        { file, relativePath: spec.relativePath },
        datasetId,
        spec.labels
      );
      if (item) {
        item.split = spec.split;
        item.status = spec.status;
        item.caption = spec.caption;
        item.boxes = spec.boxes;
        await saveMediaItem(item);
        createdItems.push(item);
      }
    } catch {
      // Ignore fetch issues in restricted environments
    }
  }

  // Generate 2 real playable WebM calibration/tracking videos
  if (typeof MediaRecorder !== 'undefined') {
    const videoSpecs = [
      {
        fileName: 'optical_target_tracking_01.webm',
        relativePath: 'sequences/optical_target_tracking_01.webm',
        labels: ['moving_target', 'calibration_grid'],
        split: 'train' as const,
        status: 'approved' as const,
        caption: 'Synthetic multi-object horizontal tracking sequence at 24 fps.',
        segments: [
          {
            id: 'seg_1',
            label: 'moving_target',
            startSec: 0.2,
            endSec: 1.6,
            notes: 'Primary linear trajectory across coordinate grid',
          },
        ],
      },
      {
        fileName: 'conveyor_motion_pass_02.webm',
        relativePath: 'sequences/conveyor_motion_pass_02.webm',
        labels: ['moving_target', 'calibration_grid'],
        split: 'val' as const,
        status: 'unreviewed' as const,
        caption: 'Counter-directional dual-target motion sequence for temporal segmentation.',
        segments: [
          {
            id: 'seg_2',
            label: 'calibration_grid',
            startSec: 0.0,
            endSec: 1.2,
            notes: 'Initial entry phase',
          },
        ],
      },
    ];

    for (let idx = 0; idx < videoSpecs.length; idx++) {
      try {
        const vSpec = videoSpecs[idx];
        const videoBlob = await generateProceduralVideoBlob(idx, 1800, 960, 540);
        const file = new File([videoBlob], vSpec.fileName, {
          type: videoBlob.type || 'video/webm',
        });
        const item = await ingestMediaCandidate(
          { file, relativePath: vSpec.relativePath },
          datasetId,
          vSpec.labels
        );
        if (item) {
          item.split = vSpec.split;
          item.status = vSpec.status;
          item.caption = vSpec.caption;
          item.segments = vSpec.segments;
          await saveMediaItem(item);
          // Warm verify readable
          await loadMediaBlob(item);
          createdItems.push(item);
        }
      } catch {
        // Ignore if headless browser lacks MediaRecorder video codec
      }
    }
  }

  return createdItems;
}
