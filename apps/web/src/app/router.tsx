import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import React, { Suspense } from 'react';

const Login = React.lazy(() => import('../features/auth/Login'));
const Dashboard = React.lazy(() => import('../features/dashboard/Dashboard'));
const AuthLayout = React.lazy(() => import('../features/auth/AuthLayout'));
const AppLayout = React.lazy(() => import('../components/layout/AppLayout'));
const LlmManagement = React.lazy(() => import('../features/llm/LlmManagement'));
const DataManagement = React.lazy(() => import('../features/data/DataManagement'));
const FactorTasksPage = React.lazy(() => import('../features/factor/FactorTasksPage'));
const FactorListPage = React.lazy(() => import('../features/factor/FactorListPage'));

export const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <ProtectedRoute requireGuest>
        <Suspense fallback={<div>Loading...</div>}>
          <AuthLayout>
            <Login />
          </AuthLayout>
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/',
    element: (
      <ProtectedRoute requireAuth>
        <Suspense fallback={<div>Loading...</div>}>
          <AppLayout />
        </Suspense>
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'dashboard',
        element: <Suspense fallback={<div>Loading...</div>}><Dashboard /></Suspense>,
      },
      {
        path: 'llm',
        element: <Suspense fallback={<div>Loading...</div>}><LlmManagement /></Suspense>,
      },
      {
        path: 'data',
        element: <Suspense fallback={<div>Loading...</div>}><DataManagement /></Suspense>,
      },
      {
        path: 'factor',
        children: [
          {
            path: 'tasks',
            element: <Suspense fallback={<div>Loading...</div>}><FactorTasksPage /></Suspense>,
          },
          {
            path: 'list',
            element: <Suspense fallback={<div>Loading...</div>}><FactorListPage /></Suspense>,
          },
        ]
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/dashboard" replace />,
  }
]);
