// reactapp/src/StepPanel.tsx
// One panel for every wizard step (FE4/FE5/FE6/FE7 in a single component):
// config form from stepFields + server defaults, per-AOI submit fan-out,
// live progress polling, failure detail with re-run, outputs with presigned
// downloads. Bespoke upgrades (editable Manning table, hydrograph chart)
// layer on top later — this gets the whole workflow demoable.
import { useEffect, useMemo, useState } from 'react';
import {
  ApiError, cancelStepRun, getStepRun, getStepRunOutputs, submitStep,
  type OutputEntry, type ServerAoi, type ServerStepRun, type StepSchema,
} from './api';
import HydrographChart from './HydrographChart';
import ManningTable, { type ManningMapping } from './ManningTable';
import { STEP_FIELDS, type FieldSpec } from './stepFields';
import './StepPanel.css';

const POLL_MS = 4000;
const ACTIVE = ['pending', 'queued', 'running', 'uploading'];

function ProgressBar({ run }: { run: ServerStepRun }) {
  const last = [...(run.progress ?? [])].reverse()
    .find((e) => e.total > 0 && e.status !== 'failed');
  const pct = last ? Math.round(100 * last.current / last.total) : null;
  return (
    <div className="sp-progress">
      <div className="sp-progress-track">
        <div
          className={'sp-progress-fill' + (pct === null ? ' indeterminate' : '')}
          style={pct !== null ? { width: `${pct}%` } : undefined}
        />
      </div>
      <span className="sp-progress-label">
        {run.status}{pct !== null ? ` · ${pct}%` : ''}
        {last ? ` — ${last.message.slice(0, 60)}` : ''}
      </span>
    </div>
  );
}

function Outputs({ runId }: { runId: number }) {
  const [outputs, setOutputs] = useState<OutputEntry[] | null>(null);
  useEffect(() => {
    getStepRunOutputs(runId).then((r) => setOutputs(r.outputs)).catch(() => setOutputs([]));
  }, [runId]);
  if (!outputs) return <span className="sp-muted">loading outputs…</span>;
  return (
    <ul className="sp-outputs">
      {outputs.map((o) => (
        <li key={o.key}>
          {o.url ? <a href={o.url} download={o.name}>{o.name}</a> : o.name}
          <span className="sp-muted"> ({(o.bytes / 1024).toFixed(0)} kB)</span>
        </li>
      ))}
    </ul>
  );
}

interface Props {
  projectId: number;
  stepKey: string;
  aois: ServerAoi[];
  schema: StepSchema | null;
  /** notify the wizard something changed (statuses refresh) */
  onSubmitted: () => void;
}

