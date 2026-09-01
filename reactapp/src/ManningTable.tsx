// reactapp/src/ManningTable.tsx
// The desktop's signature feature on the web: the editable per-class
// Manning's n table. Reference values (label/min/max/default) come from the
// server (fimcore's own tables) so UI and rasterization can't drift; the
// user's edits become the `manning_mapping` passed to the Roughness step.
import { useEffect, useMemo, useState } from 'react';
import './ManningTable.css';

interface ClassRow {
  label: string;
  min: number;
  max: number;
  default: number;
}

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
    value?.[code] ?? row.default;

  const setValue = (code: string, row: ClassRow, raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(row.max, Math.max(row.min, n));
    onChange({ default: fallback, ...(value ?? {}), [code]: clamped });
  };

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
              return (
                <tr key={code} className={changed ? 'is-edited' : ''}>
                  <td className="mt-code">{code}</td>
                  <td>{row.label}</td>
                  <td className="mt-range">{row.min.toFixed(3)}</td>
                  <td>
                    <input
                      type="number"
                      value={v}
                      min={row.min} max={row.max} step={0.001}
                      onChange={(e) => setValue(code, row, e.target.value)}
                      aria-label={`Manning's n for ${row.label}`}
                    />
                  </td>
                  <td className="mt-range">{row.max.toFixed(3)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-muted">
        Values are clamped to the literature range per class; unlisted classes
        use {fallback.toFixed(3)}. Edits apply when you run this step.
      </p>
    </div>
  );
}
