import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** scrypt with per-user salt, stored as `salt.hash` hex. No deps. */

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}.${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(".");
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}
