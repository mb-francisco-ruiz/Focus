/**
 * Glass level scales every vibrancy surface alpha (CSS uses
 * calc(base * var(--glass-level))). 1 = default, lower = more transparent.
 * Persisted per device.
 */

const KEY = "focus.glassLevel";

export function loadGlassLevel(): number {
  const raw = localStorage.getItem(KEY);
  const level = raw ? Number(raw) : 1;
  return Number.isFinite(level) && level > 0 ? level : 1;
}

export function applyGlassLevel(level: number): void {
  document.documentElement.style.setProperty("--glass-level", String(level));
  localStorage.setItem(KEY, String(level));
}

export function restoreGlassLevel(): void {
  document.documentElement.style.setProperty("--glass-level", String(loadGlassLevel()));
}
