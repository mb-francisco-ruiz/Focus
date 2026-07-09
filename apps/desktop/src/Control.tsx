import { useEffect, useRef, useState } from "react";
import { controlStatus, startControl, stopControl, type ControlStatus } from "./localAi";

/**
 * Focus computer control: give it a task, it perceives all screens and drives the
 * mouse/keyboard via the local Claude Code sidecar until done. Autonomous with a
 * live view + Stop. Desktop + local-AI mode only (gated by App).
 */
export default function Control() {
  const [task, setTask] = useState("");
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = async () => {
    try {
      const s = await controlStatus();
      setStatus(s);
      if (s.running) pollRef.current = setTimeout(() => void poll(), 1000);
    } catch (e) {
      setError(`Local AI unavailable: ${String(e)}`);
    }
  };

  useEffect(() => {
    void poll(); // pick up an in-flight run on mount
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    setError(null);
    try {
      await startControl(task.trim());
      void poll();
    } catch (e) {
      setError(`Couldn't start: ${String(e)}`);
    }
  };

  const stop = async () => {
    await stopControl().catch(() => {});
    void poll();
  };

  const running = status?.running ?? false;
  const fmtArgs = (a: Record<string, unknown>) =>
    Object.entries(a)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k}=${typeof v === "string" && v.length > 40 ? `${v.slice(0, 40)}…` : v}`)
      .join(" ");

  return (
    <>
      <header className="content-head">
        <h1>Control</h1>
        {running && (
          <button className="danger" onClick={() => void stop()}>
            ■ Stop
          </button>
        )}
      </header>

      <p className="settings-hint">
        Focus will look at your screens and use the mouse &amp; keyboard to do this task on your Mac,
        on your Claude plan. It runs on its own — watch below and hit <strong>Stop</strong> anytime.
        Needs macOS <strong>Screen Recording</strong> + <strong>Accessibility</strong> permission
        (System Settings → Privacy &amp; Security) for the app running it.
      </p>

      <form
        className="capture"
        onSubmit={(e) => {
          e.preventDefault();
          if (task.trim() && !running) void run();
        }}
      >
        <input
          placeholder="Describe a task… e.g. 'Open System Settings and turn on Dark Mode'"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          disabled={running}
        />
      </form>

      {error && <p className="error">{error}</p>}

      {status && (status.steps.length > 0 || status.shots.length > 0 || status.done) && (
        <div className="control-run">
          <div className="control-status">
            {running ? (
              <>
                <span className="dot online" /> Working — {status.steps.length} step
                {status.steps.length === 1 ? "" : "s"}
              </>
            ) : status.error ? (
              <>
                <span className="dot offline" /> {status.error}
              </>
            ) : status.done ? (
              <>
                <span className="dot online" /> Done
              </>
            ) : null}
          </div>

          {status.result && <div className="ask-msg assistant control-result">{status.result}</div>}

          <div className="control-shots">
            {status.shots.map((src, i) => (
              <img key={i} src={src} alt={`display ${i}`} />
            ))}
          </div>

          {status.steps.length > 0 && (
            <ol className="control-steps">
              {status.steps
                .slice()
                .reverse()
                .map((s, i) => (
                  <li key={status.steps.length - i}>
                    <span className="control-action">{s.action}</span> {fmtArgs(s.args)}
                  </li>
                ))}
            </ol>
          )}
        </div>
      )}
    </>
  );
}
