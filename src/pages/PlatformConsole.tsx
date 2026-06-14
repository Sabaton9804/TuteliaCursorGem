import React from 'react';
import { Route, Routes } from 'react-router-dom';
import PlatformConsoleGuard from '../components/platform/PlatformConsoleGuard';
import PlatformCourtList from '../components/platform/PlatformCourtList';
import PlatformCourtDetailView from '../components/platform/PlatformCourtDetailView';
import PlatformRegionalAdminsPage from './PlatformRegionalAdmins';

export default function PlatformConsole() {
  return (
    <PlatformConsoleGuard>
      <Routes>
        <Route index element={<PlatformCourtList />} />
        <Route path="regional" element={<PlatformRegionalAdminsPage />} />
        <Route path="courts/:courtId" element={<PlatformCourtDetailView />} />
      </Routes>
    </PlatformConsoleGuard>
  );
}
