import { useMemo, useState } from "react";
import type { Task } from "@focus/shared";
import { PRIORITY_COLORS } from "./colors";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = Array.from({ length: 12 }, (_, m) =>
  new Date(2000, m, 1).toLocaleString("en-GB", { month: "long" }),
);

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthDays(year: number, month: number): (Date | null)[] {
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const out: (Date | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= daysInMonth; day++) out.push(new Date(year, month, day));
  while (out.length % 7 !== 0) out.push(null);
  return out;
}

/** Month/Year calendar of tasks placed on their due dates; drag to reschedule. */
export default function Calendar({
  tasks,
  onOpenTask,
  onMoveTask,
}: {
  tasks: Task[];
  onOpenTask: (taskId: string) => void;
  onMoveTask: (taskId: string, dueAt: string) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [mode, setMode] = useState<"month" | "year">("month");
  const [dropDay, setDropDay] = useState<string | null>(null);

  const dated = useMemo(
    () => tasks.filter((t) => t.dueAt && t.status !== "archived"),
    [tasks],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of dated) {
      const key = dayKey(new Date(t.dueAt!));
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return map;
  }, [dated]);

  const todayKey = dayKey(new Date());

  const dropOn = (date: Date, e: React.DragEvent) => {
    e.preventDefault();
    setDropDay(null);
    const taskId = e.dataTransfer.getData("text/task-id");
    if (!taskId) return;
    // Keep the task's time of day; default 18:00 for safety.
    const task = tasks.find((t) => t.id === taskId);
    const prev = task?.dueAt ? new Date(task.dueAt) : null;
    const next = new Date(date);
    next.setHours(prev?.getHours() ?? 18, prev?.getMinutes() ?? 0, 0, 0);
    onMoveTask(taskId, next.toISOString());
  };

  const nav = (
    <div className="cal-nav">
      <div className="tabs">
        {(["month", "year"] as const).map((m) => (
          <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
            {m}
          </button>
        ))}
      </div>
      <button
        className="chip"
        onClick={() =>
          setCursor(
            mode === "month"
              ? new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)
              : new Date(cursor.getFullYear() - 1, cursor.getMonth(), 1),
          )
        }
      >
        ‹
      </button>
      <span className="cal-month">
        {mode === "month"
          ? cursor.toLocaleString("en-GB", { month: "long", year: "numeric" })
          : cursor.getFullYear()}
      </span>
      <button
        className="chip"
        onClick={() =>
          setCursor(
            mode === "month"
              ? new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
              : new Date(cursor.getFullYear() + 1, cursor.getMonth(), 1),
          )
        }
      >
        ›
      </button>
      <button
        className="chip"
        onClick={() => {
          const d = new Date();
          setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
        }}
      >
        today
      </button>
    </div>
  );

  if (mode === "year") {
    return (
      <>
        <header className="content-head">
          <h1>Calendar</h1>
          {nav}
        </header>
        <div className="year-grid">
          {MONTHS.map((name, m) => (
            <button
              key={name}
              className="year-month"
              onClick={() => {
                setCursor(new Date(cursor.getFullYear(), m, 1));
                setMode("month");
              }}
            >
              <span className="year-month-name">{name}</span>
              <div className="year-days">
                {monthDays(cursor.getFullYear(), m).map((date, i) => {
                  if (!date) return <span key={`x${i}`} className="year-day empty" />;
                  const key = dayKey(date);
                  const dayTasks = byDay.get(key) ?? [];
                  return (
                    <span
                      key={key}
                      className={`year-day ${key === todayKey ? "today" : ""} ${dayTasks.length ? "has-tasks" : ""}`}
                      title={dayTasks.map((t) => t.title).join("\n")}
                    >
                      {date.getDate()}
                    </span>
                  );
                })}
              </div>
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <header className="content-head">
        <h1>Calendar</h1>
        {nav}
      </header>

      <div className="cal-grid">
        {WEEKDAYS.map((d) => (
          <div key={d} className="cal-weekday">
            {d}
          </div>
        ))}
        {monthDays(cursor.getFullYear(), cursor.getMonth()).map((date, i) => {
          if (!date) return <div key={`x${i}`} className="cal-cell empty-cell" />;
          const key = dayKey(date);
          const dayTasks = byDay.get(key) ?? [];
          return (
            <div
              key={key}
              className={`cal-cell ${key === todayKey ? "today" : ""} ${dropDay === key ? "drop" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDropDay(key);
              }}
              onDragLeave={() => setDropDay((d) => (d === key ? null : d))}
              onDrop={(e) => dropOn(date, e)}
            >
              <span className="cal-daynum">{date.getDate()}</span>
              {dayTasks.map((t) => (
                <button
                  key={t.id}
                  className={`cal-task ${t.status === "done" ? "done" : ""}`}
                  title={`${t.title} — drag to reschedule`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/task-id", t.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => onOpenTask(t.id)}
                >
                  <span className="mini-dot" style={{ background: PRIORITY_COLORS[t.priority] }} />
                  {t.dueHasTime && t.dueAt && (
                    <span className="cal-time">
                      {new Date(t.dueAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                  {t.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
