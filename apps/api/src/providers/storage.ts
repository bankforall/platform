import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import type { Config } from "../config.js";
import type { Encryptor } from "../crypto.js";

/**
 * Object storage for KYC documents and payment slips. Files are encrypted with the app key
 * before upload, so a leaked bucket alone does not expose personal data (PDPA).
 */
export class Storage {
  private readonly s3: S3Client;

  constructor(
    private readonly config: Config,
    private readonly enc: Encryptor,
  ) {
    this.s3 = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT || undefined,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.config.S3_BUCKET }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.config.S3_BUCKET }));
    }
  }

  async put(prefix: string, data: Buffer): Promise<string> {
    const key = `${prefix}/${randomUUID()}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: key,
        Body: this.enc.encrypt(data),
        ContentType: "application/octet-stream",
      }),
    );
    return key;
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return this.enc.decrypt(Buffer.from(bytes));
  }

  /** Deletes an object (idempotent: S3 reports success for a missing key). */
  async delete(key: string): Promise<void> {
    if (!key) return;
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
  }

  async ping(): Promise<void> {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.config.S3_BUCKET }));
  }
}
