// FIMSIM-FE1: the wizard shell. Three regions — header, river rail, step panel —
// with the active step held in a single state variable. Panels are placeholders;
// each gains its real content in FIMSIM-FE2+.
import { useState } from 'react';
import Header from './Header';
import Footer from './Footer';
import StepRail from './StepRail';
import { STEPS, type StepId } from './steps';
import './App.css';

export default function App() {
  const [step, setStep] = useState<StepId>('project');

  const idx = STEPS.findIndex((s) => s.id === step);
  const def = STEPS[idx];

  return (
    <div className="fs-app">
      <Header />
      <div className="fs-body">
        <StepRail active={step} onSelect={setStep} />
        <main className="fs-panel-col">
          <section className="fs-panel" aria-labelledby="fs-panel-title">
            <p className="fs-panel-eyebrow">
              Step {idx + 1} of {STEPS.length}
              {def.produces && <span className="fs-produces">→ {def.produces}</span>}
            </p>
            <h2 id="fs-panel-title" className="fs-panel-title">
              {def.title}
            </h2>
            <p className="fs-panel-blurb">{def.blurb}</p>
            <div className="fs-panel-placeholder">Coming soon — this panel is being built.</div>
            <div className="fs-panel-nav">
              <button
                type="button"
                className="fs-btn-secondary"
                disabled={idx === 0}
                onClick={() => setStep(STEPS[idx - 1].id)}
              >
                Back
              </button>
              <button
                type="button"
                className="fs-btn-primary"
                disabled={idx === STEPS.length - 1}
                onClick={() => setStep(STEPS[idx + 1].id)}
              >
                Next: {idx < STEPS.length - 1 ? STEPS[idx + 1].label : ''}
              </button>
            </div>
          </section>
        </main>
      </div>
      <Footer />
    </div>
  );
}
