import { DatasetCollection, MediaItem, StorageQuotaStats } from '../types/dataset';

const DB_NAME = 'framevault_dataset_db';
const DB_VERSION = 1;

const STORE_DATASETS = 'datasets';
const STORE_ITEMS = 'items';
const STORE_BLOBS = 'blobs';
const STORE_THUMBS = 'thumbs';
const STORE_HANDLES = 'handles';
const STORE_META = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;
let opfsRootPromise: Promise<FileSystemDirectoryHandle | null> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_DATASETS)) {
        db.createObjectStore(STORE_DATASETS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        const itemsStore = db.createObjectStore(STORE_ITEMS, { keyPath: 'id' });
        itemsStore.createIndex('datasetId', 'datasetId', { unique: false });
        itemsStore.createIndex('kind', 'kind', { unique: false });
        itemsStore.createIndex('sha256', 'sha256', { unique: false });
        itemsStore.createIndex('split', 'split', { unique: false });
        itemsStore.createIndex('status', 'status', { unique: false });
        itemsStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
      if (!db.objectStoreNames.contains(STORE_THUMBS)) {
        db.createObjectStore(STORE_THUMBS);
      }
      if (!db.objectStoreNames.contains(STORE_HANDLES)) {
        db.createObjectStore(STORE_HANDLES);
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function getOpfsDirectories(): Promise<{
  mediaDir: FileSystemDirectoryHandle;
  thumbDir: FileSystemDirectoryHandle;
} | null> {
  if (!opfsRootPromise) {
    opfsRootPromise = (async () => {
      try {
        if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
          return null;
        }
        const root = await navigator.storage.getDirectory();
        // Verify write access works in current browser context
        const testDir = await root.getDirectoryHandle('framevault_media', { create: true });
        return testDir;
      } catch {
        return null;
      }
    })();
  }

  const baseDir = await opfsRootPromise;
  if (!baseDir) return null;

  try {
    const mediaDir = await baseDir.getDirectoryHandle('originals', { create: true });
    const thumbDir = await baseDir.getDirectoryHandle('thumbnails', { create: true });
    return { mediaDir, thumbDir };
  } catch {
    return null;
  }
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTransactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getMetaValue<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  const tx = db.transaction(STORE_META, 'readonly');
  return idbRequest<T | undefined>(tx.objectStore(STORE_META).get(key));
}

export async function setMetaValue<T>(key: string, value: T): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_META, 'readwrite');
  tx.objectStore(STORE_META).put(value, key);
  await idbTransactionDone(tx);
}

export async function listDatasets(): Promise<DatasetCollection[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_DATASETS, 'readonly');
  const all = await idbRequest<DatasetCollection[]>(tx.objectStore(STORE_DATASETS).getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveDataset(dataset: DatasetCollection): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_DATASETS, 'readwrite');
  tx.objectStore(STORE_DATASETS).put(dataset);
  await idbTransactionDone(tx);
}

export async function deleteDatasetAndItems(datasetId: string): Promise<void> {
  const items = await listMediaItems(datasetId);
  await deleteMediaItemsBatch(items);
  const db = await openDB();
  const tx = db.transaction(STORE_DATASETS, 'readwrite');
  tx.objectStore(STORE_DATASETS).delete(datasetId);
  await idbTransactionDone(tx);
}

export async function listMediaItems(datasetId?: string): Promise<MediaItem[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_ITEMS, 'readonly');
  const store = tx.objectStore(STORE_ITEMS);
  let items: MediaItem[];
  if (datasetId) {
    const index = store.index('datasetId');
    items = await idbRequest<MediaItem[]>(index.getAll(datasetId));
  } else {
    items = await idbRequest<MediaItem[]>(store.getAll());
  }
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveMediaItem(item: MediaItem): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_ITEMS, 'readwrite');
  tx.objectStore(STORE_ITEMS).put(item);
  await idbTransactionDone(tx);
}

export async function saveMediaItemsBatch(items: MediaItem[]): Promise<void> {
  if (items.length === 0) return;
  const db = await openDB();
  const tx = db.transaction(STORE_ITEMS, 'readwrite');
  const store = tx.objectStore(STORE_ITEMS);
  for (const item of items) {
    store.put(item);
  }
  await idbTransactionDone(tx);
}

