import type { GazePoint, GazeSession, SessionMeta } from './session';
const DB_NAME = 'gaze-recordings-v1';
const request = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const complete = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Local storage failed.')); });
export class SessionStore {
  constructor(private db: IDBDatabase) {}
  static async open() {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('sessions', { keyPath: 'id' });
      req.result.createObjectStore('samples');
      req.result.createObjectStore('video', { keyPath: ['id', 'index'] });
    };
    const db = await request(req); db.onversionchange = () => db.close();
    return new SessionStore(db);
  }
  async list(): Promise<SessionMeta[]> {
    const tx = this.db.transaction('sessions');
    const all = await request(tx.objectStore('sessions').getAll());
    return (all as SessionMeta[]).filter(s => s.version === 1).sort((a, b) => b.startedAt - a.startedAt);
  }
  async save(session: GazeSession) {
    const { points, ...meta } = session;
    const tx = this.db.transaction(['sessions', 'samples'], 'readwrite'), done = complete(tx);
    tx.objectStore('sessions').put(meta); tx.objectStore('samples').put(points, session.id);
    await done;
  }
  async load(id: string): Promise<GazeSession | null> {
    const tx = this.db.transaction(['sessions', 'samples']);
    const [meta, points] = await Promise.all([request(tx.objectStore('sessions').get(id)), request(tx.objectStore('samples').get(id))]);
    return meta?.version === 1 && Array.isArray(points) ? { ...meta, points: points as GazePoint[] } : null;
  }
  async addVideo(id: string, index: number, blob: Blob) {
    const tx = this.db.transaction('video', 'readwrite'), done = complete(tx);
    tx.objectStore('video').put({ id, index, blob }); await done;
  }
  async video(id: string, type: string) {
    const tx = this.db.transaction('video');
    const parts = await request(tx.objectStore('video').getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])));
    return parts.length ? new Blob(parts.map(p => p.blob), { type }) : null;
  }
  async remove(id: string) {
    const tx = this.db.transaction(['sessions', 'samples', 'video'], 'readwrite'), done = complete(tx);
    tx.objectStore('sessions').delete(id); tx.objectStore('samples').delete(id);
    tx.objectStore('video').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    await done;
  }
  close() { this.db.close(); }
}
