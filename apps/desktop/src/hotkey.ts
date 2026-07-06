import { isTauri } from "./tauri-env";

export const CAPTURE_SHORTCUT = "CmdOrCtrl+Shift+Space";

/** Called once from the main window; opens the quick-capture window from anywhere. */
export async function registerCaptureHotkey(): Promise<void> {
  if (!isTauri) return; // plain-browser dev: no global shortcuts
  try {
    const { isRegistered, register } = await import("@tauri-apps/plugin-global-shortcut");
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    if (await isRegistered(CAPTURE_SHORTCUT)) return; // dev hot-reload
    await register(CAPTURE_SHORTCUT, async (event) => {
      if (event.state !== "Pressed") return;
      const quick = await WebviewWindow.getByLabel("quick");
      if (!quick) return;
      await quick.center();
      await quick.show();
      await quick.setFocus();
    });
  } catch (err) {
    console.error("hotkey registration failed", err);
  }
}
