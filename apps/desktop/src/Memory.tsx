import { useEffect, useState } from "react";
import type { MemoryRecordInfo } from "@focus/shared";
import { deleteMemoryRecord, listMemory } from "./api";

const KIND_LABELS: Record<MemoryRecordInfo["kind"], string> = {
  entity: "People & things",
  preference: "Preferences",
  pattern: "Patterns",
  outcome: "Outcomes",
};

/** "What Focus knows about me" (PLAN.md §6) — every learned fact, deletable. */
export default function Memory() {
  const [records, setRecords] = useState<MemoryRecordInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    listMemory()
      .then(setRecords)
      .finally(() => setLoaded(true));
  }, []);

  const remove = async (id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    await deleteMemoryRecord(id);
  };

  const kinds = (Object.keys(KIND_LABELS) as MemoryRecordInfo["kind"][]).filter((k) =>
    records.some((r) => r.kind === k),
  );

  return (
    <>
      <header className="content-head">
        <h1>Memory</h1>
      </header>
      <p className="memory-intro">
        What Focus has learned from your activity. It sharpens classification, priorities and
        suggestion filtering. Delete anything — removed facts are never re-learned.
      </p>
      {kinds.map((kind) => (
        <section className="settings-card" key={kind}>
          <h2>{KIND_LABELS[kind]}</h2>
          {records
            .filter((r) => r.kind === kind)
            .map((r) => (
              <div className="settings-row" key={r.id}>
                <span className="memory-content">{r.content}</span>
                <span className="settings-value">
                  <button className="link" title="Forget this" onClick={() => void remove(r.id)}>
                    ✕
                  </button>
                </span>
              </div>
            ))}
        </section>
      ))}
      {loaded && records.length === 0 && (
        <p className="empty">
          Nothing learned yet. Focus distills your captures, edits and decisions into memory
          every night.
        </p>
      )}
    </>
  );
}
