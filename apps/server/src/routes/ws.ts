import type { FastifyInstance } from "fastify";
import { subscribe } from "../lib/bus.js";

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Live sync channel. Browsers/webviews can't set headers on WebSocket
   * upgrade, so auth is a `token` query param carrying the same JWT.
   */
  app.get("/ws", { websocket: true }, (socket, req) => {
    const { token } = req.query as { token?: string };
    let userId: string;
    try {
      userId = app.jwt.verify<{ sub: string }>(token ?? "").sub;
    } catch {
      socket.close(4401, "unauthorized");
      return;
    }
    subscribe(userId, socket);
  });
}
