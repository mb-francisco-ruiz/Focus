import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { Button, Key, Point, keyboard, mouse } from "@nut-tree-fork/nut-js";

/**
 * Computer-control tools for the Focus agent (macOS). Perception via the built-in
 * `screencapture` (all displays) + `sips` (downscale) — no image deps; input via
 * nut-js. Coordinates the model gives are per-display IMAGE pixels; we map them to
 * global logical points for nut-js. Best-effort multi-display: `screencapture -D`
 * order is assumed to match CoreGraphics order (main first).
 */

const exec = promisify(execFile);
const MAX_W = 1280; // downscale cap per display — keep vision tokens sane
mouse.config.autoDelayMs = 60;
keyboard.config.autoDelayMs = 20;

/** Latest screenshots (data URLs) for the live UI; updated on every capture. */
let latest = [];
export function latestShots() {
  return latest;
}

/** Per-display geometry in top-left global logical points, main display first. */
async function displays() {
  const jxa = `ObjC.import('AppKit');
    const ss=$.NSScreen.screens; const o=[];
    for (let i=0;i<ss.count;i++){const f=ss.objectAtIndex(i).frame;const s=ss.objectAtIndex(i).backingScaleFactor;
      o.push({x:f.origin.x,y:f.origin.y,w:f.size.width,h:f.size.height,scale:s});}
    JSON.stringify(o);`;
  let raw;
  try {
    const { stdout } = await exec("osascript", ["-l", "JavaScript", "-e", jxa]);
    raw = JSON.parse(stdout.trim());
  } catch {
    raw = [{ x: 0, y: 0, w: 1512, h: 982, scale: 2 }]; // fallback: assume one display
  }
  const primary = raw.find((s) => s.x === 0 && s.y === 0) ?? raw[0];
  const flip = (s) => ({
    // Cocoa (bottom-left) → CG global (top-left, y-down)
    x: s.x,
    y: primary.h - (s.y + s.h),
    w: s.w,
    h: s.h,
  });
  // Main display first so it aligns with `screencapture -D 1`.
  return [primary, ...raw.filter((s) => s !== primary)].map(flip);
}

async function pixelSize(file) {
  const { stdout } = await exec("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const w = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1]);
  const h = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1]);
  return { w, h };
}

/** Capture every display, downscaled; returns geometry + image blocks + a label. */
async function screenshotAll() {
  const disp = await displays();
  const images = [];
  const geo = [];
  for (let i = 0; i < disp.length; i++) {
    const file = join(tmpdir(), `focus-shot-${i}.png`);
    try {
      await exec("screencapture", ["-x", "-D", String(i + 1), file]);
      await exec("sips", ["-Z", String(MAX_W), file]); // downscale in place
      const { w: iw, h: ih } = await pixelSize(file);
      const b64 = (await readFile(file)).toString("base64");
      images.push({ type: "image", data: b64, mimeType: "image/png" });
      geo.push({ index: i, iw, ih, ...disp[i] });
    } catch {
      /* skip a display that fails to capture (permission?) */
    }
  }
  latest = images.map((im) => `data:image/png;base64,${im.data}`);
  const label =
    geo.length === 0
      ? "No displays captured — Screen Recording permission may be missing."
      : geo
          .map(
            (g) =>
              `Display ${g.index}: image is ${g.iw}x${g.ih}px (full display, ${Math.round(g.w)}x${Math.round(g.h)} logical). Give coordinates as {display:${g.index}, x, y} in this image's pixels.`,
          )
          .join("\n");
  return { content: [{ type: "text", text: label }, ...images], _geo: geo };
}

/** Map a display-image pixel coord to a global logical Point for nut-js. */
async function toGlobal(display, x, y) {
  const disp = await displays();
  const file = join(tmpdir(), `focus-shot-${display}.png`);
  const { w: iw, h: ih } = await pixelSize(file).catch(() => ({ w: 0, h: 0 }));
  const d = disp[display] ?? disp[0];
  if (!iw || !ih) return new Point(d.x + x, d.y + y);
  return new Point(Math.round(d.x + (x / iw) * d.w), Math.round(d.y + (y / ih) * d.h));
}