export async function storeMediaBinary(
  id: string,
  blob: Blob,
  thumbnailBlob?: Blob | null
): Promise<'opfs' | 'idb'> {
  const opfs = await getOpfsDirectories();
  if (opfs) {
    try {
      const fileHandle = await opfs.mediaDir.getFileHandle(id, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      if (thumbnailBlob) {
        const thumbHandle = await opfs.thumbDir.getFileHandle(id, { create: true });
        const thumbWritable = await thumbHandle.createWritable();
        await thumbWritable.write(thumbnailBlob);
        await thumbWritable.close();
      }
      return 'opfs';
    } catch {
      // Fall through to IndexedDB binary store
    }
  }

  const db = await openDB();
  const tx = db.transaction([STORE_BLOBS, STORE_THUMBS], 'readwrite');
  tx.objectStore(STORE_BLOBS).put(blob, id);
  if (thumbnailBlob) {
    tx.objectStore(STORE_THUMBS).put(thumbnailBlob, id);
  }
  await idbTransactionDone(tx);
  return 'idb';
}

export async function storeLinkedFileHandle(
  id: string,
  handle: FileSystemFileHandle,
  thumbnailBlob?: Blob | null
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_HANDLES, 'readwrite');
  tx.objectStore(STORE_HANDLES).put(handle, id);
  await idbTransactionDone(tx);

  if (thumbnailBlob) {
    const opfs = await getOpfsDirectories();
    if (opfs) {
      try {
        const thumbHandle = await opfs.thumbDir.getFileHandle(id, { create: true });
        const thumbWritable = await thumbHandle.createWritable();
        await thumbWritable.write(thumbnailBlob);
        await thumbWritable.close();
        return;
      } catch {
        // Fallback to IDB thumb store
      }
    }
    const thumbTx = db.transaction(STORE_THUMBS, 'readwrite');
    thumbTx.objectStore(STORE_THUMBS).put(thumbnailBlob, id);
    await idbTransactionDone(thumbTx);
  }
}

export async function loadMediaBlob(item: MediaItem): Promise<Blob | null> {
  if (item.storageMode === 'handle') {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_HANDLES, 'readonly');
      const handle = await idbRequest<FileSystemFileHandle | undefined>(
        tx.objectStore(STORE_HANDLES).get(item.id)
      );
      if (handle) {
        return await handle.getFile();
      }
    } catch {
      return null;
    }
  }

  if (item.storageMode === 'opfs') {
    const opfs = await getOpfsDirectories();
    if (opfs) {
      try {
        const fileHandle = await opfs.mediaDir.getFileHandle(item.id);
        return await fileHandle.getFile();
      } catch {
        // Fallback check in IDB
      }
    }
  }

  const db = await openDB();
  const tx = db.transaction(STORE_BLOBS, 'readonly');
  const blob = await idbRequest<Blob | undefined>(tx.objectStore(STORE_BLOBS).get(item.id));
  return blob ?? null;
}

export async function loadThumbnailBlob(item: MediaItem): Promise<Blob | null> {
  if (!item.hasThumbnail) {
    return loadMediaBlob(item);
  }

  const opfs = await getOpfsDirectories();
  if (opfs) {
    try {
      const thumbHandle = await opfs.thumbDir.getFileHandle(item.id);
      return await thumbHandle.getFile();
    } catch {
      // Fallback check in IDB
    }
  }

  const db = await openDB();
  const tx = db.transaction(STORE_THUMBS, 'readonly');
  const thumb = await idbRequest<Blob | undefined>(tx.objectStore(STORE_THUMBS).get(item.id));
  if (thumb) return thumb;

  return loadMediaBlob(item);
}

