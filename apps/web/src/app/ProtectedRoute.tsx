import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../features/auth/store';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAuth?: boolean;
  requireGuest?: boolean;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ 
  children, 
  requireAuth = false, 
  requireGuest = false 
}) => {
  const { isReady, user, fetchSession } = useAuthStore();
  const location = useLocation();

  useEffect(() => {
    if (!isReady) {
      fetchSession();
    }
  }, [isReady, fetchSession]);

  if (!isReady) {
    return <div data-testid="loading-state">Loading...</div>;
  }

  if (requireAuth && !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireGuest && user) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};
