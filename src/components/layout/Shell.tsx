import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import {
  Gavel,
  LayoutDashboard,
  PlusCircle,
  Settings,
  Scale,
  X,
  Search,
  AlertTriangle,
  FileStack,
  Users,
  BarChart3,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { supabase, isSupabaseConfigured, assertSupabaseConfigured } from '../../lib/supabase';
import { getDevAdminEmail, resolveDevAdminPassword } from '../../lib/dev-admin-auth';
import { getSupabaseAuthErrorMessage, isLocalSupabaseAnonymousDisabled } from '../../lib/supabase-auth-errors';
import { rowToUserProfile } from '../../lib/supabase-mappers';
import { intentFreshNewCaseFromMenu } from '../../lib/new-case-nav';
import { DEFAULT_DEMO_COURT_ID } from '../../lib/default-court';
import { userRoleLabelEs } from '../../lib/user-roles';
import { UserProfile } from '../../types';
import { SessionCourtProvider } from '../../contexts/SessionCourtContext';
import { AssignmentNotificationBell } from './AssignmentNotificationBell';
import { motion, AnimatePresence } from 'motion/react';
import type { Provider, User } from '@supabase/supabase-js';

interface ShellProps {
  children: React.ReactNode;
}

const SIDEBAR_COLLAPSED_KEY = 'tutelia_sidebar_collapsed';

function mapSessionUser(user: User): { uid: string; email: string | undefined; displayName: string; photoURL?: string } {
  const meta = user.user_metadata || {};
  const name =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    user.email?.split('@')[0] ||
    'Funcionario';
  const av = typeof meta.avatar_url === 'string' ? meta.avatar_url : typeof meta.picture === 'string' ? meta.picture : undefined;
  return { uid: user.id, email: user.email, displayName: name, photoURL: av };
}

export default function Shell({ children }: ShellProps) {
  const [user, setUser] = useState<{ uid: string; email?: string; displayName: string; photoURL?: string } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [loginError, setLoginError] = useState<string | null>(null);
  /** Por defecto credenciales locales hasta configurar Google / Microsoft en Supabase. */
  const [useLocalAuth, setUseLocalAuth] = useState(true);
  const [localCredentials, setLocalCredentials] = useState({ user: '', pass: '' });
  const [localModeWithoutSupabase, setLocalModeWithoutSupabase] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const ensureAnonymousSession = async () => {
    await supabase.auth.getSession();
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setConfigError('Configure URL y clave anónima de Supabase: VITE_SUPABASE_* o NEXT_PUBLIC_SUPABASE_* en .env.');
      setLoading(false);
      return;
    }
    assertSupabaseConfigured();

    let cancelled = false;

    async function hydrateUser(raw: User) {
      if (cancelled) return;
      setLoginError(null);
      setLocalModeWithoutSupabase(false);
      const mapped = mapSessionUser(raw);
      try {
        const { data: row } = await supabase.from('profiles').select('*').eq('id', raw.id).maybeSingle();
        if (row) {
          setProfile(rowToUserProfile(row as Record<string, unknown>));
        } else {
          const newProfile: UserProfile = {
            id: raw.id,
            email: raw.email || '',
            name: mapped.displayName,
            role: 'admin',
            courtId: DEFAULT_DEMO_COURT_ID,
          };
          await supabase.from('profiles').upsert(
            {
              id: newProfile.id,
              email: newProfile.email,
              name: newProfile.name,
              role: newProfile.role,
              court_id: newProfile.courtId,
            },
            { onConflict: 'id' }
          );
          setProfile(newProfile);
        }
      } catch (e) {
        console.error('Could not handle profile setup', e);
      }
      setUser(mapped);
      setLoading(false);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        void hydrateUser(session.user);
        return;
      }
      if (event === 'INITIAL_SESSION') {
        return;
      }
      setUser(null);
      setProfile(null);
      setLocalModeWithoutSupabase(false);
      setLoading(false);
    });

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.user) {
        await hydrateUser(session.user);
        return;
      }

      const savedUser = localStorage.getItem('tutelia_mock_user');
      if (savedUser) {
        const u = JSON.parse(savedUser) as { uid: string; email?: string; displayName?: string };
        if (typeof u.uid === 'string' && u.uid.startsWith('local-')) {
          try {
            await ensureAnonymousSession();
            if (cancelled) return;
            setLocalModeWithoutSupabase(false);
            const su = (await supabase.auth.getUser()).data.user;
            const localUser = su
              ? mapSessionUser(su)
              : { uid: u.uid, email: u.email, displayName: u.displayName || 'Administrador Local' };
            localStorage.setItem('tutelia_mock_user', JSON.stringify(localUser));
            setUser(localUser);
            setProfile({
              id: localUser.uid,
              email: localUser.email || '',
              name: localUser.displayName,
              role: 'admin',
              courtId: DEFAULT_DEMO_COURT_ID,
            });
            setLoginError(null);
          } catch (err) {
            console.error('Could not restore local Supabase session', err);
            if (isLocalSupabaseAnonymousDisabled(err)) {
              setLocalModeWithoutSupabase(true);
              setLoginError(null);
              const localUser = {
                uid: typeof u.uid === 'string' && u.uid.startsWith('local-') ? u.uid : `local-${crypto.randomUUID()}`,
                email: u.email,
                displayName: u.displayName || 'Administrador Local',
              };
              localStorage.setItem('tutelia_mock_user', JSON.stringify(localUser));
              setUser(localUser);
              setProfile({
                id: localUser.uid,
                email: localUser.email || '',
                name: localUser.displayName,
                role: 'admin',
                courtId: DEFAULT_DEMO_COURT_ID,
              });
            } else {
              setLocalModeWithoutSupabase(false);
              setLoginError(getSupabaseAuthErrorMessage(err));
              setUser({
                uid: u.uid,
                email: u.email,
                displayName: u.displayName || 'Administrador Local',
              });
              setProfile({
                id: u.uid,
                email: u.email || '',
                name: u.displayName || 'Administrador Local',
                role: 'admin',
                courtId: DEFAULT_DEMO_COURT_ID,
              });
            }
          }
        } else {
          localStorage.removeItem('tutelia_mock_user');
        }
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (localCredentials.user === 'admin' && localCredentials.pass === 'admin') {
      try {
        assertSupabaseConfigured();
        const email = getDevAdminEmail();
        const { data: signData, error: signErr } = await supabase.auth.signInWithPassword({
          email,
          password: resolveDevAdminPassword(localCredentials.pass),
        });
        if (signErr) throw signErr;
        const su = signData.user;
        if (!su) throw new Error('No se recibió usuario de Supabase tras el inicio de sesión.');
        setLocalModeWithoutSupabase(false);
        const mockUser = mapSessionUser(su);
        localStorage.setItem('tutelia_mock_user', JSON.stringify(mockUser));
        setUser(mockUser);
        setProfile({
          id: mockUser.uid,
          email: mockUser.email || '',
          name: mockUser.displayName,
          role: 'admin',
          courtId: DEFAULT_DEMO_COURT_ID,
        });
        setLoginError(null);
      } catch (err) {
        if (isLocalSupabaseAnonymousDisabled(err)) {
          const mockUser = {
            uid: `local-${crypto.randomUUID()}`,
            email: 'admin@tutelia.gov.co',
            displayName: 'Administrador Local',
          };
          localStorage.setItem('tutelia_mock_user', JSON.stringify(mockUser));
          setUser(mockUser);
          setProfile({
            id: mockUser.uid,
            email: mockUser.email,
            name: mockUser.displayName,
            role: 'admin',
            courtId: DEFAULT_DEMO_COURT_ID,
          });
          setLocalModeWithoutSupabase(true);
          setLoginError(null);
          return;
        }
        console.error('Local login failed at auth level', err);
        setLoginError(getSupabaseAuthErrorMessage(err));
      }
    } else {
      setLoginError('Credenciales locales incorrectas. Use admin / admin.');
    }
  };

  const handleOAuthLogin = async (provider: Provider) => {
    setLoginError(null);
    try {
      assertSupabaseConfigured();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/`,
          skipBrowserRedirect: false,
          ...(provider === 'azure'
            ? {
                scopes: 'email openid profile',
                queryParams: { prompt: 'select_account' },
              }
            : {}),
        },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.assign(data.url);
      }
    } catch (error: unknown) {
      console.error('Login failed', error);
      const label = provider === 'azure' ? 'Microsoft 365' : 'Google';
      const msg = error instanceof Error ? error.message : `Error al iniciar sesión con ${label}.`;
      setLoginError(msg);
    }
  };

  const handleLogout = async () => {
    localStorage.removeItem('tutelia_mock_user');
    setLocalModeWithoutSupabase(false);
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    navigate('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary">
        <div className="text-xl font-mono text-white animate-pulse uppercase tracking-[0.3em]">Cargando Tutelia...</div>
      </div>
    );
  }

  const showConfigBlock = configError && !user;

  if (!user || showConfigBlock) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-slate-900 font-sans">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full p-10 space-y-6 bg-white border border-slate-100 rounded-2xl shadow-card"
        >
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Scale className="w-9 h-9 text-accent" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">Tutelia</h1>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Gestión Judicial Inteligente</p>
            </div>
          </div>

          {showConfigBlock ? (
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-900 font-medium">{configError}</div>
          ) : !useLocalAuth ? (
            <div className="space-y-4 pt-4">
              <button
                type="button"
                onClick={() => void handleOAuthLogin('google')}
                className="btn-primary w-full flex items-center justify-center gap-3"
              >
                Ingresar con Google
              </button>
              <button
                type="button"
                onClick={() => void handleOAuthLogin('azure')}
                className="w-full py-3 rounded-lg text-xs font-bold border border-slate-800 bg-slate-900 text-white hover:bg-slate-800 transition-all uppercase tracking-widest flex items-center justify-center gap-2"
              >
                Ingresar con Microsoft 365
              </button>
              <button
                onClick={() => {
                  setUseLocalAuth(true);
                  setLoginError(null);
                }}
                className="w-full py-3 border border-slate-200 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-50 transition-all uppercase tracking-widest"
              >
                Usar acceso local
              </button>
            </div>
          ) : (
            <form onSubmit={handleLocalLogin} className="space-y-4 pt-4">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Use <span className="font-mono font-semibold text-slate-700">admin</span> /{' '}
                <span className="font-mono font-semibold text-slate-700">admin</span> contra el usuario email{' '}
                <span className="font-mono text-slate-700">{getDevAdminEmail()}</span> (registrado en Auth, no en .env).
                Créelo una vez con <span className="font-mono">npm run seed:dev-admin</span> (service role solo en esa
                orden, no en el front). Escriba contraseña <span className="font-mono">admin</span> (cumple el mínimo de 6
                caracteres de Supabase en desarrollo). OAuth opcional.
              </p>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Usuario (admin)"
                  className="input-modern"
                  value={localCredentials.user}
                  onChange={(e) => setLocalCredentials({ ...localCredentials, user: e.target.value })}
                  required
                />
                <input
                  type="password"
                  placeholder="Contraseña (admin)"
                  className="input-modern"
                  value={localCredentials.pass}
                  onChange={(e) => setLocalCredentials({ ...localCredentials, pass: e.target.value })}
                  required
                />
              </div>
              <button type="submit" className="btn-primary w-full">
                Entrar al Despacho
              </button>
              <button
                type="button"
                onClick={() => {
                  setUseLocalAuth(false);
                  setLoginError(null);
                }}
                className="w-full text-xs font-bold text-slate-400 hover:text-accent transition-all uppercase tracking-widest"
              >
                Volver a Google / Microsoft
              </button>
            </form>
          )}

          {loginError && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-4 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-medium"
            >
              {loginError}
            </motion.div>
          )}

          <div className="pt-6 border-t border-slate-50">
            <p className="text-center text-[10px] font-bold text-slate-300 uppercase tracking-widest">
              Rama Judicial • República de Colombia
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Nueva Tutela', path: '/new', icon: PlusCircle },
    { name: 'Expedientes', path: '/cases', icon: Gavel },
    { name: 'Estadísticas', path: '/estadisticas', icon: BarChart3 },
    { name: 'Plantillas', path: '/plantillas', icon: FileStack },
    { name: 'Equipo de trabajo', path: '/equipo', icon: Users },
    { name: 'Sincronización SGDE', path: '/sgde', icon: Search },
    { name: 'Configuración', path: '/settings', icon: Settings },
  ];

  const sidebarWidthClass = sidebarCollapsed ? 'md:pl-[72px]' : 'md:pl-[280px]';

  return (
    <div className="min-h-screen flex bg-bg text-slate-900 font-sans">
      <aside
        className={`hidden md:flex flex-col bg-primary text-white shrink-0 fixed left-0 top-0 z-30 h-screen border-r border-white/10 transition-[width] duration-200 ease-out ${
          sidebarCollapsed ? 'w-[72px]' : 'w-[280px]'
        }`}
      >
        <div className={`flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden ${sidebarCollapsed ? 'p-3' : 'p-8'}`}>
          <div
            className={`flex items-center gap-3 mb-8 shrink-0 ${sidebarCollapsed ? 'flex-col gap-4' : 'justify-between'}`}
          >
            <div className={`flex items-center gap-3 min-w-0 ${sidebarCollapsed ? 'flex-col' : ''}`}>
              <div className="bg-accent p-2 rounded-lg shrink-0">
                <Scale className="w-6 h-6 text-white" />
              </div>
              {!sidebarCollapsed && (
                <span className="text-xl font-bold tracking-tight text-white truncate">Tutelia</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSidebarCollapsed((c) => !c)}
              className="shrink-0 rounded-lg p-2 text-slate-400 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
              title={sidebarCollapsed ? 'Expandir menú' : 'Contraer menú'}
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? 'Expandir menú lateral' : 'Contraer menú lateral'}
            >
              {sidebarCollapsed ? <ChevronsRight className="w-5 h-5" /> : <ChevronsLeft className="w-5 h-5" />}
            </button>
          </div>

          {!sidebarCollapsed && (
            <div className="bg-white/5 p-4 rounded-xl border border-white/10 mb-8 shrink-0">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Despacho judicial</p>
              <p className="text-xs font-semibold text-white/90">Juzgado 051 Civil del Circuito de Bogotá D.C.</p>
            </div>
          )}

          <nav className={`space-y-1 flex-1 ${sidebarCollapsed ? 'pb-4' : ''}`}>
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  to={item.path}
                  title={sidebarCollapsed ? item.name : undefined}
                  onClick={
                    item.path === '/new'
                      ? () => intentFreshNewCaseFromMenu(location.pathname === '/new')
                      : undefined
                  }
                  className={`flex items-center rounded-xl text-sm font-medium transition-all ${
                    sidebarCollapsed ? 'justify-center px-2 py-3' : 'gap-3 px-4 py-3'
                  } ${
                    isActive
                      ? 'bg-accent text-white shadow-lg shadow-accent/20'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {!sidebarCollapsed && item.name}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className={`mt-auto border-t border-white/5 shrink-0 ${sidebarCollapsed ? 'p-3 flex justify-center' : 'p-8'}`}>
          <div className={`flex items-center gap-3 ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold overflow-hidden shadow-sm shrink-0">
              {user.photoURL ? <img src={user.photoURL} alt="" /> : user.email?.[0].toUpperCase()}
            </div>
            {!sidebarCollapsed && (
              <div className="flex-1 min-w-0 truncate">
                <p className="text-xs font-bold text-white truncate">{user.displayName || 'Funcionario'}</p>
                <p className="text-[10px] text-slate-500 font-medium tracking-wider">CONECTADO</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden transition-[padding] duration-200 ease-out ${sidebarWidthClass}`}>
        <header className="bg-white border-b border-slate-100 sticky top-0 z-10">
          <div className="px-10 py-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Resumen Operativo</h1>
              <p className="text-xs text-slate-500 font-medium mt-1">Gestión de tutelas y procesos electrónicos</p>
            </div>

            <div className="flex items-center gap-4">
              <AssignmentNotificationBell userId={user?.uid} />
              <div
                className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 rounded-full border border-green-100 text-[11px] font-bold max-w-[min(100%,320px)]"
                title={
                  profile?.name
                    ? `${profile.name} · ${userRoleLabelEs(profile.role)}`
                    : user?.displayName || undefined
                }
              >
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse shrink-0" />
                <span className="truncate">
                  {(() => {
                    const name = (profile?.name || user?.displayName || 'Usuario').trim();
                    const short = name.length > 34 ? `${name.slice(0, 32)}…` : name;
                    return `${short} · ACTIVO`;
                  })()}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="px-4 py-2 border border-slate-200 rounded-lg text-[11px] font-bold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cerrar sesión
              </button>
            </div>
          </div>

          <div className="h-[2px] w-full flex">
            <div className="bg-amber-400 w-1/3" />
            <div className="bg-blue-600 w-1/3" />
            <div className="bg-red-600 flex-1" />
          </div>
        </header>

        {localModeWithoutSupabase && (
          <div
            role="status"
            className="bg-amber-50 border-b border-amber-200 px-6 md:px-10 py-3 text-sm text-amber-950 flex items-start gap-3 shrink-0"
          >
            <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" aria-hidden />
            <p>
              <span className="font-semibold">Modo local sin sesión Supabase:</span> el acceso anónimo está desactivado o
              bloqueado. No podrá guardar en la base hasta ejecutar{' '}
              <span className="font-mono">npm run seed:dev-admin</span> e iniciar con admin / admin, habilitar Anonymous,
              o usar Google / Microsoft 365.
            </p>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-10 bg-bg">
          <SessionCourtProvider profile={profile}>
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </SessionCourtProvider>
        </main>
      </div>

      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black z-40 md:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              className="fixed inset-y-0 left-0 w-72 bg-white border-r border-[#141414] z-50 md:hidden flex flex-col"
            >
              <div className="p-6 flex items-center justify-between border-b border-[#141414]">
                <span className="text-xl font-black italic font-serif">Tutelia</span>
                <button type="button" onClick={() => setIsSidebarOpen(false)}>
                  <X className="w-6 h-6" />
                </button>
              </div>
              <nav className="flex-1 p-6 space-y-1">
                {navItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.name}
                      to={item.path}
                      onClick={() => setIsSidebarOpen(false)}
                      className={`flex items-center gap-3 px-4 py-4 font-mono text-base border-b ${
                        isActive ? 'bg-[#141414] text-white border-[#141414]' : 'border-transparent hover:bg-gray-50 transition-colors'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      {item.name}
                    </Link>
                  );
                })}
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
