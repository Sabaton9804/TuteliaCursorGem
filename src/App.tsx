import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Shell from './components/layout/Shell';
import Dashboard from './pages/Dashboard';
import NewCase from './pages/NewCase';
import CaseDetail from './pages/CaseDetail';
import Settings from './pages/Settings';

export default function App() {
  return (
    <Router>
      <Shell>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<NewCase />} />
          <Route path="/case/:id" element={<CaseDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Shell>
    </Router>
  );
}
