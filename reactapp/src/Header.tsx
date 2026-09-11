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
          src="/static/fimsim_gui/images/android-chrome-512x512.png"
          alt="FIMsim logo"
        />
        <span>
          <h1 className="wk-title">FIMsim</h1>
          <p className="wk-tagline">Set up and run 2D flood simulations from your browser</p>
        </span>
      </Link>
      <nav className="wk-header-actions">
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
