// Provider abstraction so later phases can swap in S3/GCS-compatible object
// storage without touching any module that calls StorageProvider — spec §10.
export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
