import type { FastifyInstance } from "fastify";
import { and, eq, inArray, not } from "drizzle-orm";
import { SetAiKeyRequest, SetAiModeRequest, UpdateSpheresRequest, type UserProfile } from "@focus/shared";
import { db, schema } from "../db/index.js";
import { clearAiKeyCache } from "../lib/ai-key.js";
import { encrypt } from "../lib/crypto.js";
import { recordEvent } from "../lib/events.js";
import { fileStorage } from "../lib/storage.js";

const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

function toProfile(user: typeof schema.users.$inferSelect): UserProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarKey: user.avatarKey,
    spheres: user.spheres,
    hasAiKey: Boolean(user.aiApiKey),
    aiMode: user.aiMode,
  };
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get("/users/me", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, req.userId) });
    if (!user) return reply.code(404).send({ error: "user not found" });
    return toProfile(user);
  });

  /** Set the user's own Gemini API key (encrypted at rest; never returned). */
  app.put("/users/me/ai-key", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { apiKey } = SetAiKeyRequest.parse(req.body);
    const [user] = await db
      .update(schema.users)
      .set({ aiApiKey: encrypt(apiKey.trim()) })
      .where(eq(schema.users.id, req.userId))
      .returning();
    clearAiKeyCache(req.userId);
    return toProfile(user!);
  });

  /** Switch where this user's foreground AI runs: server API vs local Claude Code. */
  app.put("/users/me/ai-mode", { onRequest: [app.authenticate] }, async (req) => {
    const { mode } = SetAiModeRequest.parse(req.body);
    const [user] = await db
      .update(schema.users)
      .set({ aiMode: mode })
      .where(eq(schema.users.id, req.userId))
      .returning();
    return toProfile(user!);
  });

  /** Clear the user's key — AI calls fall back to the server env key, if any. */
  app.delete("/users/me/ai-key", { onRequest: [app.authenticate] }, async (req, reply) => {
    const [user] = await db
      .update(schema.users)
      .set({ aiApiKey: null })
      .where(eq(schema.users.id, req.userId))
      .returning();
    clearAiKeyCache(req.userId);
    return toProfile(user!);
  });

  /**
   * Replace the category list. Tasks in a removed sphere move to the first
   * remaining one so nothing disappears from the boards.
   */
  app.put("/users/me/spheres", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { spheres } = UpdateSpheresRequest.parse(req.body);
    const unique = [...new Set(spheres)];

    const [user] = await db
      .update(schema.users)
      .set({ spheres: unique })
      .where(eq(schema.users.id, req.userId))
      .returning();

    const moved = await db
      .update(schema.tasks)
      .set({ sphere: unique[0]! })
      .where(
        and(eq(schema.tasks.userId, req.userId), not(inArray(schema.tasks.sphere, unique))),
      )
      .returning({ id: schema.tasks.id });

    await recordEvent(req.userId, "task.updated", null, {
      spheresChanged: unique,
      reassigned: moved.length,
    });
    return { ...toProfile(user!), reassigned: moved.length };
  });

  /** Avatar upload → FileStorage (Postgres today, S3 when AWS env is set). */
  app.post("/users/me/avatar", { onRequest: [app.authenticate] }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MAX_AVATAR_BYTES } });
    if (!file) return reply.code(400).send({ error: "no file" });
    if (!file.mimetype.startsWith("image/")) {
      return reply.code(415).send({ error: "images only" });
    }
    const bytes = await file.toBuffer();
    const key = await fileStorage().put(req.userId, bytes, file.mimetype);
    const [user] = await db
      .update(schema.users)
      .set({ avatarKey: key })
      .where(eq(schema.users.id, req.userId))
      .returning();
    return toProfile(user!);
  });

  /** <img>-friendly: JWT via query param, same pattern as /attachments. */
  app.get("/users/me/avatar", async (req, reply) => {
    const { token } = req.query as { token?: string };
    let userId: string;
    try {
      userId = app.jwt.verify<{ sub: string }>(token ?? "").sub;
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    if (!user?.avatarKey) return reply.code(404).send({ error: "no avatar" });
    const stored = await fileStorage().get(user.avatarKey);
    if (!stored) return reply.code(404).send({ error: "not found" });
    return reply.header("Content-Type", stored.mime).send(stored.bytes);
  });
}
