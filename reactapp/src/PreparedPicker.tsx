// reactapp/src/PreparedPicker.tsx
// "Use a prepared input" (FIMSIM-FE71): lists the user's Preparing Input Data
// outputs of one kind for one area (BE20), marks the ones that do not cover
// it or cannot be used, and copies the chosen file into the area (BE21).
import { useEffect, useState } from 'react';
import {
  ApiError, listPrepared, pickPrepared, type PickedInput, type PreparedKind, type PreparedRow,
} from './api';
import { PICKED_HINT, orderRows, rowNote, rowState } from './prepared';
import './PreparedPicker.css';

interface Props {
  aoiId: number;
  kind: PreparedKind;
  /** the file already picked for this area, if any */
  picked: PickedInput | null;
  onPick: (picked: PickedInput) => void;
  onClear: () => void;
}

const TOOL_FOR: Record<PreparedKind, string> = {
  dem: 'DEM', manning: 'LULC & Manning', lulc: 'LULC & Manning', flow: 'Streamflow Data',
};

const finishedLabel = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

export default function PreparedPicker({ aoiId, kind, picked, onPick, onClear }: Props) {
  const [rows, setRows] = useState<PreparedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (picked) return;
    let live = true;
    listPrepared(aoiId, kind)
      .then((r) => { if (live) setRows(orderRows(r)); })
      .catch((e) => {
        if (!live) return;
        setRows([]);
        setError(e instanceof ApiError ? e.message : String(e));
      });
    return () => { live = false; };
  }, [aoiId, kind, picked, tick]);

  const load = () => {
    setRows(null);
    setError(null);
    setTick((t) => t + 1);
  };

  const use = async (r: PreparedRow) => {
    setBusy(`${r.steprun_id}/${r.file}`);
    setError(null);
    try {
      onPick(await pickPrepared(aoiId, { steprun_id: r.steprun_id, file: r.file, kind }));
    } catch (e) {
      // the run may be gone or re-run since the list was fetched
      if (e instanceof ApiError && e.status === 404) load();
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (picked) {
    return (
      <div className="pp-picked">
        <span>
          Prepared: <strong>{picked.name}</strong> from {picked.source.project}
          {' '}({picked.source.aoi})
        </span>
        <button type="button" className="pp-link" onClick={onClear}>choose another</button>
        <span className="pp-hint" role="note">{PICKED_HINT}</span>
      </div>
    );
  }

  return (
    <div className="pp">
      <div className="pp-head">
        <span className="pp-title">Your {TOOL_FOR[kind]} tool outputs</span>
        <button type="button" className="pp-link" onClick={load} disabled={rows === null}>
          refresh
        </button>
      </div>
      {error && <div className="pp-error" role="alert">{error}</div>}
      {rows === null && <p className="pp-empty">Loading…</p>}
      {rows?.length === 0 && !error && (
        <p className="pp-empty">
          No {TOOL_FOR[kind]} tool runs yet. Run the tool in a Preparing Input Data
          project on an area that contains this one, then come back.
        </p>
      )}
      {rows && rows.length > 0 && (
        <ul className="pp-list">
          {rows.map((r) => {
            const state = rowState(r);
            const id = `${r.steprun_id}/${r.file}`;
            return (
              <li key={id} className={`pp-row pp-${state}`}>
                <div className="pp-main">
                  <span className="pp-file">{r.file}</span>
                  <span className="pp-meta">
                    {r.detail} · {r.project} / {r.aoi} · {finishedLabel(r.finished)}
                  </span>
                  {state !== 'ready' && <span className="pp-note">{rowNote(r)}</span>}
                </div>
                {state === 'ready' ? (
                  <button type="button" className="pp-use" disabled={busy !== null}
                          onClick={() => void use(r)}>
                    {busy === id ? 'Copying…' : 'Use this'}
                  </button>
                ) : (
                  <span className="pp-badge">
                    {state === 'uncovered' ? 'does not cover' : 'not usable'}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
