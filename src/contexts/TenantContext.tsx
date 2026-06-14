import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { UserProfile, UserRole } from '../types';
import { DEFAULT_DEMO_COURT_ID } from '../lib/default-court';
import { parseUserRole } from '../lib/user-roles';
import { supabase } from '../lib/supabase';
import {
  dispatchTenantScopeChanged,
  getViewAsCourtIdFromStorage,
  setViewAsCourtIdInStorage,
  TENANT_SCOPE_CHANGED_EVENT,
} from '../lib/tenant-storage';
import { resolveTenantScope, type TenantScope } from '../services/tenantScope';

export type ProfileCourtMembership = {
  id: string;
  courtId: string;
  role: UserRole;
  isDefault: boolean;
};

export type TenantContextValue = TenantScope & {
  profile: UserProfile | null;
  /** Alias operativo para CourtOperationalProvider y rutas legacy. */
  courtId: string;
  memberships: ProfileCourtMembership[];
  loading: boolean;
  setViewAsCourtId: (courtId: string | null) => Promise<void>;
  setActiveCourtId: (courtId: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const TenantContext = createContext<TenantContextValue | null>(null);

function rowToMembership(row: Record<string, unknown>): ProfileCourtMembership {
  return {
    id: String(row.id),
    courtId: String(row.court_id),
    role: parseUserRole(row.role),
    isDefault: row.is_default === true,
  };
}

export function TenantProvider({
  profile,
  userId,
  children,
}: {
  profile: UserProfile | null;
  userId: string | undefined;
  children: React.ReactNode;
}) {
  const [memberships, setMemberships] = useState<ProfileCourtMembership[]>([]);
  const [isPlatformAdminRow, setIsPlatformAdminRow] = useState(false);
  const [regionalTerritoryIds, setRegionalTerritoryIds] = useState<string[]>([]);
  const [viewAsCourtId, setViewAsState] = useState<string | null>(() => getViewAsCourtIdFromStorage());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setMemberships([]);
      setIsPlatformAdminRow(false);
      setRegionalTerritoryIds([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [memRes, adminRes, regionalRes] = await Promise.all([
        supabase
          .from('profile_court_memberships')
          .select('id, court_id, role, is_default')
          .eq('profile_id', userId),
        supabase.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
        supabase.from('platform_regional_admins').select('territory_id').eq('user_id', userId),
      ]);
      if (memRes.error) console.warn('[TenantProvider] memberships', memRes.error.message);
      if (regionalRes.error) console.warn('[TenantProvider] regional', regionalRes.error.message);
      setMemberships((memRes.data ?? []).map((r) => rowToMembership(r as Record<string, unknown>)));
      setIsPlatformAdminRow(Boolean(adminRes.data?.user_id));
      setRegionalTerritoryIds(
        (regionalRes.data ?? []).map((r) => String(r.territory_id)).filter(Boolean)
      );
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onStorage = () => setViewAsState(getViewAsCourtIdFromStorage());
    window.addEventListener(TENANT_SCOPE_CHANGED_EVENT, onStorage);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(TENANT_SCOPE_CHANGED_EVENT, onStorage);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const isPlatformAdmin = Boolean(profile?.isSuperuser || isPlatformAdminRow);
  const isRegionalPlatformAdmin = !isPlatformAdmin && regionalTerritoryIds.length > 0;

  const activeCourtId = useMemo(() => {
    const defaultMem = memberships.find((m) => m.isDefault);
    if (defaultMem?.courtId?.trim()) return defaultMem.courtId.trim();
    const raw = profile?.courtId?.trim();
    if (raw && raw.length > 0) return raw;
    return DEFAULT_DEMO_COURT_ID;
  }, [memberships, profile?.courtId]);

  const scope = useMemo(
    () =>
      resolveTenantScope({
        profile,
        activeCourtId,
        viewAsCourtId,
        isPlatformAdmin,
        isRegionalPlatformAdmin,
        regionalTerritoryIds,
      }),
    [profile, activeCourtId, viewAsCourtId, isPlatformAdmin, isRegionalPlatformAdmin, regionalTerritoryIds]
  );

  const setViewAsCourtId = useCallback(
    async (courtId: string | null) => {
      const next = courtId?.trim() || null;
      setViewAsCourtIdInStorage(next);
      setViewAsState(next);
      dispatchTenantScopeChanged();
      if (scope.canAccessPlatformConsole && userId) {
        try {
          await supabase.rpc('log_platform_action', {
            p_action: next ? 'view_as_set' : 'view_as_clear',
            p_target_court_id: next,
            p_metadata: {},
          });
        } catch (e) {
          console.warn('[TenantProvider] audit log', e);
        }
      }
    },
    [scope.canAccessPlatformConsole, userId]
  );

  const setActiveCourtId = useCallback(
    async (courtId: string) => {
      if (!userId) return;
      const cid = courtId.trim();
      if (!cid) return;
      await supabase
        .from('profile_court_memberships')
        .update({ is_default: false })
        .eq('profile_id', userId);
      const { error } = await supabase.from('profile_court_memberships').upsert(
        {
          profile_id: userId,
          court_id: cid,
          role: profile?.role ?? 'clerk',
          is_default: true,
        },
        { onConflict: 'profile_id,court_id' }
      );
      if (error) throw error;
      await supabase.from('profiles').update({ court_id: cid }).eq('id', userId);
      await load();
      dispatchTenantScopeChanged();
    },
    [userId, profile?.role, load]
  );

  const courtId = scope.effectiveCourtId ?? scope.activeCourtId ?? DEFAULT_DEMO_COURT_ID;

  const value = useMemo<TenantContextValue>(
    () => ({
      ...scope,
      profile,
      courtId,
      memberships,
      loading,
      setViewAsCourtId,
      setActiveCourtId,
      refresh: load,
    }),
    [scope, profile, courtId, memberships, loading, setViewAsCourtId, setActiveCourtId, load]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error('useTenant debe usarse dentro de TenantProvider (Shell autenticado).');
  }
  return ctx;
}
