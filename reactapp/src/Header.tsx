// reactapp/src/Header.tsx
// FIM-family branded header (matches FIMeval/FIMbench chrome): logo + title +
// tagline over the Header-HQ banner, and a Documentation link. Rendered by AppShell.
import { Link, NavLink } from 'react-router-dom';

export default function Header() {
  return (
    <header className="wk-header">
      <Link className="wk-brand" to="/new">
        <img
          className="wk-brand-logo"
          src="/static/fimsim_gui/images/fimsim_logo.png"
          alt="FIMsim logo"
        />
        <span>
          <h1 className="wk-title">FIMsim</h1>
          <p className="wk-tagline">Set up and run 2D flood simulations from your browser</p>
        </span>
      </Link>
      <nav className="wk-header-actions">
        <span className="wk-model-badge" title="TRITON, OWP HAND-FIM, and ARC-Curve2Flood arrive after the MVP">
          LISFLOOD-FP
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
