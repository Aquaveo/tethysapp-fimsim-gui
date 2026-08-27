// reactapp/src/ProjectStep.tsx
// FE2's Project step: create a new project or open an existing one.
// Selecting a project navigates to /new/<id>, which keys the whole wizard.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, createProject, deleteProject, listProjects, type ServerProject } from './api';
import './ProjectStep.css';

export default function ProjectStep() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ServerProject[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    listProjects().then(setProjects).catch((e) => setError(String(e.message)));

  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await createProject(name.trim());
      navigate(`/new/${p.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: ServerProject) => {
    if (!window.confirm(`Delete project "${p.name}" and all its areas and results?`)) return;
    try {
      await deleteProject(p.id);
      void refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <div className="ps-wrap">
      <form
        className="ps-create"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label className="ps-label" htmlFor="ps-name">New project name</label>
        <div className="ps-create-row">
          <input
            id="ps-name"
            className="ps-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Neuse Hurricane Matthew"
            maxLength={120}
          />
          <button type="submit" className="button-primary" disabled={!name.trim() || busy}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
        <p className="ps-hint">
          Everything the simulation needs — study areas, inputs, model files,
          results — is stored under the project.
        </p>
      </form>

      {error && <div className="ps-error" role="alert">{error}</div>}

      <h3 className="ps-existing-title">Your projects</h3>
      {projects === null ? (
        <p className="ps-muted">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="ps-muted">No projects yet — create your first one above.</p>
      ) : (
        <ul className="ps-list">
          {projects.map((p) => (
            <li key={p.id} className="ps-item">
              <button type="button" className="ps-item-main" onClick={() => navigate(`/new/${p.id}`)}>
                <span className="ps-item-name">{p.name}</span>
                <span className="ps-item-meta">
                  {new Date(p.created).toLocaleDateString()} · {p.aoi_count}{' '}
                  {p.aoi_count === 1 ? 'area' : 'areas'}
                </span>
              </button>
              <button
                type="button"
                className="ps-item-x"
                aria-label={`Delete ${p.name}`}
                onClick={() => void remove(p)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
