// reactapp/src/ProjectStep.tsx
// FE2's Project step: create a new project or open an existing one.
// Selecting a project navigates to its wizard (wizardPath — the model is a
// property of the project, chosen here at creation: FIMSIM-FE48).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, createProject, deleteProject, listProjects, type ServerProject } from './api';
import { DEFAULT_MODEL, MODELS, modelFromSlug, wizardPath, type ModelId } from './steps';
import './ProjectStep.css';

export default function ProjectStep() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ServerProject[] | null>(null);
  const [name, setName] = useState('');
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
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
      const p = await createProject(name.trim(), model);
      navigate(wizardPath(p));
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
        <fieldset className="ps-models">
          <legend className="ps-label">Model</legend>
          {(Object.keys(MODELS) as ModelId[]).map((m) => (
            <label key={m} className={'ps-model' + (m === model ? ' is-selected' : '')}>
              <input type="radio" name="ps-model" value={m} checked={m === model}
                     onChange={() => setModel(m)} />
              <span className="ps-model-name">{MODELS[m].label}</span>
              <span className="ps-model-note">
                {MODELS[m].runsOnPortal
                  ? 'Runs on the portal — results and flood maps here.'
                  : 'Deck only — builds the input files to run on your own GPU/HPC.'}
              </span>
            </label>
          ))}
        </fieldset>
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
          results — is stored under the project. The model is fixed per
          project; start another project to use the other model.
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
              <button type="button" className="ps-item-main" onClick={() => navigate(wizardPath(p))}>
                <span className="ps-item-name">
                  {p.name}
                  <span className={'ps-model-tag' + (MODELS[modelFromSlug(p.model)].runsOnPortal ? '' : ' is-deck')}>
                    {MODELS[modelFromSlug(p.model)].label}
                  </span>
                </span>
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
