// reactapp/src/api.ts
// The BE6 REST client. Tethys serves the API under the app root with
// TRAILING SLASHES (Django APPEND_SLASH would eat POST bodies otherwise).
// CSRF: bootstrap the cookie once, then echo it as X-CSRFToken.
import type { Polygon } from 'geojson';

const BASE = '/apps/fimsim-gui/api';

export interface ServerStepSummary {
  id: number;
  status: string;
  finished: string | null;
}

export interface ServerAoi {
  id: number;
  project_id: number;
  name: string;
  geometry: Polygon;
  source: 'upload' | 'drawn' | 'example';
  feature_index: number;
  area_km2: number;
  is_rectangular: boolean;
  working_crs_epsg: number | null;
  lookup_status: 'pending' | 'running' | 'done' | 'failed';
  lookup_error: string | null;
  states: { name: string; abbr: string | null }[] | null;
  huc6_codes: string[] | null;
  huc8_codes: string[] | null;
  river_name: string | null;
  lookup: {
    gages?: { site_no: string; station_nm: string; lat: number; lon: number }[];
    flowlines?: GeoJSON.FeatureCollection | null;
    main_river?: GeoJSON.FeatureCollection | null;
  } | null;
  steps: Record<string, ServerStepSummary>;
}

export interface ServerProject {
  id: number;
  name: string;
  created: string;
  aoi_count: number;
  aois?: ServerAoi[];
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let csrfReady: Promise<void> | null = null;

function ensureCsrf(): Promise<void> {
  if (!csrfReady) {
    csrfReady = fetch(`${BASE}/csrf/`).then(() => undefined);
  }
  return csrfReady;
}

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET') {
    await ensureCsrf();
    init.headers = { ...(init.headers as object), 'X-CSRFToken': csrfToken() };
  }
  const res = await fetch(`${BASE}${path}`, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page (e.g. auth redirect) */
  }
  if (!res.ok) {
    // A submit that rejected every AOI returns its per-AOI reasons with a
    // non-2xx status — pass those through so panels can display them
    // instead of a generic failure.
    if (body && typeof body === 'object' && 'results' in (body as object)) {
      return body as T;
    }
    const msg =
      (body as { error?: string } | null)?.error ??
      (res.status === 403 ? 'You are not signed in, or this is not yours.'
        : `Request failed (${res.status}) — try again; if it persists, the job system may be restarting.`);
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

const json = (data: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

// ── projects ──────────────────────────────────────────────────────────────────

export const listProjects = () =>
  request<{ projects: ServerProject[] }>('/projects/').then((r) => r.projects);

export const createProject = (name: string) =>
  request<ServerProject>('/projects/', json({ name }));

export const getProject = (id: number) =>
  request<ServerProject>(`/projects/${id}/`);

export const deleteProject = (id: number) =>
  request<{ deleted: boolean }>(`/projects/${id}/`, { method: 'DELETE' });

// ── AOIs ──────────────────────────────────────────────────────────────────────

export const uploadAoiFile = async (projectId: number, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return request<{ aois: ServerAoi[]; skipped_non_polygon: number }>(
    `/projects/${projectId}/aois/`, { method: 'POST', body: form });
};

export const createDrawnAoi = (
  projectId: number, geometry: Polygon, name: string,
  source: 'drawn' | 'example' = 'drawn',
) =>
  request<{ aois: ServerAoi[] }>(
    `/projects/${projectId}/aois/`, json({ geometry, name, source }));

export const getAoi = (id: number) => request<ServerAoi>(`/aois/${id}/`);

export const deleteAoi = (id: number) =>
  request<{ deleted: boolean }>(`/aois/${id}/`, { method: 'DELETE' });

export const retryLookup = (id: number) =>
  request<ServerAoi>(`/aois/${id}/lookup/`, { method: 'POST' });

// ── BE7/BE9: steps, submission, status, outputs ───────────────────────────────

export interface StepSchema {
  defaults: Record<string, unknown>;
  requires: string[];
}

export interface SubmitResult {
  aoi_id: number;
  submitted: boolean;
  steprun_id?: number;
  reason?: string;
}

export interface ServerStepRun {
  id: number;
  aoi_id: number;
  step_key: string;
  status: string;
  config: Record<string, unknown> | null;
  manifest: { key: string; name: string; bytes: number }[] | null;
  progress: { stage: string; status: string; current: number; total: number;
              message: string; at: string }[] | null;
  error: string | null;
  created: string;
  started: string | null;
  finished: string | null;
}

export interface OutputEntry {
  key: string;
  name: string;
  bytes: number;
  content_type: string;
  url: string | null;
}

export const getStepSchemas = () =>
  request<Record<string, StepSchema>>('/steps/');

export const submitStep = (projectId: number, stepKey: string,
                           config: Record<string, unknown>) =>
  request<{ results: SubmitResult[] }>(
    `/projects/${projectId}/steps/${stepKey}/submit/`, json({ config }));

export const getProjectStatus = (projectId: number) =>
  request<{ aois: ServerAoi[] }>(`/projects/${projectId}/status/`);

export const getStepRun = (id: number) =>
  request<ServerStepRun>(`/stepruns/${id}/`);

export const cancelStepRun = (id: number) =>
  request<ServerStepRun>(`/stepruns/${id}/cancel/`, { method: 'POST' });

export const getStepRunOutputs = (id: number) =>
  request<{ outputs: OutputEntry[] }>(`/stepruns/${id}/outputs/`);
