// reactapp/src/ManningTable.tsx
// The desktop's signature feature on the web: the editable per-class
// Manning's n table. Reference values (label/min/max/default) come from the
// server (fimcore's own tables) so UI and rasterization can't drift; the
// user's edits become the `manning_mapping` passed to the Roughness step.
import { useEffect, useMemo, useState } from 'react';
import { HARD_N, clampHard, rowWarning, warningCount, type ClassRange } from './manningRules';
import './ManningTable.css';

type ClassRow = ClassRange;

type Tables = Record<string, Record<string, ClassRow>> & { fallback_default?: number };

export type ManningMapping = Record<string, number>;

interface Props {
  source: string;                    // 'esri' | 'nlcd'
  value: ManningMapping | undefined; // config['manning_mapping']
  onChange: (mapping: ManningMapping) => void;
}

let tablesCache: Tables | null = null;

export default function ManningTable({ source, value, onChange }: Props) {
  const [tables, setTables] = useState<Tables | null>(tablesCache);

  useEffect(() => {
    if (tablesCache) return;
    fetch('/apps/fimsim-gui/api/manning-table/')
      .then((r) => r.json())
      .then((t) => { tablesCache = t; setTables(t); })
      .catch(() => undefined);
  }, []);

  const rows = useMemo(
    () => Object.entries(tables?.[source] ?? {})
      .sort(([a], [b]) => Number(a) - Number(b)),
    [tables, source]);

  const fallback = Number(tables?.fallback_default ?? 0.045);

  const current = (code: string, row: ClassRow) =>
    value?.[code] ?? row.default ?? fallback;

  // BE15: an edit is pinned to the HARD band only; the class's own literature
  // range is guidance (FE52 warns, never blocks)
  const setValue = (code: string, raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange({ default: fallback, ...(value ?? {}), [code]: clampHard(n) });
  };
  const warnings = warningCount(value, tables?.[source] ?? {});

  const reset = () => onChange({ default: fallback });
  const edited = value && Object.keys(value).some(
    (k) => k !== 'default' && value[k] !== tables?.[source]?.[k]?.default);

  if (!tables) return <p className="mt-muted">Loading Manning table…</p>;

  return (
    <div className="mt-wrap">
      <div className="mt-head">
        <span className="mt-title">Manning&apos;s n by land-cover class</span>
        <button type="button" className="mt-reset" onClick={reset}
                disabled={!edited}>
          Reset to defaults
        </button>
      </div>
      <div className="mt-scroll">
        <table className="mt-table">
          <thead>
            <tr>
              <th>Code</th><th>Land cover</th><th>Min</th>
              <th>Manning&apos;s n</th><th>Max</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([code, row]) => {
              const v = current(code, row);
              const changed = v !== row.default;
              const warn = changed ? rowWarning(v, row) : null;
              return (
                <tr key={code}
                    className={(changed ? 'is-edited' : '') + (warn ? ' is-warn' : '')}>
                  <td className="mt-code">{code}</td>
                  <td>{row.label}</td>
                  <td className="mt-range">{row.min?.toFixed(3) ?? '—'}</td>
                  <td className="mt-cell">
                    <input
                      type="number"
                      value={v}
                      min={HARD_N.min} max={HARD_N.max} step={0.001}
                      onChange={(e) => setValue(code, e.target.value)}
                      aria-label={`Manning's n for ${row.label}`}
                      aria-invalid={warn ? true : undefined}
                      title={warn ?? undefined}
                    />
                    {warn && <span className="mt-warn-icon" role="img" aria-label="warning">⚠️</span>}
                  </td>
                  <td className="mt-range">{row.max?.toFixed(3) ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {warnings > 0 && (
        <p className="mt-warn-note" role="status">
          ⚠️ {warnings} class{warnings === 1 ? '' : 'es'} outside the recommended
          literature range — this will affect your results. You can still run.
        </p>
      )}
      <p className="mt-muted">
        Min / Max are the literature range per class (guidance — the default is
        the recommended value). Any n between {HARD_N.min} and {HARD_N.max} is
        accepted; unlisted classes use {fallback.toFixed(3)}. Edits apply when you
        run this step.
      </p>
    </div>
  );
}
