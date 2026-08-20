// reactapp/src/Docs.tsx
// Documentation placeholder: points at the desktop FIMsim manual until the
// web app grows its own docs.
export default function Docs() {
  return (
    <section className="ns-card" style={{ maxWidth: '46rem' }}>
      <h2 style={{ marginTop: 0 }}>Documentation</h2>
      <p>
        Web-app documentation is coming with the MVP. Until then, the workflow —
        study area, terrain, roughness, boundaries, flow data, simulation
        settings — is the same one described in the desktop FIMsim manual:
      </p>
      <ul>
        <li>
          <a href="https://github.com/pnikrou/FIMsim" target="_blank" rel="noreferrer">
            FIMsim on GitHub
          </a>{' '}
          — source, README, and test-case walkthroughs
        </li>
        <li>
          <a href="https://sdml.ua.edu/" target="_blank" rel="noreferrer">
            The FIM ecosystem at SDML
          </a>
        </li>
      </ul>
    </section>
  );
}
