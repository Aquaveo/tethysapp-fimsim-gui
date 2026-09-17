// reactapp/src/NewSimulation.tsx
// The guided LISFLOOD-FP wizard. The wizard is keyed to a real project:
// /new shows the Project step (create/open); /new/<id> loads that project's
// AOIs from the server and unlocks the rest of the steps. Refresh/resume
// works because everything reloads from the API (FIMSIM-FE2 server cutover).
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getProject, getProjectStatus, getStepSchemas,
  type ServerAoi, type ServerProject, type StepSchema,
} from './api';
import AoiStep from './AoiStep';
import ProjectStep from './ProjectStep';
import ResultsStep from './ResultsStep';
import StepPanel from './StepPanel';
import { DEFAULT_MODEL, MODELS, type ModelId, type StepId } from './steps';
import './NewSimulation.css';

const NON_JOB_STEPS = new Set(['project', 'aoi', 'results']);

export default function NewSimulation() {
  const navigate = useNavigate();
  const params = useParams<{ projectId?: string; model?: string }>();
  const projectId = params.projectId ? Number(params.projectId) : null;
  // model comes from the URL slug (/new/<id>/triton) so links say which
  // model they drive; unknown slugs fall back to the default
  const model: ModelId = params.model && params.model in MODELS
    ? (params.model as ModelId) : DEFAULT_MODEL;
  const STEPS = MODELS[model].steps;
  const JOB_STEPS = new Set(
    STEPS.map((s) => s.id as string).filter((id) => !NON_JOB_STEPS.has(id)));
  const stepOrder = STEPS
    .filter((s) => !NON_JOB_STEPS.has(s.id))
    .map((s) => ({ id: s.id as string, label: s.label }));

  const [step, setStep] = useState<StepId>(projectId ? 'aoi' : 'project');
  const [project, setProject] = useState<ServerProject | null>(null);
  const [aois, setAoisState] = useState<ServerAoi[]>([]);
  const [schemas, setSchemas] = useState<Record<string, StepSchema> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getStepSchemas().then(setSchemas).catch(() => setSchemas({}));
  }, []);

  // Steady project-status poll while on a job step: keeps every AOI's
  // step summaries (and therefore panels' run tracking) fresh.
  useEffect(() => {
    if (!projectId || !JOB_STEPS.has(step)) return;
    const t = setInterval(() => {
      getProjectStatus(projectId)
        .then((r) => setAoisState(r.aois))
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
    // JOB_STEPS derives from `model`, so model stands in for it here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, step, model]);

  const setAois = (updater: (prev: ServerAoi[]) => ServerAoi[]) =>
    setAoisState(updater);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate full wizard reset when the URL's projectId changes; restructuring (key-remount) would change focus/scroll behavior.
    setProject(null);
    setAoisState([]);
    setLoadError(null);
    setStep(projectId ? 'aoi' : 'project');
    if (projectId) {
      getProject(projectId)
        .then((p) => {
          setProject(p);
          setAoisState(p.aois ?? []);
        })
        .catch((e) => setLoadError(String(e.message)));
    }
  }, [projectId, model]);

  const idx = STEPS.findIndex((s) => s.id === step);
  const def = STEPS[idx];

  const goTo = (id: StepId) => {
    if (id === 'project') {
      navigate('/new');
      return;
    }
    if (!projectId) return; // later steps need a project first
    setStep(id);
  };

  return (
    <div className="ns-wrap">
      <div className="ns-rail">
        {/* Model switch: slugged URLs so users always know which model they drive */}
        <div className="ns-models" role="group" aria-label="Model">
          {(Object.keys(MODELS) as ModelId[]).map((m) => (
            <button
              key={m}
              type="button"
              className={'ns-model' + (m === model ? ' is-active' : '')}
              onClick={() => navigate(projectId
                ? `/new/${projectId}${m === DEFAULT_MODEL ? '' : `/${m}`}`
                : '/new')}
            >
              {MODELS[m].label}
              {!MODELS[m].runsOnPortal && <span className="ns-model-tag">deck only</span>}
            </button>
          ))}
        </div>
      {/* The river stepper: dots are reaches; the line fills as flow moves downstream. */}
      <ol className="ns-stepper" aria-label="Simulation steps">
        {STEPS.map((s, i) => {
          const state = i < idx ? 'done' : i === idx ? 'active' : 'todo';
          return (
            <li key={s.id} className="ns-step-wrap">
              {i > 0 && <span className={'ns-line' + (i <= idx ? ' done' : '')} aria-hidden="true" />}
              <button
                type="button"
                className={`ns-step ${state}`}
                aria-current={state === 'active' ? 'step' : undefined}
                onClick={() => goTo(s.id)}
              >
                <span className="ns-dot" aria-hidden="true">
                  {state === 'done' ? '✓' : i + 1}
                </span>
                <span className="ns-step-label">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      </div>

      <section className="ns-card" aria-labelledby="ns-title">
        <p className="ns-eyebrow">
          Step {idx + 1} of {STEPS.length}
          {project && <span className="ns-project-tag">{project.name}</span>}
          {def.produces && <span className="ns-produces">→ {def.produces}</span>}
        </p>
        <h2 id="ns-title" className="ns-title">
          {def.title}
        </h2>
        <p className="ns-blurb">{def.blurb}</p>

        {loadError && <div className="as-error" role="alert">{loadError}</div>}

        {step === 'project' ? (
          <ProjectStep />
        ) : step === 'aoi' && projectId ? (
          <AoiStep projectId={projectId} aois={aois} setAois={setAois} />
        ) : step === 'results' && projectId ? (
          <ResultsStep aois={aois} hasRunStep={JOB_STEPS.has('run')} />
        ) : JOB_STEPS.has(step) && projectId ? (
          <StepPanel
            key={step}  /* fresh form state per step — config must never leak across steps */
            projectId={projectId}
            stepKey={step}
            aois={aois}
            stepOrder={stepOrder}
            schema={schemas?.[step] ?? null}
            onSubmitted={() =>
              getProjectStatus(projectId).then((r) => setAoisState(r.aois)).catch(() => undefined)}
          />
        ) : (
          <div className="ns-placeholder">Coming soon — this panel is being built.</div>
        )}

        <div className="ns-nav">
          {idx > 0 ? (
            <button
              type="button"
              className="button-secondary"
              onClick={() => goTo(STEPS[idx - 1].id)}
            >
              ← Back
            </button>
          ) : <span aria-hidden="true" /> /* keeps Next right-aligned */}
          {idx < STEPS.length - 1 && (
            <button
              type="button"
              className="button-primary"
              disabled={step === 'project' && !projectId}
              onClick={() => goTo(STEPS[idx + 1].id)}
            >
              Next →
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
