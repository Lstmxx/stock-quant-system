import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import React, { Suspense } from 'react';

const Login = React.lazy(() => import('../features/auth/Login'));
const AuthLayout = React.lazy(() => import('../features/auth/AuthLayout'));
const AppLayout = React.lazy(() => import('../components/layout/AppLayout'));
const LlmManagement = React.lazy(() => import('../features/llm/LlmManagement'));
const DataManagement = React.lazy(() => import('../features/data/DataManagement'));
const MarketChartPage = React.lazy(() => import('../features/market/MarketChartPage'));
const FactorTasksPage = React.lazy(() => import('../features/factor/FactorTasksPage'));
const FactorListPage = React.lazy(() => import('../features/factor/FactorListPage'));
const FactorSelectionPage = React.lazy(() => import('../features/factor/FactorSelectionPage'));
const LlmStockSelectionPage = React.lazy(() => import('../features/llm-selection/LlmStockSelectionPage'));

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
        element: <Navigate to="/data" replace />,
      },
      {
        path: 'llm',
        element: <Suspense fallback={<div>Loading...</div>}><LlmManagement /></Suspense>,
      },
      {
        path: 'llm-selection',
        element: <Suspense fallback={<div>Loading...</div>}><LlmStockSelectionPage /></Suspense>,
      },
      {
        path: 'data',
        element: <Suspense fallback={<div>Loading...</div>}><DataManagement /></Suspense>,
      },
      {
        path: 'market',
        element: <Suspense fallback={<div>Loading...</div>}><MarketChartPage /></Suspense>,
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
          {
            path: 'selection',
            element: <Suspense fallback={<div>Loading...</div>}><FactorSelectionPage /></Suspense>,
          },
        ]
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/data" replace />,
  }
]);
