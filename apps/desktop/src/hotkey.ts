import { isRegistered, register } from "@tauri-apps/plugin-global-shortcut";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export const CAPTURE_SHORTCUT = "CmdOrCtrl+Shift+Space";

/** Called once from the main window; opens the quick-capture window from anywhere. */
export async function registerCaptureHotkey(): Promise<void> {
  try {
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
