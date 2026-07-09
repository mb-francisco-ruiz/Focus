import { isTauri } from "./tauri-env";

/**
 * Cross-window plumbing for mini mode. The main window stays alive (hidden)
 * while the orb floats, so sync, replay and native notifications keep working.
 */

export interface ExpandPayload {
  taskId?: string;
  view?: "suggestions" | "roadmap";
  /** Seed the Ask Focus chat with this message and send it on arrival. */
  chat?: string;
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

/**
 * Resize the orb window and, if the new size would spill off the screen (e.g.
 * the orb was dragged to the right edge before expanding into the panel),
 * nudge it back so the whole GUI stays on the current monitor.
 */
export async function resizeMini(width: number, height: number): Promise<void> {
  const { getCurrentWindow, currentMonitor, LogicalSize, PhysicalPosition } = await import(
    "@tauri-apps/api/window"
  );
  const win = getCurrentWindow();
  await win.setSize(new LogicalSize(width, height));

  try {
    const monitor = await currentMonitor();
    if (!monitor) return;
    const scale = await win.scaleFactor();
    const pos = await win.outerPosition(); // physical px, top-left unchanged by resize
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const m = Math.round(8 * scale);
    const topM = Math.round(30 * scale); // clear the macOS menu bar

    const maxX = monitor.position.x + monitor.size.width - w - m;
    const maxY = monitor.position.y + monitor.size.height - h - m;
    const x = Math.max(monitor.position.x + m, Math.min(pos.x, maxX));
    const y = Math.max(monitor.position.y + topM, Math.min(pos.y, maxY));

    if (x !== pos.x || y !== pos.y) await win.setPosition(new PhysicalPosition(x, y));
  } catch {
    // Positioning is best-effort; the resize already applied.
  }
}
