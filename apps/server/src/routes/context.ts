import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { AddContextRequest, type ContextItem } from "@focus/shared";
import { db, schema } from "../db/index.js";
import { publish } from "../lib/bus.js";
import { recordEvent } from "../lib/events.js";
import { enqueue } from "../lib/queue.js";

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

function serializeContextItem(row: typeof schema.contextItems.$inferSelect): ContextItem {
  return {
    id: row.id,
    taskId: row.taskId,
    kind: row.kind,
    body: row.body,
    attachmentKey: row.attachmentKey,
    sourceRef: (row.sourceRef as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function ownedTask(taskId: string, userId: string) {
  return db.query.tasks.findFirst({
    where: and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)),
  });
}

export async function contextRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", app.authenticate);

  app.get("/tasks/:id/context", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await ownedTask(id, req.userId))) {
      return reply.code(404).send({ error: "task not found" });
    }
    const rows = await db.query.contextItems.findMany({
      where: eq(schema.contextItems.taskId, id),
      orderBy: [asc(schema.contextItems.createdAt)],
    });
    return { items: rows.map(serializeContextItem) };
  });

  app.post("/tasks/:id/context", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await ownedTask(id, req.userId))) {
      return reply.code(404).send({ error: "task not found" });
    }
    const { kind, body } = AddContextRequest.parse(req.body);

    const [row] = await db
      .insert(schema.contextItems)
      .values({ id: ulid(), taskId: id, kind, body })
      .returning();

    await recordEvent(req.userId, "context.added", id, { kind });
    publish(req.userId, { type: "context.added", taskId: id });
    // New context can change urgency/deadline/next step → full re-enrichment
    // (which respects every overridden field).
    await enqueue("enrich", { taskId: id });

    return reply.code(201).send(serializeContextItem(row!));
  });

  /** Image drag-and-drop: multipart upload → attachment row + image context item. */
  app.post("/tasks/:id/attachments", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await ownedTask(id, req.userId))) {
      return reply.code(404).send({ error: "task not found" });
    }
    const file = await req.file({ limits: { fileSize: MAX_ATTACHMENT_BYTES } });
    if (!file) return reply.code(400).send({ error: "no file" });
    if (!file.mimetype.startsWith("image/")) {
      return reply.code(415).send({ error: "images only (for now)" });
    }
    const bytes = await file.toBuffer();

    const attachmentId = ulid();
    await db.insert(schema.attachments).values({
      id: attachmentId,
      userId: req.userId,
      mime: file.mimetype,
      size: bytes.length,
      bytes,
    });
    const [row] = await db
      .insert(schema.contextItems)
      .values({
        id: ulid(),
        taskId: id,
        kind: "image",
        body: file.filename ?? null,
        attachmentKey: attachmentId,
      })
      .returning();

    await recordEvent(req.userId, "context.added", id, { kind: "image", size: bytes.length });
    publish(req.userId, { type: "context.added", taskId: id });
    await enqueue("enrich", { taskId: id });

    return reply.code(201).send(serializeContextItem(row!));
  });

}

/**
 * Registered without the auth hook: <img> tags can't set Authorization headers,
 * so this also accepts the JWT as a `token` query param (same as /ws).
 * Phase 2 replaces this with short-lived signed URLs on object storage.
 */
export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/attachments/:id", async (req, reply) => {
    const { token } = req.query as { token?: string };
    let userId: string;
    try {
      userId = token
        ? app.jwt.verify<{ sub: string }>(token).sub
        : ((await req.jwtVerify()), req.user.sub);
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const { id } = req.params as { id: string };
    const row = await db.query.attachments.findFirst({
      where: and(eq(schema.attachments.id, id), eq(schema.attachments.userId, userId)),
    });
    if (!row) return reply.code(404).send({ error: "not found" });
    return reply.header("Content-Type", row.mime).send(row.bytes);
  });
}
