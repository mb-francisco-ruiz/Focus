import { isTauri } from "./tauri-env";

/**
 * Cross-window plumbing for mini mode. The main window stays alive (hidden)
 * while the orb floats, so sync, replay and native notifications keep working.
 */

export interface ExpandPayload {
  taskId?: string;
  view?: "suggestions" | "roadmap";
}

export const EXPAND_EVENT = "focus://expand";

/** Main window → orb. */
export async function shrinkToMini(): Promise<void> {
  if (!isTauri) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const mini = await WebviewWindow.getByLabel("mini");
  if (!mini) return;
  await mini.show();
  await getCurrentWindow().hide();
}

/** Orb → main window, optionally landing on a task or view. */
export async function expandFromMini(payload: ExpandPayload = {}): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { emit } = await import("@tauri-apps/api/event");
  const main = await WebviewWindow.getByLabel("main");
  if (!main) return;
  await emit(EXPAND_EVENT, payload);
  await main.show();
  await main.unminimize();
  await main.setFocus();
  await getCurrentWindow().hide();
}

export async function resizeMini(width: number, height: number): Promise<void> {
  const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setSize(new LogicalSize(width, height));
}
