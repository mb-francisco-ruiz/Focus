/**
 * True when running inside the Tauri webview. False in a plain browser
 * (vite dev server opened directly), where Tauri plugins are stubbed so the
 * UI stays fully testable without the native shell.
 */
export const isTauri = "__TAURI_INTERNALS__" in window;
