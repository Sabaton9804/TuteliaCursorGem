import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Shell from './components/layout/Shell';
import Dashboard from './pages/Dashboard';
import NewCase from './pages/NewCase';
import CaseDetail from './pages/CaseDetail';
import CasesList from './pages/CasesList';
import Settings from './pages/Settings';
import Team from './pages/Team';
import Estadisticas from './pages/Estadisticas';

const Plantillas = lazy(() => import('./pages/Plantillas'));

export default function App() {
  return (
    <Router>
      <Shell>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<NewCase />} />
          <Route path="/cases" element={<CasesList />} />
          <Route path="/estadisticas" element={<Estadisticas />} />
          <Route path="/case/:id" element={<CaseDetail />} />
          <Route
            path="/plantillas"
            element={
              <Suspense
                fallback={
                  <div className="flex min-h-[40vh] items-center justify-center text-sm font-medium text-slate-500">
                    Cargando plantillas…
                  </div>
                }
              >
                <Plantillas />
              </Suspense>
            }
          />
          <Route path="/settings" element={<Settings />} />
          <Route path="/equipo" element={<Team />} />
        </Routes>
      </Shell>
    </Router>
  );
}
