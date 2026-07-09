import { useEffect, useState } from "react";
import type { Cadence, Routine } from "@focus/shared";
import { createRoutine, deleteRoutine, getProfile, listRoutines, updateRoutine } from "./api";
import { PRIORITY_LABELS } from "./colors";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function cadenceLabel(r: Routine): string {
  const every = r.interval > 1 ? `every ${r.interval} ` : "every ";
  if (r.cadence === "daily") return `${every}${r.interval > 1 ? "days" : "day"}`;
  if (r.cadence === "weekly")
    return `${every}${r.interval > 1 ? "weeks" : "week"} on ${WEEKDAYS[r.weekday ?? 0]}`;
  return `${every}${r.interval > 1 ? "months" : "month"} on day ${r.dayOfMonth ?? 1}`;
}

/** Recurring task templates. Each spawns a real task on its cadence. */
export default function Routines() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [spheres, setSpheres] = useState<string[]>(["work", "personal"]);
  const [loaded, setLoaded] = useState(false);

  // new-routine form
  const [title, setTitle] = useState("");
  const [sphere, setSphere] = useState("personal");
  const [priority, setPriority] = useState<"P1" | "P2" | "P3">("P2");
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [interval, setInterval] = useState(1);
  const [weekday, setWeekday] = useState(0);
  const [dayOfMonth, setDayOfMonth] = useState(1);

  useEffect(() => {
    listRoutines()
      .then(setRoutines)
      .finally(() => setLoaded(true));
    void getProfile()
      .then((p) => {
        setSpheres(p.spheres);
        setSphere(p.spheres[0] ?? "personal");
      })
      .catch(() => {});
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const created = await createRoutine({
      title: title.trim(),
      sphere,
      priority,
      cadence,
      interval,
      weekday: cadence === "weekly" ? weekday : null,
      dayOfMonth: cadence === "monthly" ? dayOfMonth : null,
    });
    setRoutines((prev) => [created, ...prev]);
    setTitle("");
  };

  const toggle = async (r: Routine) => {
    setRoutines((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)));
    await updateRoutine(r.id, { active: !r.active }).catch(() => {});
  };

  const remove = async (id: string) => {
    setRoutines((prev) => prev.filter((r) => r.id !== id));
    await deleteRoutine(id);
  };

  return (
    <>
      <header className="content-head">
        <h1>Routines</h1>
      </header>
      <p className="memory-intro">
        Recurring tasks. Each routine drops a fresh task into your Roadmap on its schedule —
        rent, weekly reviews, standups, chores.
      </p>

      <form className="settings-card routine-form" onSubmit={add}>
        <input
          className="routine-title"
          placeholder="Routine… e.g. Weekly review"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="routine-controls">
          <select value={sphere} onChange={(e) => setSphere(e.target.value)}>
            {spheres.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value as "P1" | "P2" | "P3")}>
            {(["P1", "P2", "P3"] as const).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
          <select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <label className="routine-every">
            every
            <input
              type="number"
              min={1}
              max={52}
              value={interval}
              onChange={(e) => setInterval(Math.max(1, Number(e.target.value)))}
            />
          </label>
          {cadence === "weekly" && (
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          )}
          {cadence === "monthly" && (
            <label className="routine-every">
              day
              <input
                type="number"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Math.min(31, Math.max(1, Number(e.target.value))))}
              />
            </label>
          )}
          <button type="submit">Add routine</button>
        </div>
      </form>

      <div className="routine-list">
        {routines.map((r) => (
          <div className={`routine-row ${r.active ? "" : "paused"}`} key={r.id}>
            <button
              className={`toggle ${r.active ? "on" : ""}`}
              title={r.active ? "Active — click to pause" : "Paused — click to activate"}
              onClick={() => void toggle(r)}
            />
            <span className={`priority ${r.priority}`}>{PRIORITY_LABELS[r.priority]}</span>
            <span className="routine-name">{r.title}</span>
            <span className="mini-sphere">{r.sphere}</span>
            <span className="routine-cadence">{cadenceLabel(r)}</span>
            <span className="routine-next">
              next {new Date(r.nextRunAt).toLocaleDateString()}
            </span>
            <button className="link" title="Delete" onClick={() => void remove(r.id)}>
              ✕
            </button>
          </div>
        ))}
        {loaded && routines.length === 0 && (
          <p className="empty">No routines yet — add one above.</p>
        )}
      </div>
    </>
  );
}
