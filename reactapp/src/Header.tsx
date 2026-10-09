// reactapp/src/Header.tsx
// FIM-family branded header (matches FIMeval/FIMbench chrome): logo + title +
// tagline over the Header-HQ banner, and a Documentation link. Rendered by AppShell.
import { Link, NavLink } from 'react-router-dom';
import { useActiveModel } from './activeModel';
import { MODELS } from './steps';

export default function Header() {
  const { model } = useActiveModel();
  return (
    <header className="wk-header">
      <Link className="wk-brand" to="/new">
        <img
          className="wk-brand-logo"
          src="/static/fimsim_gui/images/android-chrome-512x512.png"
          alt="FIMsim logo"
        />
        <span>
          <h1 className="wk-title">FIMsim</h1>
          <p className="wk-tagline">Set up and run 2D flood simulations from your browser</p>
        </span>
      </Link>
      <nav className="wk-header-actions">
        {model && (
          <span
            className={'wk-model-badge' + (MODELS[model].runsOnPortal ? '' : ' is-deck')}
            title={MODELS[model].runsOnPortal
              ? 'This project runs LISFLOOD-FP on the portal'
              : 'This project builds a TRITON input deck to run on your own GPU/HPC'}
          >
            {MODELS[model].label}
          </span>
        )}
        <span
          className="wk-alpha-badge"
          title="Lightweight alpha — for the full feature set (HAND-FIM, ARC, standalone tools) use the desktop FIMsim"
        >
          Alpha
        </span>
        <NavLink
          to="/docs"
          className={({ isActive }) => 'wk-doc-pill' + (isActive ? ' is-active' : '')}
        >
          Documentation
        </NavLink>
      </nav>
    </header>
  );
}
