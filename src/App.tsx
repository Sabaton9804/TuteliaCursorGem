import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Shell from './components/layout/Shell';
import Dashboard from './pages/Dashboard';
import NewCase from './pages/NewCase';
import ImportFromSgde from './pages/ImportFromSgde';
import CaseDetail from './pages/CaseDetail';
import CasesList from './pages/CasesList';
import Settings from './pages/Settings';
import Team from './pages/Team';
import Tasks from './pages/Tasks';
import Estadisticas from './pages/Estadisticas';
import BibliotecaPrecedentes from './pages/BibliotecaPrecedentes';
import SgdeSync from './pages/SgdeSync';
import Correo from './pages/Correo';
import CorreoPendientes from './pages/CorreoPendientes';
import CorreoContestaciones from './pages/CorreoContestaciones';
import CorreoRoadmap from './pages/CorreoRoadmap';
import SustanciadorTablero from './pages/SustanciadorTablero';

const Plantillas = lazy(() => import('./pages/Plantillas'));

export default function App() {
  return (
    <Router>
      <Shell>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<NewCase />} />
          <Route path="/import-sgde" element={<ImportFromSgde />} />
          <Route path="/cases" element={<CasesList />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/estadisticas" element={<Estadisticas />} />
          <Route path="/biblioteca-precedentes" element={<BibliotecaPrecedentes />} />
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
          <Route path="/sgde" element={<SgdeSync />} />
          <Route path="/correo" element={<Correo />} />
          <Route path="/correo/pendientes" element={<CorreoPendientes />} />
          <Route path="/correo/contestaciones" element={<CorreoContestaciones />} />
          <Route path="/sustanciador" element={<SustanciadorTablero />} />
          <Route path="/docs/roadmap" element={<CorreoRoadmap />} />
        </Routes>
      </Shell>
    </Router>
  );
}
