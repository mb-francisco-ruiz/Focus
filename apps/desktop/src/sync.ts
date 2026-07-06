import type { SyncMessage } from "@focus/shared";
import { wsUrl } from "./api";

/**
 * WebSocket sync client: auto-reconnect with backoff, notifies listeners of
 * server deltas and of connectivity changes (the offline capture queue
 * replays on reconnect).
 */

type MessageListener = (msg: SyncMessage) => void;
type StatusListener = (online: boolean) => void;

let socket: WebSocket | null = null;
let reconnectDelay = 1000;
let closedByUser = false;
const messageListeners = new Set<MessageListener>();
const statusListeners = new Set<StatusListener>();

export function onSyncMessage(fn: MessageListener): () => void {
  messageListeners.add(fn);
  return () => messageListeners.delete(fn);
}

export function onSyncStatus(fn: StatusListener): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

export function connectSync(): void {
  closedByUser = false;
  if (socket && socket.readyState <= WebSocket.OPEN) return;

  socket = new WebSocket(wsUrl());

  socket.onopen = () => {
    reconnectDelay = 1000;
    statusListeners.forEach((fn) => fn(true));
  };
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data as string) as SyncMessage;
    messageListeners.forEach((fn) => fn(msg));
  };
  socket.onclose = () => {
    statusListeners.forEach((fn) => fn(false));
    socket = null;
    if (!closedByUser) {
      setTimeout(connectSync, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    }
  };
  socket.onerror = () => socket?.close();
}

export function disconnectSync(): void {
  closedByUser = true;
  socket?.close();
  socket = null;
}
