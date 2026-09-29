import { fmtTime } from "../lib/audio";
import { tagMeta } from "../lib/store";

export default function Ledger({ anns, onSeek, onDelete, badges }) {
  if (!anns.length) {
    return <div className="empty-ledger">No notes on this listen yet. Play the track and stamp what you catch.</div>;
  }
  return (
    <div className="ledger">
      {anns.map((a) => {
        const tm = tagMeta(a.tag);
        const badge = badges ? badges[a.id] : null;
        return (
          <div className="entry" key={a.id}>
            <button className="t" onClick={() => onSeek(a.t)}>
              {fmtTime(a.t)}
            </button>
            <div className="body">
              <div className="tagline">
                <span className="dot" style={{ background: `var(${tm.varName})` }} />
                <span>{tm.label}</span>
                {badge ? <span className={"badge " + badge.type}>{badge.label}</span> : null}
              </div>
              <div className="note">{a.text}</div>
            </div>
            {onDelete ? (
              <button className="del" onClick={() => onDelete(a.id)} aria-label="Delete note">
                remove
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
