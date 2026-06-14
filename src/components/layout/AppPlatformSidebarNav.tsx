import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Building2, LayoutDashboard, Users } from 'lucide-react';
import { useTenant } from '../../contexts/TenantContext';

type Props = {
  sidebarCollapsed: boolean;
  onNavigate?: () => void;
};

function linkClass(active: boolean, collapsed: boolean): string {
  const base =
    'flex items-center gap-3 rounded-xl text-sm font-semibold transition-colors';
  if (collapsed) {
    return `${base} justify-center p-3 ${active ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white hover:bg-white/10'}`;
  }
  return `${base} px-4 py-2.5 ${active ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white hover:bg-white/10'}`;
}

export function AppPlatformSidebarNav({ sidebarCollapsed, onNavigate }: Props) {
  const location = useLocation();
  const { isPlatformAdmin } = useTenant();

  const items: React.ReactNode[] = [
    <Link
      key="despachos"
      to="/plataforma"
      title={sidebarCollapsed ? 'Despachos judiciales' : undefined}
      onClick={onNavigate}
      className={linkClass(
        location.pathname === '/plataforma' || location.pathname.startsWith('/plataforma/courts/'),
        sidebarCollapsed
      )}
    >
      <Building2 className="w-4 h-4 shrink-0" />
      {!sidebarCollapsed && 'Despachos judiciales'}
    </Link>,
  ];

  if (isPlatformAdmin) {
    items.push(
      <Link
        key="regional"
        to="/plataforma/regional"
        title={sidebarCollapsed ? 'Admins regionales' : undefined}
        onClick={onNavigate}
        className={linkClass(location.pathname.startsWith('/plataforma/regional'), sidebarCollapsed)}
      >
        <Users className="w-4 h-4 shrink-0" />
        {!sidebarCollapsed && 'Admins regionales'}
      </Link>
    );
  }

  items.push(
    <Link
      key="volver"
      to="/"
      title={sidebarCollapsed ? 'Volver al despacho' : undefined}
      onClick={onNavigate}
      className={linkClass(false, sidebarCollapsed)}
    >
      <LayoutDashboard className="w-4 h-4 shrink-0" />
      {!sidebarCollapsed && 'Volver al despacho'}
    </Link>
  );

  if (!sidebarCollapsed) {
    items.push(
      <p key="hint" className="text-[10px] text-white/40 leading-relaxed px-1 pt-3 border-t border-white/10 mt-2">
        La consola no muestra expedientes. Use «Volver al despacho» y «Operar como…» para tutelas.
      </p>
    );
  }

  return <>{items}</>;
}
