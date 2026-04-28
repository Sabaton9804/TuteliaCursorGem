import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { 
  Gavel, 
  LayoutDashboard, 
  PlusCircle, 
  Settings, 
  LogOut, 
  Bell,
  Scale,
  Menu,
  X,
  Search
} from 'lucide-react';
import { auth, db } from '../../lib/firebase';
import { onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup, signInAnonymously } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { UserProfile } from '../../types';
import { motion, AnimatePresence } from 'motion/react';

interface ShellProps {
  children: React.ReactNode;
}

export default function Shell({ children }: ShellProps) {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [useLocalAuth, setUseLocalAuth] = useState(false);
  const [localCredentials, setLocalCredentials] = useState({ user: '', pass: '' });
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Check for local session first
    const savedUser = localStorage.getItem('tutelia_mock_user');
    if (savedUser) {
      const u = JSON.parse(savedUser);
      setUser(u);
      setProfile({
        id: u.uid,
        email: u.email,
        name: u.displayName,
        role: 'admin',
        courtId: 'court-1'
      });
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setLoginError(null);
        // Try to get profile
        const profileRef = doc(db, 'courts', 'court-1', 'users', u.uid);
        try {
          const profileSnap = await getDoc(profileRef);
          if (profileSnap.exists()) {
            setProfile(profileSnap.data() as UserProfile);
          } else {
            // AUTO-MEMBER for demo purposes
            const newProfile: UserProfile = {
              id: u.uid,
              email: u.email || '',
              name: u.displayName || 'Funcionario',
              role: 'admin',
              courtId: 'court-1'
            };
            await setDoc(profileRef, newProfile);
            setProfile(newProfile);
          }
        } catch (e) {
          console.error("Could not handle profile setup", e);
        }
        setUser(u);
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (localCredentials.user === 'admin' && localCredentials.pass === 'admin') {
      try {
        // Sign in anonymously so Firestore recognizes an authenticated session
        const userCred = await signInAnonymously(auth);
        const mockUser = {
          uid: userCred.user.uid,
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
          courtId: 'court-1'
        });
      } catch (err) {
        console.error("Local login failed at auth level", err);
        setLoginError("Error al inicializar sesión segura local.");
      }
    } else {
      setLoginError("Credenciales locales incorrectas. Use admin / admin.");
    }
  };

  const handleLogin = async () => {
    setLoginError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Login failed", error);
      if (error.code === 'auth/network-request-failed') {
        setLoginError("Error de red: El navegador no puede conectar con los servidores de autenticación. Por favor, asegúrese de no tener ad-blockers activados y de estar usando una ventana normal (no incógnito).");
      } else if (error.code === 'auth/popup-blocked') {
        setLoginError("El navegador bloqueó la ventana emergente. Por favor, permita las ventanas emergentes para este sitio.");
      } else {
        setLoginError("Error al iniciar sesión: " + (error.message || "Error desconocido"));
      }
    }
  };

  const handleLogout = async () => {
    localStorage.removeItem('tutelia_mock_user');
    await signOut(auth);
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

  if (!user) {
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

          {!useLocalAuth ? (
            <div className="space-y-4 pt-4">
              <button 
                onClick={handleLogin}
                className="btn-primary w-full flex items-center justify-center gap-3"
              >
                Ingresar con Google
              </button>
              <button 
                onClick={() => { setUseLocalAuth(true); setLoginError(null); }}
                className="w-full py-3 border border-slate-200 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-50 transition-all uppercase tracking-widest"
              >
                Usar acceso local
              </button>
            </div>
          ) : (
            <form onSubmit={handleLocalLogin} className="space-y-4 pt-4">
              <div className="space-y-3">
                <input 
                  type="text" 
                  placeholder="Usuario (admin)" 
                  className="input-modern"
                  value={localCredentials.user}
                  onChange={(e) => setLocalCredentials({...localCredentials, user: e.target.value})}
                  required
                />
                <input 
                  type="password" 
                  placeholder="Contraseña (admin)" 
                  className="input-modern"
                  value={localCredentials.pass}
                  onChange={(e) => setLocalCredentials({...localCredentials, pass: e.target.value})}
                  required
                />
              </div>
              <button 
                type="submit"
                className="btn-primary w-full"
              >
                Entrar al Despacho
              </button>
              <button 
                type="button"
                onClick={() => { setUseLocalAuth(false); setLoginError(null); }}
                className="w-full text-xs font-bold text-slate-400 hover:text-accent transition-all uppercase tracking-widest"
              >
                Volver a Google Login
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
    { name: 'Sincronización SGDE', path: '/sgde', icon: Search },
    { name: 'Configuración', path: '/settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen flex bg-bg text-slate-900 font-sans">
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex flex-col w-[280px] bg-primary text-white shrink-0">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-10">
            <div className="bg-accent p-2 rounded-lg">
              <Scale className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">Tutelia</span>
          </div>

          <div className="bg-white/5 p-4 rounded-xl border border-white/10 mb-8">
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Despacho judicial</p>
            <p className="text-xs font-semibold text-white/90">Juzgado 051 Civil del Circuito de Bogotá D.C.</p>
          </div>
          
          <nav className="space-y-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              const Icon = item.icon;
              return (
                <Link 
                  key={item.name} 
                  to={item.path}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                    isActive 
                      ? 'bg-accent text-white shadow-lg shadow-accent/20' 
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>
        
        <div className="mt-auto p-8 border-t border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold overflow-hidden shadow-sm">
               {user.photoURL ? <img src={user.photoURL} alt="" /> : user.email?.[0].toUpperCase()}
            </div>
            <div className="flex-1 truncate">
               <p className="text-xs font-bold text-white truncate">{user.displayName || 'Funcionario'}</p>
               <p className="text-[10px] text-slate-500 font-medium tracking-wider">CONECTADO</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="bg-white border-b border-slate-100 sticky top-0 z-10">
          <div className="px-10 py-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Resumen Operativo
              </h1>
              <p className="text-xs text-slate-500 font-medium mt-1">Gestión de tutelas y procesos electrónicos</p>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 rounded-full border border-green-100 text-[11px] font-bold">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                Juez 1 • ACTIVO
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

        <main className="flex-1 overflow-y-auto p-10 bg-bg">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile Sidebar Overlay */}
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
                <button onClick={() => setIsSidebarOpen(false)}>
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
                      className={`flex items-center gap-3 px-4 py-4 font-mono text-base border-b ${isActive ? 'bg-[#141414] text-white border-[#141414]' : 'border-transparent hover:bg-gray-50 transition-colors'}`}
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
