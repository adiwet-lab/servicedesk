import { promises as fs } from "node:fs";
import path from "node:path";
import type { StorageProvider } from "./provider";

/** Development storage on local disk. Keys are server-generated (never user input). */
export class LocalDiskStorage implements StorageProvider {
  private root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data);
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
}
