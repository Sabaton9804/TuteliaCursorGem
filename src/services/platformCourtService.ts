import { supabase } from '../lib/supabase';
import { platformFetchJson } from '../lib/platform-api';
import { LIST_PAGE_SIZE_DEFAULT, supabaseRange } from '../lib/list-pagination';

export type PlatformCourtFilters = {
  q?: string;
  status?: string;
  judicialSpecialtyId?: string;
  territoryId?: string;
  entityCategoryId?: string;
};

export type PlatformCourtRow = {
  id: string;
  name: string;
  email: string;
  city: string;
  status: string;
  official_name: string | null;
  dane_code: string | null;
  entity_code: string | null;
  specialty_code: string | null;
  despacho_number: string | null;
  territory_id: string | null;
  judicial_specialty_id: string | null;
  entity_category_id: string | null;
  judicial_territories?: { name: string; department: string } | null;
  judicial_specialties?: { code: string; label: string } | null;
  judicial_entity_categories?: { code: string; label: string } | null;
};

export type PlatformCourtListResult = {
  rows: PlatformCourtRow[];
  total: number;
};

export type PlatformCourtKpis = {
  total: number;
  active: number;
};

const COURT_SELECT = `
  id, name, email, city, status, official_name,
  dane_code, entity_code, specialty_code, despacho_number,
  territory_id, judicial_specialty_id, entity_category_id,
  judicial_territories ( name, department ),
  judicial_specialties ( code, label ),
  judicial_entity_categories ( code, label )
`;

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function mapCourtRow(raw: Record<string, unknown>): PlatformCourtRow {
  return {
    ...(raw as PlatformCourtRow),
    judicial_territories: relationOne(raw.judicial_territories as PlatformCourtRow['judicial_territories']),
    judicial_specialties: relationOne(raw.judicial_specialties as PlatformCourtRow['judicial_specialties']),
    judicial_entity_categories: relationOne(
      raw.judicial_entity_categories as PlatformCourtRow['judicial_entity_categories']
    ),
  };
}

export async function fetchPlatformCourtKpis(regionalTerritoryIds?: string[]): Promise<PlatformCourtKpis> {
  let totalQuery = supabase.from('courts').select('*', { count: 'exact', head: true });
  let activeQuery = supabase.from('courts').select('*', { count: 'exact', head: true }).eq('status', 'active');
  if (regionalTerritoryIds?.length) {
    totalQuery = totalQuery.in('territory_id', regionalTerritoryIds);
    activeQuery = activeQuery.in('territory_id', regionalTerritoryIds);
  }
  const [totalRes, activeRes] = await Promise.all([totalQuery, activeQuery]);
  if (totalRes.error) throw totalRes.error;
  if (activeRes.error) throw activeRes.error;
  return {
    total: totalRes.count ?? 0,
    active: activeRes.count ?? 0,
  };
}

export async function fetchPlatformCourtsPage(
  page: number,
  pageSize: number,
  filters: PlatformCourtFilters,
  regionalTerritoryIds?: string[]
): Promise<PlatformCourtListResult> {
  const { from, to } = supabaseRange(page, pageSize);
  let query = supabase.from('courts').select(COURT_SELECT, { count: 'exact' });

  if (regionalTerritoryIds?.length) {
    query = query.in('territory_id', regionalTerritoryIds);
  }

  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status);
  }
  if (filters.judicialSpecialtyId) {
    query = query.eq('judicial_specialty_id', filters.judicialSpecialtyId);
  }
  if (filters.territoryId) {
    query = query.eq('territory_id', filters.territoryId);
  }
  if (filters.entityCategoryId) {
    query = query.eq('entity_category_id', filters.entityCategoryId);
  }
  const q = filters.q?.trim();
  if (q) {
    query = query.or(`name.ilike.%${q}%,id.ilike.%${q}%,city.ilike.%${q}%`);
  }

  query = query.order('name').range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;
  return {
    rows: (data ?? []).map((row) => mapCourtRow(row as Record<string, unknown>)),
    total: count ?? 0,
  };
}

