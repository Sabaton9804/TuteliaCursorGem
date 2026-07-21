import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Gavel, ChevronDown, Building2, Scale } from 'lucide-react';
import { useTenant } from '../../contexts/TenantContext';
import { useSessionCourt } from '../../contexts/SessionCourtContext';
import { intentFreshNewCaseFromMenu } from '../../lib/new-case-nav';
import { navLinksForRole, hasRoleCapability } from '../../lib/role-capabilities';
import {
  TUTELAS_SUBMENU,
  isTutelasRouteActive,
  isTutelasSubItemActive,
  tutelasListHref,
} from '../../lib/tutelas-nav';
import {
  PROCESOS_SUBMENU,
  isProcesosRouteActive,
  isProcesosSubItemActive,
} from '../../lib/procesos-nav';
import { useCaseNavScope } from '../../contexts/CaseNavScopeContext';

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
  const { profile } = useSessionCourt();
  const role = profile?.role ?? null;
  const navLinks = useMemo(() => navLinksForRole(role), [role]);
  const caseNavScope = useCaseNavScope();
  const showTutelasNav = hasRoleCapability(role, 'ver_expediente');
  const showProcesosNav = hasRoleCapability(role, 'ver_expediente');

  const [tutelasOpen, setTutelasOpen] = useState(() =>
    isTutelasRouteActive(location.pathname, location.search, caseNavScope)
  );
  const [procesosOpen, setProcesosOpen] = useState(() =>
    isProcesosRouteActive(location.pathname, location.search, caseNavScope)
  );

  useEffect(() => {
    if (isTutelasRouteActive(location.pathname, location.search, caseNavScope)) {
      setTutelasOpen(true);
    }
  }, [location.pathname, location.search, caseNavScope]);

  useEffect(() => {
    if (isProcesosRouteActive(location.pathname, location.search, caseNavScope)) {
      setProcesosOpen(true);
    }
  }, [location.pathname, location.search, caseNavScope]);

  const tutelasGroupActive = isTutelasRouteActive(location.pathname, location.search, caseNavScope);
  const procesosGroupActive = isProcesosRouteActive(location.pathname, location.search, caseNavScope);
  const showTutelasChildren = !sidebarCollapsed && tutelasOpen;
  const showProcesosChildren = !sidebarCollapsed && procesosOpen;

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

  const renderProcesosGroup = () => {
    if (!showProcesosNav) return null;
    return (
      <div key="procesos-group" className="space-y-0.5">
        {sidebarCollapsed ? (
          <Link
            to="/procesos/civiles"
            title="Procesos"
            onClick={onNavigate}
            className={linkClass(procesosGroupActive, true)}
          >
            <Scale className="w-4 h-4 shrink-0" />
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setProcesosOpen((o) => !o)}
            className={`${linkClass(procesosGroupActive, false)} w-full`}
            aria-expanded={procesosOpen}
            aria-controls="nav-procesos-children"
          >
            <Scale className="w-4 h-4 shrink-0" />
            Procesos
            <ChevronDown
              className={`ml-auto w-4 h-4 shrink-0 transition-transform ${procesosOpen ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>
        )}
        {showProcesosChildren ? (
          <div id="nav-procesos-children" className="space-y-0.5 pb-1">
            {PROCESOS_SUBMENU.map((sub) => {
              const subActive = isProcesosSubItemActive(
                location.pathname,
                sub.path,
                location.search,
                caseNavScope,
              );
              return (
                <Link key={sub.label} to={sub.path} onClick={onNavigate} className={subLinkClass(subActive)}>
                  <span className="truncate">{sub.label}</span>
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  const renderTutelasGroup = () => {
    if (!showTutelasNav) return null;
    return (
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
  };

  const items: React.ReactNode[] = [];

  for (let i = 0; i < navLinks.length; i++) {
    const item = navLinks[i];
    if (i === 2) {
      items.push(renderTutelasGroup());
      items.push(renderProcesosGroup());
    }

    const isActive = linkIsActive(location.pathname, item.path);
    const Icon = item.icon;
    const showUrgent = item.path === '/tasks' && urgentWorkflowCount > 0;

    items.push(
      <Link
        key={item.id}
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
