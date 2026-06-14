import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Gavel,
  LayoutDashboard,
  PlusCircle,
  Scale,
  Settings,
  Search,
  FileStack,
  Users,
  BarChart3,
  ListTodo,
  BookOpen,
  Mail,
  ClipboardList,
  Reply,
  ChevronDown,
  Building2,
} from 'lucide-react';
import { useTenant } from '../../contexts/TenantContext';
import { intentFreshNewCaseFromMenu } from '../../lib/new-case-nav';
import {
  TUTELAS_SUBMENU,
  isTutelasRouteActive,
  isTutelasSubItemActive,
  tutelasListHref,
} from '../../lib/tutelas-nav';

type NavLinkItem = {
  name: string;
  path: string;
  icon: LucideIcon;
};

const NAV_LINKS: NavLinkItem[] = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Radicación', path: '/new', icon: PlusCircle },
  { name: 'Centro de trabajo', path: '/tasks', icon: ListTodo },
  { name: 'Tablero sustanciador', path: '/sustanciador', icon: Scale },
  { name: 'Estadísticas', path: '/estadisticas', icon: BarChart3 },
  { name: 'Biblioteca de precedentes', path: '/biblioteca-precedentes', icon: BookOpen },
  { name: 'Plantillas', path: '/plantillas', icon: FileStack },
  { name: 'Equipo de trabajo', path: '/equipo', icon: Users },
  { name: 'Correo', path: '/correo', icon: Mail },
  { name: 'Contestaciones', path: '/correo/contestaciones', icon: Reply },
  { name: 'Pendientes correo', path: '/correo/pendientes', icon: ClipboardList },
  { name: 'Sincronización SGDE', path: '/sgde', icon: Search },
  { name: 'Configuración', path: '/settings', icon: Settings },
];

type Props = {
  sidebarCollapsed: boolean;
  urgentWorkflowCount: number;
  onNavigate?: () => void;
};

function linkIsActive(pathname: string, path: string): boolean {
  if (path === '/') return pathname === '/';
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function AppSidebarNav({ sidebarCollapsed, urgentWorkflowCount, onNavigate }: Props) {
  const location = useLocation();
  const { canAccessPlatformConsole } = useTenant();
  const [tutelasOpen, setTutelasOpen] = useState(() =>
    isTutelasRouteActive(location.pathname, location.search)
  );

  useEffect(() => {
    if (isTutelasRouteActive(location.pathname, location.search)) {
      setTutelasOpen(true);
    }
  }, [location.pathname, location.search]);

  const tutelasGroupActive = isTutelasRouteActive(location.pathname, location.search);
  const showTutelasChildren = !sidebarCollapsed && tutelasOpen;

  const linkClass = (active: boolean, collapsed: boolean) =>
    `relative flex items-center rounded-xl text-sm font-medium transition-all ${
      collapsed ? 'justify-center px-2 py-3' : 'gap-3 px-4 py-3'
    } ${
      active
        ? 'bg-accent text-white shadow-lg shadow-accent/20'
        : 'text-slate-400 hover:text-white hover:bg-white/5'
    }`;

  const subLinkClass = (active: boolean) =>
    `relative flex items-center gap-2 rounded-lg pl-11 pr-3 py-2.5 text-sm font-medium transition-all ${
      active ? 'bg-accent/90 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'
    }`;

  const renderUrgentBadge = (show: boolean, collapsed: boolean) =>
    show ? (
      <span
        className={`absolute flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-black text-white shadow-md ring-2 ring-primary ${
          collapsed ? 'right-1 top-1' : 'right-2 top-2'
        }`}
        aria-label={`${urgentWorkflowCount} tareas urgentes pendientes`}
      >
        {urgentWorkflowCount > 9 ? '9+' : String(urgentWorkflowCount)}
      </span>
    ) : null;

  const renderProcesosPlaceholder = () => (
    <div
      key="procesos-placeholder"
      title={sidebarCollapsed ? 'Procesos — Próximamente' : undefined}
      aria-disabled="true"
      className={`relative flex cursor-default select-none rounded-xl ${
        sidebarCollapsed ? 'items-center justify-center px-2 py-3' : 'items-start gap-3 px-4 py-3'
      }`}
    >
      <Scale
        className={`w-4 h-4 shrink-0 text-slate-500 ${sidebarCollapsed ? '' : 'mt-0.5'}`}
        aria-hidden
      />
      {!sidebarCollapsed && (
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-400">Procesos</p>
          <p className="text-[10px] font-medium tracking-wide text-slate-500/80">Próximamente</p>
        </div>
      )}
    </div>
  );

  const renderTutelasGroup = () => (
    <div key="tutelas-group" className="space-y-0.5">
      {sidebarCollapsed ? (
        <Link
          to={tutelasListHref({ kind: 'tipo', tipo: 'tutela_primera' })}
          title="Tutelas"
          onClick={onNavigate}
          className={linkClass(tutelasGroupActive, true)}
        >
          <Gavel className="w-4 h-4 shrink-0" />
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => setTutelasOpen((o) => !o)}
          className={`${linkClass(tutelasGroupActive, false)} w-full`}
          aria-expanded={tutelasOpen}
          aria-controls="nav-tutelas-children"
        >
          <Gavel className="w-4 h-4 shrink-0" />
          Tutelas
          <ChevronDown
            className={`ml-auto w-4 h-4 shrink-0 transition-transform ${tutelasOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
      )}
      {showTutelasChildren ? (
        <div id="nav-tutelas-children" className="space-y-0.5 pb-1">
          {TUTELAS_SUBMENU.map((sub) => {
            const href = tutelasListHref(sub.filter);
            const subActive = isTutelasSubItemActive(location.pathname, location.search, sub.filter);
            return (
              <Link key={sub.label} to={href} onClick={onNavigate} className={subLinkClass(subActive)}>
                <span className="truncate">{sub.label}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  const items: React.ReactNode[] = [];

  for (let i = 0; i < NAV_LINKS.length; i++) {
    const item = NAV_LINKS[i];
    if (i === 2) {
      items.push(renderTutelasGroup());
      items.push(renderProcesosPlaceholder());
    }

    const isActive = linkIsActive(location.pathname, item.path);
    const Icon = item.icon;
    const showUrgent = item.path === '/tasks' && urgentWorkflowCount > 0;

    items.push(
      <Link
        key={item.name}
        to={item.path}
        title={sidebarCollapsed ? item.name : undefined}
        onClick={() => {
          onNavigate?.();
          if (item.path === '/new') {
            intentFreshNewCaseFromMenu(location.pathname === '/new');
          }
        }}
        className={linkClass(isActive, sidebarCollapsed)}
      >
        <Icon className="w-4 h-4 shrink-0" />
        {!sidebarCollapsed && item.name}
        {renderUrgentBadge(showUrgent, sidebarCollapsed)}
      </Link>
    );
  }

  if (canAccessPlatformConsole) {
    const platformActive = linkIsActive(location.pathname, '/plataforma');
    items.push(
      <Link
        key="Consola plataforma"
        to="/plataforma"
        title={sidebarCollapsed ? 'Consola plataforma' : undefined}
        onClick={onNavigate}
        className={linkClass(platformActive, sidebarCollapsed)}
      >
        <Building2 className="w-4 h-4 shrink-0" />
        {!sidebarCollapsed && 'Consola plataforma'}
      </Link>
    );
  }

  return <>{items}</>;
}
