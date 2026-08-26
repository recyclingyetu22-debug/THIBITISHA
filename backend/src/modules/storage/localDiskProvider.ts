import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "../../config/env.js";
import type { StorageProvider } from "./storageProvider.js";

// Dev/Phase-1 implementation. Keys are relative paths under STORAGE_LOCAL_ROOT;
// callers never pass a key derived from user input directly (see documents
// module, which builds keys from generated UUIDs), so path traversal isn't
// reachable from request data.
export class LocalDiskStorageProvider implements StorageProvider {
  private root = path.resolve(env.STORAGE_LOCAL_ROOT);

  async put(key: string, data: Buffer): Promise<void> {
    const fullPath = path.join(this.root, key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(path.join(this.root, key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(path.join(this.root, key), { force: true });
  }
}

export const storageProvider: StorageProvider = new LocalDiskStorageProvider();
