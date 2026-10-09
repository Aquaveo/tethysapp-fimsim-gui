// reactapp/src/NewSimulation.tsx
// The guided LISFLOOD-FP wizard. The wizard is keyed to a real project:
// /new shows the Project step (create/open); /new/<id> loads that project's
// AOIs from the server and unlocks the rest of the steps. Refresh/resume
// works because everything reloads from the API (FIMSIM-FE2 server cutover).
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getProject, getProjectStatus, getStepSchemas,
  type ServerAoi, type ServerProject, type StepSchema,
} from './api';
import AoiStep from './AoiStep';
import ConfirmDialog from './ConfirmDialog';
import { useActiveModel } from './activeModel';
import ProjectStep from './ProjectStep';
import ResultsStep from './ResultsStep';
import StepPanel from './StepPanel';
import {
  MODELS, headerModel, modelFromSlug, needsRunConfirm, resolveActiveStep, stepDone, wizardPath,
  type ModelId, type StepId,
} from './steps';
import './NewSimulation.css';

const NON_JOB_STEPS = new Set(['project', 'aoi', 'results']);

export default function NewSimulation() {
  const navigate = useNavigate();
  const params = useParams<{ projectId?: string; model?: string }>();
  const projectId = params.projectId ? Number(params.projectId) : null;
  const [project, setProject] = useState<ServerProject | null>(null);
  // FE48: the model is a property of the PROJECT. The URL slug
  // (/new/<id>/triton) only bridges the gap until the project has loaded —
  // then the project wins and the URL is corrected to match (see below).
  const model: ModelId = project && project.id === projectId
    ? modelFromSlug(project.model) : modelFromSlug(params.model);
  const STEPS = MODELS[model].steps;
  const JOB_STEPS = new Set(
    STEPS.map((s) => s.id as string).filter((id) => !NON_JOB_STEPS.has(id)));
  const stepOrder = STEPS
    .filter((s) => !NON_JOB_STEPS.has(s.id))
    .map((s) => ({ id: s.id as string, label: s.label }));

  const [step, setStep] = useState<StepId>(projectId ? 'aoi' : 'project');
  const [aois, setAoisState] = useState<ServerAoi[]>([]);
  const [schemas, setSchemas] = useState<Record<string, StepSchema> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // FE56: where the Run step's button renders (footer, beside Next), and the
  // step a user asked to move to while no run has succeeded (awaiting confirm)
  const [submitSlot, setSubmitSlot] = useState<HTMLElement | null>(null);
  const [pendingStep, setPendingStep] = useState<StepId | null>(null);

  useEffect(() => {
    getStepSchemas().then(setSchemas).catch(() => setSchemas({}));
  }, []);

  // FE58: tell the header which model this project is (cleared on leave)
  const { setModel: publishModel } = useActiveModel();
  useEffect(() => {
    publishModel(headerModel(projectId, model));
    return () => publishModel(null);
  }, [projectId, model, publishModel]);

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
  }, [projectId]);

  // Stale or hand-typed links (/new/<id> for a TRITON project) land on the
  // project's real model; rewrite the URL so bookmarks/back-button agree.
  useEffect(() => {
    if (!project || project.id !== projectId) return;
    const wanted = wizardPath(project);
    if (window.location.pathname.replace(/\/$/, '').endsWith(wanted)) return;
    navigate(wanted, { replace: true });
  }, [project, projectId, navigate]);

  // A model switch can leave `step` pointing at a step the new model lacks
  // (LISFLOOD "run" → TRITON); render a shared step until the reset effect
  // syncs `step`, so we never index past STEPS and crash on def.title.
  const activeStep = resolveActiveStep(STEPS, step, !!projectId);
  const idx = STEPS.findIndex((s) => s.id === activeStep);
  const def = STEPS[idx];

  const goTo = (id: StepId) => {
    if (id === 'project') {
      navigate('/new');
      return;
    }
    if (!projectId) return; // later steps need a project first
    setStep(id);
  };
  // every navigation goes through here: leaving Run forward with no
  // successful run asks first (FE56)
  const tryGoTo = (id: StepId) => {
    if (needsRunConfirm(STEPS, activeStep, id, aois)) setPendingStep(id);
    else goTo(id);
  };
  const stayAndRun = useCallback(() => setPendingStep(null), []);

  return (
    <div className="ns-wrap">
      <div className="ns-rail">
      {/* The river stepper: dots are reaches; the line fills as flow moves downstream. */}
      <ol className="ns-stepper" aria-label="Simulation steps">
        {STEPS.map((s, i) => {
          // ✓ means the step really completed (FE55), not merely "behind you"
          const state = i === idx ? 'active'
            : stepDone(s.id, aois, !!projectId) ? 'done' : 'todo';
          return (
            <li key={s.id} className="ns-step-wrap">
              {i > 0 && <span className={'ns-line' + (i <= idx ? ' done' : '')} aria-hidden="true" />}
              <button
                type="button"
                className={`ns-step ${state}`}
                aria-current={state === 'active' ? 'step' : undefined}
                onClick={() => tryGoTo(s.id)}
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
          <span className={'ns-model-badge' + (MODELS[model].runsOnPortal ? '' : ' is-deck')}>
            {MODELS[model].label}
          </span>
          Step {idx + 1} of {STEPS.length}
          {project && <span className="ns-project-tag">{project.name}</span>}
          {def.produces && <span className="ns-produces">→ {def.produces}</span>}
        </p>
        <h2 id="ns-title" className="ns-title">
          {def.title}
        </h2>
        <p className="ns-blurb">{def.blurb}</p>

        {loadError && <div className="as-error" role="alert">{loadError}</div>}

        {activeStep === 'project' ? (
          <ProjectStep />
        ) : activeStep === 'aoi' && projectId ? (
          <AoiStep projectId={projectId} aois={aois} setAois={setAois} />
        ) : activeStep === 'results' && projectId ? (
          <ResultsStep
            aois={aois}
            hasRunStep={JOB_STEPS.has('run')}
            modelStepKeys={[...JOB_STEPS]}
            onGoToRun={JOB_STEPS.has('run') ? () => goTo('run') : undefined}
          />
        ) : JOB_STEPS.has(activeStep) && projectId ? (
          <StepPanel
            key={activeStep}  /* fresh form state per step — config must never leak across steps */
            projectId={projectId}
            stepKey={activeStep}
            aois={aois}
            stepOrder={stepOrder}
            schema={schemas?.[step] ?? null}
            onSubmitted={() =>
              getProjectStatus(projectId).then((r) => setAoisState(r.aois)).catch(() => undefined)}
            submitSlot={activeStep === 'run' ? submitSlot : null}
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
          <div className="ns-nav-right">
            {/* FE56: the Run step's "Run simulation" button portals in here */}
            <span className="ns-nav-slot" ref={setSubmitSlot} />
            {idx < STEPS.length - 1 && (
              <button
                type="button"
                className="button-primary"
                disabled={step === 'project' && !projectId}
                onClick={() => tryGoTo(STEPS[idx + 1].id)}
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </section>

      {pendingStep && (
        <ConfirmDialog
          title="Proceed without running the model?"
          confirmLabel="Proceed without running"
          cancelLabel="Stay and run"
          onConfirm={() => { const to = pendingStep; setPendingStep(null); goTo(to); }}
          onCancel={stayAndRun}
        >
          <p>
            No simulation has run successfully for this project yet. You are choosing
            to continue without running the model — the Results step will have no
            flood map, only the input files you built.
          </p>
          <p>Are you okay with that?</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