export default function StepPanel({ projectId, stepKey, aois, schema, onSubmitted }: Props) {
  const fields: FieldSpec[] = STEP_FIELDS[stepKey] ?? [];
  const defaults = useMemo(
    () => ({ ...(schema?.defaults ?? {}) }), [schema]);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [runs, setRuns] = useState<Record<number, ServerStepRun>>({});
  const [submitNotes, setSubmitNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = (key: string) => (key in config ? config[key] : defaults[key]) ?? '';
  const visible = (f: FieldSpec) =>
    !f.showIf || value(f.showIf.key) === f.showIf.value;

  // seed run tracking from the AOIs' current step summaries
  useEffect(() => {
    for (const a of aois) {
      const summary = a.steps?.[stepKey];
      if (summary && !(summary.id in runs)) {
        getStepRun(summary.id)
          .then((r) => setRuns((prev) => ({ ...prev, [r.id]: r })))
          .catch(() => undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aois, stepKey]);

  // poll active runs
  useEffect(() => {
    const active = Object.values(runs).filter((r) => ACTIVE.includes(r.status));
    if (!active.length) return;
    const t = setInterval(() => {
      active.forEach((r) =>
        getStepRun(r.id)
          .then((fresh) => setRuns((prev) => ({ ...prev, [fresh.id]: fresh })))
          .catch(() => undefined));
    }, POLL_MS);
    return () => clearInterval(t);
  }, [runs]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setSubmitNotes({});
    try {
      // Only this step's own keys may travel: leaked keys from another
      // panel crash fimcore's keyword-only step functions.
      const allowed = new Set([
        ...Object.keys(defaults), ...fields.map((f) => f.key), 'manning_mapping',
      ]);
      const merged: Record<string, unknown> = Object.fromEntries(
        Object.entries({ ...defaults, ...config })
          .filter(([k, v]) => allowed.has(k) && v !== null && v !== ''));
      for (const f of fields) {
        if (f.required && !merged[f.key]) {
          throw new Error(`"${f.label}" is required.`);
        }
      }
      const { results } = await submitStep(projectId, stepKey, merged);
      const notes: Record<number, string> = {};
      for (const r of results) {
        if (!r.submitted) notes[r.aoi_id] = r.reason ?? 'not submitted';
        else if (r.steprun_id) {
          getStepRun(r.steprun_id)
            .then((run) => setRuns((prev) => ({ ...prev, [run.id]: run })))
            .catch(() => undefined);
        }
      }
      setSubmitNotes(notes);
      onSubmitted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const runFor = (aoi: ServerAoi): ServerStepRun | null => {
    const id = aoi.steps?.[stepKey]?.id;
    return (id && runs[id]) || null;
  };
  const anyActive = aois.some((a) => {
    const r = runFor(a);
    return r && ACTIVE.includes(r.status);
  });

  return (
    <div className="sp-wrap">
      <form
        className="sp-form"
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
      >
        {fields.filter(visible).map((f) => (
          <label key={f.key} className="sp-field">
            <span className="sp-field-label">{f.label}</span>
            {f.widget === 'select' ? (
              <select
                value={String(value(f.key))}
                onChange={(e) => {
                  const opt = f.options?.find((o) => String(o.value) === e.target.value);
                  setConfig({ ...config, [f.key]: opt?.value ?? e.target.value });
                }}
              >
                {f.options?.map((o) => (
                  <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
                ))}
              </select>
            ) : f.widget === 'datetime' ? (
              <input
                type="datetime-local"
                value={String(value(f.key))}
                onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
              />
            ) : (
              <input
                type={f.widget === 'number' ? 'number' : 'text'}
                step="any"
                value={String(value(f.key))}
                onChange={(e) => setConfig({
                  ...config,
                  [f.key]: f.widget === 'number'
                    ? (e.target.value === '' ? null : Number(e.target.value))
                    : e.target.value,
                })}
              />
            )}
            {f.help && <span className="sp-field-help">{f.help}</span>}
          </label>
        ))}
        {stepKey === 'manning' && value('fric_mode') === 'varying' && (
          <div className="sp-submit-row">
            <ManningTable
              source={String(value('lulc_download_source') || 'esri')}
              value={config.manning_mapping as ManningMapping | undefined}
              onChange={(m) => setConfig({ ...config, manning_mapping: m })}
            />
          </div>
        )}
        <div className="sp-submit-row">
          <button type="submit" className="button-primary"
                  disabled={busy || anyActive || aois.length === 0}>
            {anyActive ? 'Running…'
              : stepKey === 'run' ? `Run simulation for ${aois.length} area(s)`
              : `Run this step for ${aois.length} area(s)`}
          </button>
        </div>
      </form>

      {error && <div className="sp-error" role="alert">{error}</div>}

      <ul className="sp-aoi-list">
        {aois.map((a) => {
          const run = runFor(a);
          const note = submitNotes[a.id];
          return (
            <li key={a.id} className="sp-aoi">
              <div className="sp-aoi-head">
                <span className="sp-aoi-name">{a.name}</span>
                {run && ACTIVE.includes(run.status) && (
                  <button type="button" className="sp-cancel"
                          onClick={() => void cancelStepRun(run.id).then(
                            (r) => setRuns((prev) => ({ ...prev, [r.id]: r })))}>
                    Cancel
                  </button>
                )}
              </div>
              {note && <div className="sp-note">{note}</div>}
              {run ? (
                <>
                  {ACTIVE.includes(run.status) && <ProgressBar run={run} />}
                  {run.status === 'succeeded' && stepKey === 'bdy' && (
                    <HydrographChart run={run} />
                  )}
                  {run.status === 'succeeded' && <Outputs runId={run.id} />}
                  {run.status === 'failed' && (
                    <details className="sp-fail">
                      <summary>failed — details</summary>
                      <pre>{run.error ?? 'no error recorded'}</pre>
                    </details>
                  )}
                  {run.status === 'cancelled' && <span className="sp-muted">cancelled</span>}
                </>
              ) : !note && <span className="sp-muted">not run yet</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
