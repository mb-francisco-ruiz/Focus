import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ulid } from "ulid";
import { createTask, isLoggedIn } from "./api";
import { queueCapture } from "./cache";

/** Rendered in the hidden always-on-top `quick` window (global hotkey). */
export default function QuickCapture() {
  const [input, setInput] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hide = () => {
    setInput("");
    void getCurrentWindow().hide();
  };

  useEffect(() => {
    // Refocus whenever the window is shown.
    const win = getCurrentWindow();
    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      if (focused) inputRef.current?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      void unlisten.then((fn) => fn());
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawInput = input.trim();
    if (!rawInput) return hide();
    if (!isLoggedIn()) {
      setFlash("Sign in from the main window first");
      return;
    }
    const clientId = ulid();
    try {
      await createTask(rawInput, clientId);
    } catch {
      // Offline: queue locally, replay when sync reconnects.
      await queueCapture({ clientId, rawInput, capturedAt: new Date().toISOString() });
    }
    hide();
  };

  return (
    <form className="quick" onSubmit={submit}>
      <input
        ref={inputRef}
        placeholder="Capture anything — Enter to save, Esc to dismiss"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        autoFocus
      />
      {flash && <span className="quick-flash">{flash}</span>}
    </form>
  );
}
