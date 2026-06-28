import type { IStorage } from "../../contracts/IRunContext.js";
import { ChainError } from "../../errors/index.js";
import type { SupabaseDb } from "./SupabaseTypes.js";

export class SupabaseStorage implements IStorage {
  constructor(
    private readonly db: SupabaseDb,
    private readonly bucket: string = "pipeline-blobs",
  ) {}

  async upload(key: string, data: Buffer, mime: string): Promise<string> {
    const { error } = await this.db.storage
      .from(this.bucket)
      .upload(key, data, { contentType: mime, upsert: true });
    if (error) throw new ChainError(`Storage upload failed: ${error.message}`, "STORAGE_ERROR");
    return `${this.bucket}/${key}`;
  }

  async download(storageRef: string): Promise<Buffer> {
    const slashIdx = storageRef.indexOf("/");
    const bucket = slashIdx >= 0 ? storageRef.slice(0, slashIdx) : this.bucket;
    const key = slashIdx >= 0 ? storageRef.slice(slashIdx + 1) : storageRef;

    const { data, error } = await this.db.storage.from(bucket).download(key);
    if (error) throw new ChainError(`Storage download failed: ${error.message}`, "STORAGE_ERROR");
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async delete(storageRef: string): Promise<void> {
    const slashIdx = storageRef.indexOf("/");
    const bucket = slashIdx >= 0 ? storageRef.slice(0, slashIdx) : this.bucket;
    const key = slashIdx >= 0 ? storageRef.slice(slashIdx + 1) : storageRef;

    const { error } = await this.db.storage.from(bucket).remove([key]);
    if (error) throw new ChainError(`Storage delete failed: ${error.message}`, "STORAGE_ERROR");
  }
}
