import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "../config.js";

/**
 * AES-256-GCM for OAuth tokens at rest (PLAN.md §5.3). Key derived from
 * JWT_SECRET — rotating that secret invalidates sessions AND stored tokens,
 * which is acceptable at this stage; a dedicated KMS key comes with multi-user.
 */

const key = scryptSync(env.JWT_SECRET, "focus-token-encryption", 32);

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv!, "base64"));
  decipher.setAuthTag(Buffer.from(tag!, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data!, "base64")), decipher.final()]).toString(
    "utf8",
  );
}
