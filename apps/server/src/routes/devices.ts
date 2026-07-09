import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { RegisterDeviceRequest, type DeviceInfo } from "@focus/shared";
import { db, schema } from "../db/index.js";

function serializeDevice(row: typeof schema.devices.$inferSelect): DeviceInfo {
  return {
    id: row.id,
    platform: row.platform,
    name: row.name,
    pushToken: row.pushToken,
    appVersion: row.appVersion,
    osVersion: row.osVersion,
    lastSeenAt: row.lastSeenAt.toISOString(),
    disabledAt: row.disabledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", app.authenticate);

  app.post("/devices", async (req, reply) => {
    const body = RegisterDeviceRequest.parse(req.body);
    const id = body.id ?? ulid();
    const existing = await db.query.devices.findFirst({
      where: and(eq(schema.devices.id, id), eq(schema.devices.userId, req.userId)),
    });

    if (existing) {
      const [row] = await db
        .update(schema.devices)
        .set({
          platform: body.platform,
          name: body.name !== undefined ? body.name : existing.name,
          pushToken: body.pushToken !== undefined ? body.pushToken : existing.pushToken,
          appVersion: body.appVersion !== undefined ? body.appVersion : existing.appVersion,
          osVersion: body.osVersion !== undefined ? body.osVersion : existing.osVersion,
          disabledAt: null,
          lastSeenAt: new Date(),
        })
        .where(eq(schema.devices.id, id))
        .returning();
      return serializeDevice(row!);
    }

    const [row] = await db
      .insert(schema.devices)
      .values({
        id,
        userId: req.userId,
        platform: body.platform,
        name: body.name ?? null,
        pushToken: body.pushToken ?? null,
        appVersion: body.appVersion ?? null,
        osVersion: body.osVersion ?? null,
      })
      .returning();
    return reply.code(201).send(serializeDevice(row!));
  });

  app.delete("/devices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db
      .update(schema.devices)
      .set({ disabledAt: new Date(), pushToken: null, lastSeenAt: new Date() })
      .where(and(eq(schema.devices.id, id), eq(schema.devices.userId, req.userId)));
    return reply.code(204).send();
  });
}
