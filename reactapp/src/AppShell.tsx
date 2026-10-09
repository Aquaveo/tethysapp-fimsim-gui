// reactapp/src/AppShell.tsx
// The workspace shell — same chrome as FIMeval/FIMbench: branded header +
// footer, a slim left nav, a persistent Simulations list, and a detail pane
// (<Outlet/>) that renders the active route (New Simulation wizard / docs).
import { useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';
import SimulationsList from './SimulationsList';
import WelcomeModal from './WelcomeModal';
import { ActiveModelContext } from './activeModel';
import type { ModelId } from './steps';
import './AppShell.css';

export default function AppShell() {
  const [showWelcome, setShowWelcome] = useState(() => {
    try { return !localStorage.getItem('fimsim.welcomeSeen'); }
    catch { return true; }
  });
  const closeWelcome = (dontShowAgain: boolean) => {
    try {
      if (dontShowAgain) localStorage.setItem('fimsim.welcomeSeen', '1');
      else localStorage.removeItem('fimsim.welcomeSeen');
    } catch { /* storage unavailable → modal reappears next visit */ }
    setShowWelcome(false);
  };

  // FE58: the wizard publishes the open project's model; the header shows it
  const [model, setModel] = useState<ModelId | null>(null);
  const activeModel = useMemo(() => ({ model, setModel }), [model]);

  return (
    <ActiveModelContext.Provider value={activeModel}>
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
      {showWelcome && <WelcomeModal onClose={closeWelcome} />}
    </div>
    </ActiveModelContext.Provider>
  );
}