const KEY_MAP = {
  cmd: Key.LeftCmd, command: Key.LeftCmd, meta: Key.LeftCmd, win: Key.LeftCmd,
  ctrl: Key.LeftControl, control: Key.LeftControl,
  alt: Key.LeftAlt, option: Key.LeftAlt, opt: Key.LeftAlt,
  shift: Key.LeftShift,
  enter: Key.Enter, return: Key.Return, space: Key.Space, tab: Key.Tab,
  esc: Key.Escape, escape: Key.Escape, backspace: Key.Backspace, delete: Key.Delete,
  up: Key.Up, down: Key.Down, left: Key.Left, right: Key.Right,
};
function toKey(token) {
  const t = token.trim().toLowerCase();
  if (KEY_MAP[t]) return KEY_MAP[t];
  if (/^[a-z]$/.test(t)) return Key[t.toUpperCase()];
  if (/^[0-9]$/.test(t)) return Key[`Num${t}`];
  if (/^f[0-9]{1,2}$/.test(t)) return Key[t.toUpperCase()];
  return null;
}

const ok = (extra) => async () => {
  await new Promise((r) => setTimeout(r, 400)); // let the UI settle
  return screenshotAll();
};

export function computerTools(onAction) {
  const act = (name, args) => onAction?.({ action: name, args });
  const shot = () => screenshotAll();

  return [
    tool("screenshot", "Capture all displays and return the images.", {}, async () => {
      act("screenshot", {});
      return shot();
    }),
    tool(
      "move",
      "Move the mouse to a point on a display (image pixel coordinates).",
      { display: z.number().int(), x: z.number().int(), y: z.number().int() },
      async ({ display, x, y }) => {
        act("move", { display, x, y });
        await mouse.setPosition(await toGlobal(display, x, y));
        return shot();
      },
    ),
    tool(
      "click",
      "Click at a point. button: left|right|middle (default left). double for double-click.",
      {
        display: z.number().int(),
        x: z.number().int(),
        y: z.number().int(),
        button: z.enum(["left", "right", "middle"]).optional(),
        double: z.boolean().optional(),
      },
      async ({ display, x, y, button, double }) => {
        act("click", { display, x, y, button, double });
        await mouse.setPosition(await toGlobal(display, x, y));
        const b = button === "right" ? Button.RIGHT : button === "middle" ? Button.MIDDLE : Button.LEFT;
        if (double) await mouse.doubleClick(b);
        else await mouse.click(b);
        return ok()();
      },
    ),
    tool(
      "type",
      "Type a string of text at the current focus.",
      { text: z.string() },
      async ({ text }) => {
        act("type", { text });
        await keyboard.type(text);
        return ok()();
      },
    ),
    tool(
      "key",
      "Press a key combo, e.g. 'cmd+space', 'cmd+a', 'enter', 'esc'.",
      { combo: z.string() },
      async ({ combo }) => {
        act("key", { combo });
        const keys = combo.split("+").map(toKey).filter((k) => k !== null && k !== undefined);
        if (keys.length) {
          await keyboard.pressKey(...keys);
          await keyboard.releaseKey(...keys.reverse());
        }
        return ok()();
      },
    ),
    tool(
      "scroll",
      "Scroll by an amount. Positive dy scrolls down, positive dx scrolls right.",
      { dx: z.number().int().optional(), dy: z.number().int().optional() },
      async ({ dx = 0, dy = 0 }) => {
        act("scroll", { dx, dy });
        if (dy > 0) await mouse.scrollDown(dy);
        if (dy < 0) await mouse.scrollUp(-dy);
        if (dx > 0) await mouse.scrollRight(dx);
        if (dx < 0) await mouse.scrollLeft(-dx);
        return ok()();
      },
    ),
    tool(
      "wait",
      "Wait for the given milliseconds (e.g. for a page/app to load), then re-screenshot.",
      { ms: z.number().int().min(0).max(10000) },
      async ({ ms }) => {
        act("wait", { ms });
        await new Promise((r) => setTimeout(r, ms));
        return shot();
      },
    ),
  ];
}

export const COMPUTER_TOOL_NAMES = [
  "screenshot",
  "move",
  "click",
  "type",
  "key",
  "scroll",
  "wait",
].map((n) => `mcp__computer__${n}`);
