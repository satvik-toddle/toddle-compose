import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import {
  makeObjectKey,
  type FetchedObject,
  type ObjectStorage,
  type PutObjectInput,
  type StoredObject,
} from "./object-storage";

// S3-compatible ObjectStorage; the AWS SDK is imported lazily so the local driver needs it not installed.
@Injectable()
export class S3ObjectStorage implements ObjectStorage {
  private readonly logger = new Logger(S3ObjectStorage.name);
  private readonly bucket: string;
  private readonly region?: string;
  private readonly endpoint?: string;
  private readonly publicBase?: string;
  private readonly forcePathStyle: boolean;
  private readonly accessKeyId?: string;
  private readonly secretAccessKey?: string;
  private readonly signTtlSec = 3600;

  // Lazily-loaded SDK handles (typed loose — the package may not be installed).
  private sdk?: {
    client: any;
    PutObjectCommand: any;
    GetObjectCommand: any;
    DeleteObjectCommand: any;
    getSignedUrl: any;
  };

  constructor(config: ConfigService<Env, true>) {
    const bucket = config.get("STORAGE_S3_BUCKET", { infer: true });
    if (!bucket) {
      throw new Error(
        "STORAGE_DRIVER=s3 requires STORAGE_S3_BUCKET (and region/credentials)"
      );
    }
    this.bucket = bucket;
    this.region = config.get("STORAGE_S3_REGION", { infer: true });
    this.endpoint = config.get("STORAGE_S3_ENDPOINT", { infer: true });
    this.publicBase = config
      .get("STORAGE_S3_PUBLIC_URL", { infer: true })
      ?.replace(/\/+$/, "");
    this.forcePathStyle = config.get("STORAGE_S3_FORCE_PATH_STYLE", { infer: true });
    this.accessKeyId = config.get("STORAGE_S3_ACCESS_KEY_ID", { infer: true });
    this.secretAccessKey = config.get("STORAGE_S3_SECRET_ACCESS_KEY", { infer: true });
  }

  /** Lazily import the AWS SDK and build a memoized client. */
  private async load() {
    if (this.sdk) return this.sdk;
    // Non-literal specifiers so TS doesn't require the packages at build time.
    const clientSpec = "@aws-sdk/client-s3";
    const presignSpec = "@aws-sdk/s3-request-presigner";
    let s3mod: any;
    let presignMod: any;
    try {
      s3mod = await import(clientSpec);
      presignMod = await import(presignSpec);
    } catch {
      throw new Error(
        "S3 storage selected but the AWS SDK is not installed. Run: " +
          "pnpm --filter backend add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner"
      );
    }
    const credentials =
      this.accessKeyId && this.secretAccessKey
        ? { accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey }
        : undefined; // fall back to the default AWS credential chain
    const client = new s3mod.S3Client({
      region: this.region,
      endpoint: this.endpoint,
      forcePathStyle: this.forcePathStyle,
      credentials,
    });
    this.sdk = {
      client,
      PutObjectCommand: s3mod.PutObjectCommand,
      GetObjectCommand: s3mod.GetObjectCommand,
      DeleteObjectCommand: s3mod.DeleteObjectCommand,
      getSignedUrl: presignMod.getSignedUrl,
    };
    this.logger.log(`s3 object storage → bucket "${this.bucket}"`);
    return this.sdk;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const sdk = await this.load();
    const key = makeObjectKey(input.filename);
    await sdk.client.send(
      new sdk.PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.body,
        ContentType: input.contentType,
      })
    );
    return {
      key,
      url: await this.url(key),
      contentType: input.contentType,
      size: input.body.length,
    };
  }

  async get(key: string): Promise<FetchedObject | null> {
    const sdk = await this.load();
    try {
      const res = await sdk.client.send(
        new sdk.GetObjectCommand({ Bucket: this.bucket, Key: key })
      );
      const body = await streamToBuffer(res.Body);
      return {
        body,
        contentType: res.ContentType ?? "application/octet-stream",
        size: body.length,
      };
    } catch (e) {
      // Only a genuine 404 is `null`; transient failures must propagate so callers can retry.
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    const sdk = await this.load();
    await sdk.client.send(
      new sdk.DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }

  async url(key: string): Promise<string> {
    // A public/CDN base means direct links; otherwise hand out a signed GET URL.
    if (this.publicBase) return `${this.publicBase}/${key}`;
    const sdk = await this.load();
    return sdk.getSignedUrl(
      sdk.client,
      new sdk.GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: this.signTtlSec }
    );
  }
}

// True only when an error means the object does not exist (NoSuchKey / 404), not a transient error.
function isNotFound(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    err.name === "NoSuchKey" ||
    err.name === "NotFound" ||
    err.Code === "NoSuchKey" ||
    err.$metadata?.httpStatusCode === 404
  );
}

/** Collect an AWS SDK response body stream into a Buffer. */
async function streamToBuffer(stream: any): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  if (Buffer.isBuffer(stream)) return stream;
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
