import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import type { StorageProvider } from "./provider";

/** Azure Blob Storage (also works against Azurite for local testing). Container should be private. */
export class AzureBlobStorage implements StorageProvider {
  private container: ContainerClient;
  private ready: Promise<unknown>;
  constructor(connectionString: string, containerName: string) {
    if (!connectionString) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set");
    this.container = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(containerName);
    this.ready = this.container.createIfNotExists();
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.ready;
    await this.container.getBlockBlobClient(key).uploadData(data, { blobHTTPHeaders: { blobContentType: contentType } });
  }
  async get(key: string) {
    await this.ready;
    return this.container.getBlobClient(key).downloadToBuffer();
  }
  async getTags(key: string) {
    await this.ready;
    return (await this.container.getBlobClient(key).getTags()).tags;
  }
  async delete(key: string) {
    await this.ready;
    await this.container.getBlobClient(key).deleteIfExists();
  }
}
