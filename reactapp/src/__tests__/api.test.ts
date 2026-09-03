// reactapp/src/__tests__/api.test.ts — request() behavior via the exported
// wrappers, with fetch mocked. jsdom supplies document.cookie for CSRF.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getProject, listProjects, submitStep } from '../api';

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request() via the API wrappers', () => {
  it('returns the JSON body on 2xx, hitting the app-rooted URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonRes({ projects: [{ id: 1, name: 'p', created: '', aoi_count: 0 }] }));
    vi.stubGlobal('fetch', fetchMock);

    const projects = await listProjects();
    expect(projects).toEqual([{ id: 1, name: 'p', created: '', aoi_count: 0 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/apps/fimsim-gui/api/projects/');
  });

  it('throws ApiError carrying the server {error} message on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ error: 'project not found' }, 404)));

    const err = await getProject(99).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('project not found');
  });

  it('passes a non-2xx {results:[...]} body through (per-AOI rejections)', async () => {
    // submitStep is a POST: the first fetch is the CSRF bootstrap.
    document.cookie = 'csrftoken=tok123';
    const results = [{ aoi_id: 1, submitted: false, reason: 'not rectangular' }];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 200 })) // GET /csrf/
      .mockResolvedValueOnce(jsonRes({ results }, 400));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitStep(9, 'dem', { dem_res_m: 10 })).resolves.toEqual({ results });
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/apps/fimsim-gui/api/projects/9/steps/dem/submit/');
    // non-GETs must echo the csrftoken cookie as X-CSRFToken
    expect(fetchMock.mock.calls[1][1].headers['X-CSRFToken']).toBe('tok123');
  });

  it('maps a 200 non-JSON body (login redirect HTML) to a 401 session-expired error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<html>sign in</html>', { status: 200 })));

    const err = await listProjects().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/session has expired/);
  });

  it('gives the friendly not-yours message on a bare 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('forbidden', { status: 403 })));

    const err = await getProject(1).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.message).toBe('You are not signed in, or this is not yours.');
  });
});
