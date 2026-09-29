import { useEffect, useState } from "react";
import { fmtTime } from "../lib/audio";
import { TAGS } from "../lib/store";

export default function Composer({ open, time, onCancel, onSave }) {
  const [tag, setTag] = useState("drop");
  const [text, setText] = useState("");

  useEffect(() => {
    if (open) {
      setTag("drop");
      setText("");
    }
  }, [open, time]);

  if (!open) return null;

  return (
    <div className="composer">
      <div className="stamp">Stamped at {fmtTime(time)}</div>
      <div className="tag-row">
        {TAGS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="tag-chip"
            aria-pressed={tag === t.id}
            onClick={() => setTag(t.id)}
          >
            <span className="dot" style={{ background: `var(${t.varName})` }} />
            {t.label}
          </button>
        ))}
      </div>
      <textarea
        placeholder="What did you catch this time?"
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row-end">
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!text.trim()} onClick={() => onSave(tag, text.trim())}>
          Save note
        </button>
      </div>
    </div>
  );
}
