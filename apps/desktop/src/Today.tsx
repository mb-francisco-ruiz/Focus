import { useEffect, useMemo, useState } from "react";
import type { CalendarEventInfo, PlanBlock, Task } from "@focus/shared";
import { getCalendar, planToday } from "./api";
import { PRIORITY_COLORS } from "./colors";
import { localAiReady, planLocally } from "./localAi";

const START_HOUR = 7;
const END_HOUR = 23;
const HOUR_PX = 54;

function hourOf(iso: string): number {
  const d = new Date(iso);
  return d.getHours() + d.getMinutes() / 60;
}
function fmt(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function clampBlock(startISO: string, endISO: string): { top: number; height: number } | null {
  const s = Math.max(hourOf(startISO), START_HOUR);
  const e = Math.min(hourOf(endISO) || s + 1, END_HOUR);
  if (e <= START_HOUR || s >= END_HOUR) return null;
  return { top: (s - START_HOUR) * HOUR_PX, height: Math.max(22, (e - s) * HOUR_PX) };
}

/** Hourly timetable for today: calendar events + AI-planned focus blocks. */
export default function Today({
  tasks,
  onOpenTask,
  aiMode = "server",
}: {
  tasks: Task[];
  onOpenTask: (id: string) => void;
  aiMode?: "server" | "local";
}) {
  const [events, setEvents] = useState<CalendarEventInfo[]>([]);
  const [connected, setConnected] = useState(true);
  const [plan, setPlan] = useState<PlanBlock[]>([]);
  const [planning, setPlanning] = useState(false);

  useEffect(() => {
    getCalendar()
      .then(({ events, connected }) => {
        setEvents(events);
        setConnected(connected);
      })
      .catch(() => setConnected(false));
  }, []);

  const runPlan = async () => {
    setPlanning(true);
    try {
      if (aiMode === "local" && (await localAiReady())) {
        try {
          setPlan(await planLocally());
        } catch {
          setPlan(await planToday()); // local failed → server fallback
        }
      } else {
        setPlan(await planToday());
      }
    } finally {
      setPlanning(false);
    }
  };

  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const now = new Date();
  const nowTop =
    now.getHours() >= START_HOUR && now.getHours() < END_HOUR
      ? (now.getHours() + now.getMinutes() / 60 - START_HOUR) * HOUR_PX
      : null;

  const { timed, allDay } = useMemo(() => {
    const timed = events.filter((e) => !e.allDay && clampBlock(e.start, e.end));
    const allDay = events.filter((e) => e.allDay);
    return { timed, allDay };
  }, [events]);

  const dueToday = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return tasks
      .filter((t) => t.status !== "done" && t.status !== "archived" && t.dueAt)
      .filter((t) => {
        const d = new Date(t.dueAt!);
        return d >= start && d <= end;
      });
  }, [tasks]);

  const taskTitle = (id: string | null) => tasks.find((t) => t.id === id)?.title;

  return (
    <>
      <header className="content-head">
        <h1>Today</h1>
        <div className="cal-nav">
          <button className="chip" disabled={planning} onClick={() => void runPlan()}>
            {planning ? "Planning…" : "✦ Plan my day"}
          </button>
        </div>
      </header>

      {!connected && (
        <p className="settings-hint">
          Connect a Google account in Settings → Integrations to see your calendar here.
        </p>
      )}

      {(allDay.length > 0 || dueToday.length > 0) && (
        <div className="today-chips">
          {allDay.map((e) => (
            <span key={e.id} className="chip">
              📅 {e.title}
            </span>
          ))}
          {dueToday.map((t) => (
            <button key={t.id} className="chip due-chip" onClick={() => onOpenTask(t.id)}>
              <span className="mini-dot" style={{ background: PRIORITY_COLORS[t.priority] }} /> {t.title}
            </button>
          ))}
        </div>
      )}

      <div className="timetable">
        <div className="tt-grid" style={{ height: (END_HOUR - START_HOUR) * HOUR_PX }}>
          {hours.map((h) => (
            <div className="tt-hour" key={h} style={{ top: (h - START_HOUR) * HOUR_PX }}>
              <span className="tt-hour-label">{String(h).padStart(2, "0")}:00</span>
            </div>
          ))}
          {nowTop !== null && <div className="tt-now" style={{ top: nowTop }} />}

          <div className="tt-lane events">
            {timed.map((e) => {
              const box = clampBlock(e.start, e.end)!;
              return (
                <div key={e.id} className="tt-event" style={{ top: box.top, height: box.height }}>
                  <span className="tt-time">{fmt(e.start)}</span> {e.title}
                </div>
              );
            })}
          </div>

          <div className="tt-lane plan">
            {plan.map((b, i) => {
              const box = clampBlock(b.start, b.end);
              if (!box) return null;
              return (
                <button
                  key={i}
                  className="tt-block"
                  title={b.reason}
                  style={{ top: box.top, height: box.height }}
                  onClick={() => b.taskId && onOpenTask(b.taskId)}
                >
                  <span className="tt-time">{fmt(b.start)}</span> {taskTitle(b.taskId) ?? b.title}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