export async function deleteMediaItemsBatch(items: MediaItem[]): Promise<void> {
  if (items.length === 0) return;

  const opfs = await getOpfsDirectories();
  if (opfs) {
    await Promise.allSettled(
      items.flatMap((item) => [
        opfs.mediaDir.removeEntry(item.id).catch(() => undefined),
        opfs.thumbDir.removeEntry(item.id).catch(() => undefined),
      ])
    );
  }

  const db = await openDB();
  const tx = db.transaction(
    [STORE_ITEMS, STORE_BLOBS, STORE_THUMBS, STORE_HANDLES],
    'readwrite'
  );
  const itemsStore = tx.objectStore(STORE_ITEMS);
  const blobsStore = tx.objectStore(STORE_BLOBS);
  const thumbsStore = tx.objectStore(STORE_THUMBS);
  const handlesStore = tx.objectStore(STORE_HANDLES);

  for (const item of items) {
    itemsStore.delete(item.id);
    blobsStore.delete(item.id);
    thumbsStore.delete(item.id);
    handlesStore.delete(item.id);
    mediaUrlManager.revokeItem(item.id);
  }
  await idbTransactionDone(tx);
}

export async function getStorageQuotaStats(): Promise<StorageQuotaStats> {
  const opfs = await getOpfsDirectories();
  const engine: 'OPFS' | 'IndexedDB' = opfs ? 'OPFS' : 'IndexedDB';

  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      return {
        usageBytes: est.usage ?? 0,
        quotaBytes: est.quota ?? 1024 * 1024 * 1024 * 10,
        engine,
      };
    }
  } catch {
    // Ignore estimate errors
  }

  return {
    usageBytes: 0,
    quotaBytes: 1024 * 1024 * 1024 * 10,
    engine,
  };
}

/**
 * Bounded LRU ObjectURL Cache so 10,000+ photos/videos never leak memory.
 */
class MediaUrlManager {
  private thumbUrls = new Map<string, string>();
  private fullUrls = new Map<string, string>();
  private inflightThumbs = new Map<string, Promise<string | null>>();
  private inflightFull = new Map<string, Promise<string | null>>();

  private readonly maxThumbEntries = 220;
  private readonly maxFullEntries = 18;

  async getThumbnailUrl(item: MediaItem): Promise<string | null> {
    const cached = this.thumbUrls.get(item.id);
    if (cached) {
      // Refresh LRU order
      this.thumbUrls.delete(item.id);
      this.thumbUrls.set(item.id, cached);
      return cached;
    }

    const pending = this.inflightThumbs.get(item.id);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const blob = await loadThumbnailBlob(item);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        this.setWithLru(this.thumbUrls, item.id, url, this.maxThumbEntries);
        return url;
      } finally {
        this.inflightThumbs.delete(item.id);
      }
    })();

    this.inflightThumbs.set(item.id, promise);
    return promise;
  }

  async getFullMediaUrl(item: MediaItem): Promise<string | null> {
    const cached = this.fullUrls.get(item.id);
    if (cached) {
      this.fullUrls.delete(item.id);
      this.fullUrls.set(item.id, cached);
      return cached;
    }

    const pending = this.inflightFull.get(item.id);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const blob = await loadMediaBlob(item);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        this.setWithLru(this.fullUrls, item.id, url, this.maxFullEntries);
        return url;
      } finally {
        this.inflightFull.delete(item.id);
      }
    })();

    this.inflightFull.set(item.id, promise);
    return promise;
  }

  revokeItem(id: string): void {
    const thumb = this.thumbUrls.get(id);
    if (thumb) {
      URL.revokeObjectURL(thumb);
      this.thumbUrls.delete(id);
    }
    const full = this.fullUrls.get(id);
    if (full) {
      URL.revokeObjectURL(full);
      this.fullUrls.delete(id);
    }
  }

  private setWithLru(
    map: Map<string, string>,
    key: string,
    value: string,
    maxEntries: number
  ): void {
    if (map.has(key)) {
      const old = map.get(key)!;
      if (old !== value) URL.revokeObjectURL(old);
      map.delete(key);
    }
    map.set(key, value);
    while (map.size > maxEntries) {
      const oldestKey = map.keys().next().value;
      if (!oldestKey) break;
      const oldestUrl = map.get(oldestKey);
      if (oldestUrl) URL.revokeObjectURL(oldestUrl);
      map.delete(oldestKey);
    }
  }
}

export const mediaUrlManager = new MediaUrlManager();
