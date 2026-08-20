// The river rail: the wizard's step indicator, drawn as a river reach flowing
// top (upstream) to bottom (downstream). The connector fills like rising water
// as steps complete; the active step is the ring the flow has reached.
import { STEPS, type StepId } from './steps';

interface Props {
  active: StepId;
  onSelect: (id: StepId) => void;
}

export default function StepRail({ active, onSelect }: Props) {
  const activeIdx = STEPS.findIndex((s) => s.id === active);

  return (
    <nav className="fs-rail" aria-label="Simulation steps">
      <ol className="fs-rail-list">
        {STEPS.map((step, i) => {
          const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'todo';
          return (
            <li key={step.id} className={`fs-rail-item is-${state}`}>
              {i > 0 && <span className="fs-rail-connector" aria-hidden="true" />}
              <button
                type="button"
                className="fs-rail-step"
                aria-current={state === 'active' ? 'step' : undefined}
                onClick={() => onSelect(step.id)}
              >
                <span className="fs-rail-node" aria-hidden="true">
                  {state === 'done' ? '✓' : ''}
                </span>
                <span className="fs-rail-label">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
