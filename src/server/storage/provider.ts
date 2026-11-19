export interface StorageProvider {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Blob index tags (Azure only) — used to read Defender for Storage scan results. */
  getTags?(key: string): Promise<Record<string, string>>;
}

let instance: StorageProvider | null = null;

export async function getStorage(): Promise<StorageProvider> {
  if (instance) return instance;
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "azure") {
    const { AzureBlobStorage } = await import("./azure-blob");
    instance = new AzureBlobStorage(
      process.env.AZURE_STORAGE_CONNECTION_STRING ?? "",
      process.env.AZURE_STORAGE_CONTAINER ?? "attachments",
    );
  } else {
    const { LocalDiskStorage } = await import("./local");
    instance = new LocalDiskStorage(process.env.STORAGE_LOCAL_DIR ?? "./storage");
  }
  return instance;
}
