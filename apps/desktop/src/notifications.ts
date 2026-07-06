import { isTauri } from "./tauri-env";

/**
 * Native notifications in the Tauri shell, Web Notifications in browser dev.
 */
export async function showNotification(title: string, body: string): Promise<void> {
  if (isTauri) {
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      "@tauri-apps/plugin-notification"
    );
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
    return;
  }
  if ("Notification" in window) {
    if (Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission === "granted") new Notification(title, { body });
  }
}
