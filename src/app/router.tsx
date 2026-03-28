import { createBrowserRouter } from "react-router-dom";
import { Layout } from "../ui/Layout";
import { RequireAuth } from "../ui/RequireAuth";
import { AdminLayout } from "../ui/AdminLayout";

import { LoginPage } from "../pages/LoginPage";
import { WorkerPage } from "../pages/WorkerPage";
import { WorkerHistoryPage } from "../pages/WorkerHistoryPage";
import { WorkerGestionesPage } from "../pages/WorkerGestionesPage";
import { PendingPage } from "../pages/PendingPage";

import { AdminPage } from "../pages/AdminPage";
import { AdminWorkerPage } from "../pages/AdminWorkerPage";
import { AdminIncidentsPage } from "../pages/AdminIncidentsPage";
import { AdminEmployeesPage } from "../pages/AdminEmployeesPage";
import { AdminExportsPage } from "../pages/AdminExportsPage";
import { AdminSettingsPage } from "../pages/AdminSettingsPage";

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/pending", element: <PendingPage /> },

      {
        path: "/worker",
        element: (
          <RequireAuth>
            <WorkerPage />
          </RequireAuth>
        ),
      },

      {
        path: "/worker/history",
        element: (
          <RequireAuth>
            <WorkerHistoryPage />
          </RequireAuth>
        ),
      },

      {
        path: "/worker/gestiones",
        element: (
          <RequireAuth>
            <WorkerGestionesPage />
          </RequireAuth>
        ),
      },

      {
        path: "/admin",
        element: (
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <AdminPage /> },
          { path: "incidents", element: <AdminIncidentsPage /> },
          { path: "employees", element: <AdminEmployeesPage /> },
          { path: "exports", element: <AdminExportsPage /> },
          { path: "settings", element: <AdminSettingsPage /> },
          { path: "worker/:userId", element: <AdminWorkerPage /> },
        ],
      },

      { path: "*", element: <LoginPage /> },
    ],
  },
]);