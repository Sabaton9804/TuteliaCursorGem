import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { CaseType } from '../types';
import type { CourtRadicacionConfig } from '../lib/process-definition-types';
import type { ExpedienteAssignee } from '../lib/court-staff-types';
import { DEMO_DESPACHO_STAFF, demoSustanciadores } from '../lib/court-staff-demo-seed';
import { fetchCourtRadicacionConfig, defaultRadicacionConfig } from '../lib/court-radicacion-config';
import {
  fetchCourtStaffAssignees,
  setCourtStaffCache,
} from '../lib/court-staff-service';
import {
  getCachedNameByRole,
} from '../lib/court-staff-cache';
import {
  fetchEnabledProcessDefinitions,
  setProcessDefinitionsCache,
  getCachedProcessDefinitionByCaseType,
  type LoadedProcessDefinition,
} from '../lib/process-definitions-service';
import type { UserRole } from '../types';
import { COURT_CONSTANTS } from '../constants';
import { CUI_INSTANCE_PRIMERA, CUI_INSTANCE_SEGUNDA } from '../lib/radicado-cui';

export type CourtOperationalContextValue = {
  courtId: string;
  loading: boolean;
  radicacion: CourtRadicacionConfig;
  staff: readonly ExpedienteAssignee[];
  sustanciadores: readonly ExpedienteAssignee[];
  processDefinitions: readonly LoadedProcessDefinition[];
  nameByRole: (role: UserRole) => string;
  processForCaseType: (caseType: CaseType) => LoadedProcessDefinition | null;
  instanceCodeForCaseType: (caseType: CaseType) => string;
  refresh: () => Promise<void>;
};

const CourtOperationalContext = createContext<CourtOperationalContextValue | null>(null);

export function CourtOperationalProvider({
  courtId,
  children,
}: {
  courtId: string;
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(true);
  const [radicacion, setRadicacion] = useState<CourtRadicacionConfig>(() => defaultRadicacionConfig(courtId));
  const [staff, setStaff] = useState<readonly ExpedienteAssignee[]>(DEMO_DESPACHO_STAFF);
  const [sustanciadores, setSustanciadores] = useState<readonly ExpedienteAssignee[]>([]);
  const [processDefinitions, setProcessDefinitions] = useState<readonly LoadedProcessDefinition[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [rad, team, defs] = await Promise.all([
        fetchCourtRadicacionConfig(courtId),
        fetchCourtStaffAssignees(courtId),
        fetchEnabledProcessDefinitions(courtId),
      ]);
      setRadicacion(rad);
      setStaff(team.staff);
      setSustanciadores(team.sustanciadores);
      setProcessDefinitions(defs);
      setCourtStaffCache(courtId, team.staff, team.sustanciadores);
      setProcessDefinitionsCache(courtId, defs);
    } catch (e) {
      console.warn('[CourtOperationalProvider] load failed', e);
      const fallback = defaultRadicacionConfig(courtId);
      setRadicacion(fallback);
      setCourtStaffCache(courtId, DEMO_DESPACHO_STAFF, demoSustanciadores());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [courtId]);

  const value = useMemo<CourtOperationalContextValue>(
    () => ({
      courtId,
      loading,
      radicacion,
      staff,
      sustanciadores,
      processDefinitions,
      nameByRole: (role) => {
        const hit = staff.find((p) => p.courtRole === role);
        if (hit?.name?.trim()) return hit.name.trim();
        return getCachedNameByRole(role, courtId);
      },
      processForCaseType: (caseType) => getCachedProcessDefinitionByCaseType(caseType),
      instanceCodeForCaseType: (caseType) => {
        const def = getCachedProcessDefinitionByCaseType(caseType);
        if (def?.instance_level && def.instance_level >= 2) return CUI_INSTANCE_SEGUNDA;
        return CUI_INSTANCE_PRIMERA;
      },
      refresh: load,
    }),
    [courtId, loading, radicacion, staff, sustanciadores, processDefinitions],
  );

  return <CourtOperationalContext.Provider value={value}>{children}</CourtOperationalContext.Provider>;
}

export function useCourtOperational(): CourtOperationalContextValue {
  const ctx = useContext(CourtOperationalContext);
  if (!ctx) {
    throw new Error('useCourtOperational debe usarse dentro de CourtOperationalProvider (Shell autenticado).');
  }
  return ctx;
}

/** Prefijo CUI para UI de radicación (compatible con buildRadicadoPrimeraInstancia). */
export function radicacionCourtPrefixFromConfig(
  config: CourtRadicacionConfig,
  instanceCode = COURT_CONSTANTS.INSTANCE_CODE,
) {
  return {
    cityCode: config.daneCode,
    entityCode: config.entityCode,
    specialtyCode: config.specialtyCode,
    despachoCode: config.despachoNumber,
    instanceCode,
  };
}

export function buildRadicacionYearPrefix(config: CourtRadicacionConfig, year = new Date().getFullYear()): string {
  return `${config.daneCode}${config.entityCode}${config.specialtyCode}${config.despachoNumber}${year}`;
}
