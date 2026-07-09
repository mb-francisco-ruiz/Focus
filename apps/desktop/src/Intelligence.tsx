import { useEffect, useRef, useState } from "react";
import type { MemoryRecordInfo, SpherePreferences } from "@focus/shared";
import {
  addMemoryRecord,
  deleteMemoryRecord,
  editMemoryRecord,
  getProfile,
  listMemory,
  savePreferences,
} from "./api";

const KIND_LABELS: Record<MemoryRecordInfo["kind"], string> = {
  entity: "Learned entities",
  preference: "Preferences",
  pattern: "Memories",
  outcome: "Outcomes",
};

/** Editable memory line: double-click to edit, Enter saves, Esc cancels. */
function MemoryLine({
  record,
  onSave,
  onDelete,
}: {
  record: MemoryRecordInfo;
  onSave: (content: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(record.content);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);
  const commit = () => {
    setEditing(false);
    const c = draft.trim();
    if (c && c !== record.content) onSave(c);
    else setDraft(record.content);
  };
  return (
    <div className="settings-row">
      {editing ? (
        <input
          ref={ref}
          className="memory-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(record.content);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span
          className="memory-content"
          title="Double-click to edit"
          onDoubleClick={() => {
            setDraft(record.content);
            setEditing(true);
          }}
        >
          {record.content}
        </span>
      )}
      <span className="settings-value">
        <button className="link" title="Edit" onClick={() => setEditing(true)}>
          ✎
        </button>
        <button className="link" title="Forget this" onClick={onDelete}>
          ✕
        </button>
      </span>
    </div>
  );
}

function BehaviourCard({
  sphere,
  value,
  onChange,
  onSave,
  dirty,
}: {
  sphere: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  dirty: boolean;
}) {
  return (
    <div className="behaviour-card">
      <h3 className="col-label">{sphere}</h3>
      <textarea
        placeholder={`How should Focus handle ${sphere} tasks? e.g. priorities, people, rules of thumb.`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
      />
      <button className="chip save" disabled={!dirty} onClick={onSave}>
        {dirty ? "Save" : "Saved"}
      </button>
    </div>
  );
}

/** Intelligence: behaviour instructions, learned entities, distilled memory. */
export default function Intelligence() {
  const [records, setRecords] = useState<MemoryRecordInfo[]>([]);
  const [spheres, setSpheres] = useState<string[]>(["work", "personal"]);
  const [prefs, setPrefs] = useState<SpherePreferences>({});
  const [savedPrefs, setSavedPrefs] = useState<SpherePreferences>({});
  const [entityDraft, setEntityDraft] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void getProfile()
      .then((p) => setSpheres(p.spheres.length ? p.spheres : ["work", "personal"]))
      .catch(() => {});
    listMemory()
      .then(({ records, preferences }) => {
        setRecords(records);
        setPrefs(preferences);
        setSavedPrefs(preferences);
      })
      .finally(() => setLoaded(true));
  }, []);

  const save = async () => {
    await savePreferences(prefs);
    setSavedPrefs(prefs);
  };

  const remove = async (id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    await deleteMemoryRecord(id);
  };

  const edit = async (id: string, content: string) => {
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, content } : r)));
    await editMemoryRecord(id, content).catch(() => {});
  };

  const addEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = entityDraft.trim();
    if (!content) return;
    setEntityDraft("");
    const record = await addMemoryRecord("entity", content);
    setRecords((prev) => [record, ...prev]);
  };

  const entities = records.filter((r) => r.kind === "entity");
  const otherKinds = (["preference", "pattern", "outcome"] as const).filter((k) =>
    records.some((r) => r.kind === k),
  );

  return (
    <>
      <header className="content-head">
        <h1>Intelligence</h1>
      </header>
      <p className="memory-intro">
        How Focus thinks for you: your standing instructions, plus everything it has learned
        from your activity. All of it feeds task classification, priorities and suggestion
        filtering. Delete anything — removed facts are never re-learned.
      </p>

      <section className="settings-card">
        <h2>Behaviour</h2>
        <div className="behaviour-grid">
          {spheres.map((s) => (
            <BehaviourCard
              key={s}
              sphere={s}
              value={prefs[s] ?? ""}
              dirty={(prefs[s] ?? "") !== (savedPrefs[s] ?? "")}
              onChange={(v) => setPrefs((p) => ({ ...p, [s]: v }))}
              onSave={() => void save()}
            />
          ))}
        </div>
      </section>

      <section className="settings-card">
        <h2>{KIND_LABELS.entity}</h2>
        <div className="entity-grid">
          {entities.map((r) => (
            <div className="entity-card" key={r.id}>
              <p>{r.content}</p>
              <button className="link" title="Forget" onClick={() => void remove(r.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
        <form className="entity-add" onSubmit={addEntity}>
          <input
            placeholder="Teach Focus an entity… e.g. 'Coni = my daughter; school topics are personal'"
            value={entityDraft}
            onChange={(e) => setEntityDraft(e.target.value)}
          />
        </form>
      </section>

      {otherKinds.map((kind) => (
        <section className="settings-card" key={kind}>
          <h2>{KIND_LABELS[kind]}</h2>
          {records
            .filter((r) => r.kind === kind)
            .map((r) => (
              <MemoryLine
                key={r.id}
                record={r}
                onSave={(content) => void edit(r.id, content)}
                onDelete={() => void remove(r.id)}
              />
            ))}
        </section>
      ))}

      {loaded && records.length === 0 && (
        <p className="empty">
          Nothing learned yet. Focus distills your captures, edits and decisions into memory
          every night — or teach it directly above.
        </p>
      )}
    </>
  );
}
