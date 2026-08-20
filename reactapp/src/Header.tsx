// FIM-family branded header (same chrome as FIMeval/FIMbench): title + tagline
// over the navy banner, with the model badge on the right.
export default function Header() {
  return (
    <header className="fs-header">
      <div className="fs-brand">
        <h1 className="fs-title">FIMsim</h1>
        <p className="fs-tagline">Set up and run 2D flood simulations from your browser</p>
      </div>
      <div className="fs-header-actions">
        <span className="fs-model-badge" title="TRITON, OWP HAND-FIM, and ARC-Curve2Flood arrive after the MVP">
          LISFLOOD-FP
        </span>
      </div>
    </header>
  );
}