export async function fetchPlatformCourtById(courtId: string): Promise<PlatformCourtRow | null> {
  const { data, error } = await supabase
    .from('courts')
    .select(COURT_SELECT)
    .eq('id', courtId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapCourtRow(data as Record<string, unknown>) : null;
}

export async function fetchCourtStaff(courtId: string) {
  const { data, error } = await supabase
    .from('profile_court_memberships')
    .select('id, role, is_default, profiles ( id, name, email, role )')
    .eq('court_id', courtId)
    .order('is_default', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchCourtAuditLog(courtId: string, limit = 30) {
  const { data, error } = await supabase
    .from('platform_audit_log')
    .select('id, action, user_id, metadata, created_at')
    .eq('target_court_id', courtId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export type JudicialCatalogs = {
  territories: { id: string; name: string; department: string; dane_code: string }[];
  specialties: { id: string; code: string; label: string }[];
  categories: { id: string; code: string; label: string }[];
};

export async function fetchJudicialCatalogs(): Promise<JudicialCatalogs> {
  const [t, s, c] = await Promise.all([
    supabase.from('judicial_territories').select('id, name, department, dane_code').order('name'),
    supabase.from('judicial_specialties').select('id, code, label').order('label'),
    supabase.from('judicial_entity_categories').select('id, code, label').order('label'),
  ]);
  if (t.error) throw t.error;
  if (s.error) throw s.error;
  if (c.error) throw c.error;
  return {
    territories: (t.data ?? []) as JudicialCatalogs['territories'],
    specialties: (s.data ?? []) as JudicialCatalogs['specialties'],
    categories: (c.data ?? []) as JudicialCatalogs['categories'],
  };
}

export async function createPlatformCourt(body: Record<string, unknown>) {
  return platformFetchJson<{ courtId: string; adminUserId: string | null }>('/api/platform/courts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function invitePlatformCourtUser(courtId: string, body: Record<string, unknown>) {
  return platformFetchJson<{ userId: string; email: string; role: string }>(
    `/api/platform/courts/${encodeURIComponent(courtId)}/users`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    }
  );
}

export type BulkImportSummary = {
  inserted: number;
  updated: number;
  errors: number;
};

export type BulkImportResult = {
  summary: BulkImportSummary;
  results: Array<{
    row_num: number;
    court_id: string | null;
    action: string;
    message: string | null;
  }>;
};

export async function bulkImportPlatformCourts(rows: Record<string, string>[]): Promise<BulkImportResult> {
  return platformFetchJson<BulkImportResult>('/api/platform/courts/bulk-import', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });
}

export async function updateCourtStatus(courtId: string, status: 'active' | 'inactive' | 'suspended') {
  const { error } = await supabase.from('courts').update({ status, updated_at: new Date().toISOString() }).eq('id', courtId);
  if (error) throw error;
}

export type RegionalAdminRow = {
  user_id: string;
  territory_id: string;
  notes: string | null;
  created_at: string;
  judicial_territories: { name: string; department: string; dane_code: string } | null;
  profiles: { name: string; email: string | null } | null;
};

export async function fetchRegionalAdmins(): Promise<RegionalAdminRow[]> {
  const { data, error } = await supabase
    .from('platform_regional_admins')
    .select(
      'user_id, territory_id, notes, created_at, judicial_territories ( name, department, dane_code ), profiles ( name, email )'
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const pick = <T>(v: T | T[] | null | undefined): T | null =>
      v == null ? null : Array.isArray(v) ? v[0] ?? null : v;
    return {
      ...(r as RegionalAdminRow),
      judicial_territories: pick(r.judicial_territories as RegionalAdminRow['judicial_territories']),
      profiles: pick(r.profiles as RegionalAdminRow['profiles']),
    };
  });
}

export async function grantRegionalAdmin(body: { email: string; territoryId: string; notes?: string }) {
  return platformFetchJson<{ userId: string; email: string; territoryId: string }>(
    '/api/platform/regional-admins',
    { method: 'POST', body: JSON.stringify(body) }
  );
}

export async function revokeRegionalAdmin(body: { userId: string; territoryId: string }) {
  return platformFetchJson<{ ok: boolean }>('/api/platform/regional-admins', {
    method: 'DELETE',
    body: JSON.stringify(body),
  });
}

export { LIST_PAGE_SIZE_DEFAULT };
