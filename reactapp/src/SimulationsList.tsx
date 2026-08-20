// reactapp/src/SimulationsList.tsx
// The persistent Simulations column (family pattern: FIMeval's RunsList).
// Placeholder until jobs exist (FIMSIM-BE5/FE9): shows the empty state.
import './SimulationsList.css';

export default function SimulationsList() {
  return (
    <div className="sl-wrap">
      <div className="sl-head">
        <h2 className="sl-title">Simulations</h2>
      </div>
      <div className="sl-empty">
        <p className="sl-empty-lead">No simulations yet.</p>
        <p className="sl-empty-hint">
          Start a <strong>New Simulation</strong> and your runs will appear here with live status.
        </p>
      </div>
    </div>
  );
}
