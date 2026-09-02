// Client-side routes for the workspace. AppShell is the layout; the detail pane
// (<Outlet/>) renders the active child route. Served under the Tethys app path
// in production (/apps/fimsim-gui/) and at / in dev. NOTE: the basename is
// deliberately NOT Vite's BASE_URL — that now points at the static-assets
// prefix (/static/fimsim_gui/frontend/), which is where files live, not where
// the app routes. Tethys's catch_all serves index.html for any sub-path, so
// /new survives a refresh.
import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppShell from './AppShell';
import NewSimulation from './NewSimulation';
import Docs from './Docs';

const basename = import.meta.env.PROD ? '/apps/fimsim-gui' : '/';

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppShell />,
      children: [
        { index: true, element: <Navigate to="/new" replace /> },
        { path: 'new', element: <NewSimulation /> },
        { path: 'new/:projectId', element: <NewSimulation /> },
        { path: 'docs', element: <Docs /> },
      ],
    },
  ],
  { basename },
);
