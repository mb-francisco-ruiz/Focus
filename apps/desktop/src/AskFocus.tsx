import { useEffect, useRef, useState } from "react";
import { askFocus } from "./api";
import logo from "./assets/logo.svg";
import { controlStatus, focusSystemPrompt, localAiReady, localAssistant } from "./localAi";
import Markdown from "./Markdown";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/**
 * "Ask Focus" — a conversational bar pinned to the bottom of the main window.
 * The thread expands upward as a panel; each turn sends the whole history to
 * the assistant, which reads and manages tasks/routines/memory via tools.
 * In local mode it runs through the desktop's Claude Code sidecar; otherwise
 * (or on any local failure) it falls back to the server /chat route.
 */
export default function AskFocus({
  seed,
  aiMode = "server",
  spheres = [],
  onControlStarted,
}: {
  seed?: { text: string; nonce: number };
  aiMode?: "server" | "local";
  spheres?: string[];
  /** Called when the assistant kicks off a computer-control run — jump to Control. */
  onControlStarted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const history: Msg[] = [...messages, { role: "user", content }];
    setMessages(history);
    setInput("");
    setOpen(true);
    setBusy(true);
    try {
      let reply: string;
      if (aiMode === "local" && (await localAiReady())) {
        try {
          reply = await localAssistant(focusSystemPrompt(spheres), history);
          // If the assistant launched a computer-control run, jump to the Control view.
          try {
            if ((await controlStatus()).running) onControlStarted?.();
          } catch {
            /* ignore */
          }
        } catch {
          reply = await askFocus(history); // local failed → server fallback
        }
      } else {
        reply = await askFocus(history);
      }
      setMessages([...history, { role: "assistant", content: reply }]);
    } catch {
      setMessages([
        ...history,
        { role: "assistant", content: "Something went wrong reaching Focus. Try again." },
      ]);
    } finally {
      setBusy(false);
    }
  };

  // A message handed off from the mini orb's Chat field: open and auto-send.
  useEffect(() => {
    if (seed?.text) {
      setOpen(true);
      void send(seed.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  return (
    <div className={`ask ${open && messages.length > 0 ? "open" : ""}`}>
      {open && messages.length > 0 && (
        <div className="ask-thread" ref={threadRef}>
          <div className="ask-thread-head">
            <span>
              <img src={logo} className="ask-logo" alt="" /> Ask Focus
            </span>
            <button className="link" onClick={() => setMessages([])}>
              Clear
            </button>
          </div>
          {messages.map((m, i) => (
            <div key={i} className={`ask-msg ${m.role}`}>
              {m.role === "assistant" ? <Markdown text={m.content} /> : m.content}
            </div>
          ))}
          {busy && <div className="ask-msg assistant thinking">Thinking…</div>}
        </div>
      )}
      <form
        className="ask-bar"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <img src={logo} className="ask-logo" alt="" />
        <input
          ref={inputRef}
          placeholder="What?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => messages.length > 0 && setOpen(true)}
        />
        {messages.length > 0 && (
          <button
            type="button"
            className="ask-toggle"
            title={open ? "Collapse" : "Expand"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "▾" : "▴"}
          </button>
        )}
        <button type="submit" className="ask-send" disabled={busy || !input.trim()}>
          ↑
        </button>
      </form>
    </div>
  );
}
