// reactapp/src/NewSimulation.tsx
// The guided LISFLOOD-FP wizard in the detail pane (family pattern: FIMeval's
// NewEvaluation). A horizontal stepper — the river, filling downstream as steps
// complete — over a card that holds the active step's panel. Panels are
// placeholders until FIMSIM-FE2+.
import { useState } from 'react';
import { STEPS, type StepId } from './steps';
import './NewSimulation.css';

export default function NewSimulation() {
  const [step, setStep] = useState<StepId>('project');

  const idx = STEPS.findIndex((s) => s.id === step);
  const def = STEPS[idx];

  return (
    <div className="ns-wrap">
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
                onClick={() => setStep(s.id)}
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

      <section className="ns-card" aria-labelledby="ns-title">
        <p className="ns-eyebrow">
          Step {idx + 1} of {STEPS.length}
          {def.produces && <span className="ns-produces">→ {def.produces}</span>}
        </p>
        <h2 id="ns-title" className="ns-title">
          {def.title}
        </h2>
        <p className="ns-blurb">{def.blurb}</p>
        <div className="ns-placeholder">Coming soon — this panel is being built.</div>
        <div className="ns-nav">
          <button
            type="button"
            className="button-secondary"
            disabled={idx === 0}
            onClick={() => setStep(STEPS[idx - 1].id)}
          >
            Back
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={idx === STEPS.length - 1}
            onClick={() => setStep(STEPS[idx + 1].id)}
          >
            {idx < STEPS.length - 1 ? `Next: ${STEPS[idx + 1].label}` : 'Done'}
          </button>
        </div>
      </section>
    </div>
  );
}
