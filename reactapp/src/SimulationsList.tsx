// reactapp/src/SimulationsList.tsx
// The persistent Simulations column (FE9-lite): the user's projects,
// newest first, with click-to-open. Lives inside the dark nav sidebar.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { listProjects, type ServerProject } from './api';
import './SimulationsList.css';

export default function SimulationsList() {
  const navigate = useNavigate();
  const params = useParams<{ projectId?: string }>();
  const activeId = params.projectId ? Number(params.projectId) : null;
  const [projects, setProjects] = useState<ServerProject[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      listProjects().then((p) => alive && setProjects(p)).catch(() => undefined);
    void load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [activeId]);

  return (
    <div className="sl-wrap">
      <div className="sl-head">
        <h2 className="sl-title">Simulations</h2>
      </div>
      {projects === null ? (
        <div className="sl-empty"><p className="sl-empty-hint">Loading…</p></div>
      ) : projects.length === 0 ? (
        <div className="sl-empty">
          <p className="sl-empty-lead">No simulations yet.</p>
          <p className="sl-empty-hint">
            Start a <strong>New Simulation</strong> and your runs will appear here.
          </p>
        </div>
      ) : (
        <ul className="sl-list">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={'sl-item' + (p.id === activeId ? ' is-active' : '')}
                onClick={() => navigate(`/new/${p.id}`)}
              >
                <span className="sl-item-name">{p.name}</span>
                <span className="sl-item-meta">
                  {p.aoi_count} {p.aoi_count === 1 ? 'area' : 'areas'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
