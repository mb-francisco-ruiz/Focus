import type { WebSocket } from "@fastify/websocket";
import type { SyncMessage } from "@focus/shared";

/**
 * Per-user WebSocket registry. In-process only — fine while API and worker
 * share one service; goes through Redis pub/sub when they split.
 */

const connections = new Map<string, Set<WebSocket>>();

export function subscribe(userId: string, socket: WebSocket): void {
  let set = connections.get(userId);
  if (!set) {
    set = new Set();
    connections.set(userId, set);
  }
  set.add(socket);
  socket.on("close", () => {
    set.delete(socket);
    if (set.size === 0) connections.delete(userId);
  });
}

export function publish(userId: string, message: SyncMessage): void {
  const set = connections.get(userId);
  if (!set) return;
  const data = JSON.stringify(message);
  for (const socket of set) {
    if (socket.readyState === socket.OPEN) socket.send(data);
  }
}
