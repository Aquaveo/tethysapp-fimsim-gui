// reactapp/src/AppShell.tsx
// The workspace shell — same chrome as FIMeval/FIMbench: branded header +
// footer, a slim left nav, a persistent Simulations list, and a detail pane
// (<Outlet/>) that renders the active route (New Simulation wizard / docs).
import { NavLink, Outlet } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';
import SimulationsList from './SimulationsList';
import './AppShell.css';

export default function AppShell() {
  return (
    <div className="wk-app">
      <Header />
      <div className="wk-body">
        <nav className="wk-nav" aria-label="Primary">
          <NavLink to="/new" className="wk-new-btn">
            <span aria-hidden="true">＋</span> New Simulation
          </NavLink>
          <NavLink
            to="/docs"
            className={({ isActive }) => 'wk-nav-item' + (isActive ? ' is-active' : '')}
          >
            Documentation
          </NavLink>
          <SimulationsList />
          <div className="wk-nav-foot">Signed in</div>
        </nav>

        <main className="wk-detail">
          <Outlet />
        </main>
      </div>
      <Footer />
    </div>
  );
}
