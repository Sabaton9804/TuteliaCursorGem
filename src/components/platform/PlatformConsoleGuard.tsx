import React from 'react';
import { Navigate } from 'react-router-dom';
import { useTenant } from '../../contexts/TenantContext';

export default function PlatformConsoleGuard({ children }: { children: React.ReactNode }) {
  const { canAccessPlatformConsole, loading } = useTenant();

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        Verificando acceso de plataforma…
      </div>
    );
  }

  if (!canAccessPlatformConsole) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
