import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { env } from "../config.js";
import { db, schema } from "../db/index.js";

/**
 * File storage abstraction (avatars, later attachments). Postgres-backed today;
 * when the AWS env vars are set (see config.ts) the S3 backend takes over —
 * only `s3Storage` below needs implementing, the call sites are ready.
 */

export interface StoredFile {
  bytes: Buffer;
  mime: string;
}

export interface FileStorage {
  /** Returns the storage key. */
  put(userId: string, bytes: Buffer, mime: string): Promise<string>;
  get(key: string): Promise<StoredFile | null>;
}

const pgStorage: FileStorage = {
  async put(userId, bytes, mime) {
    const id = ulid();
    await db.insert(schema.attachments).values({
      id,
      userId,
      mime,
      size: bytes.length,
      bytes,
    });
    return id;
  },
  async get(key) {
    const row = await db.query.attachments.findFirst({
      where: eq(schema.attachments.id, key),
    });
    return row ? { bytes: row.bytes, mime: row.mime } : null;
  },
};

const s3Storage: FileStorage = {
  // TODO(aws): implement with @aws-sdk/client-s3 once the bucket exists.
  // Keys should be `${userId}/${ulid()}`; get() can become a presigned URL
  // redirect at the route layer instead of streaming through the server.
  async put() {
    throw new Error("S3 storage not implemented yet — unset AWS_S3_BUCKET to use Postgres");
  },
  async get() {
    throw new Error("S3 storage not implemented yet — unset AWS_S3_BUCKET to use Postgres");
  },
};

export function fileStorage(): FileStorage {
  return env.AWS_S3_BUCKET ? s3Storage : pgStorage;
}
