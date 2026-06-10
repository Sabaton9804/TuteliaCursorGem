import type { Request } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MailboxGraphTarget } from './outlook-mailbox-target';
import { normalizeMailboxUpn } from './outlook-mailbox-target';
import {
  getOutlookConnection,
  getValidOutlookAccessToken,
  type OutlookConnectionRow,
} from './outlook-graph';
import {
  isOutlookAllowLegacyMe,
  isOutlookRequireExplicitMailbox,
} from './outlook-config';

export type CourtMailboxRow = {
  id: string;
  court_id: string;
  mailbox_upn: string;
  display_name: string;
  is_primary: boolean;
  is_active: boolean;
};

export type ResolvedOutlookContext = {
  accessToken: string;
  userId: string;
  courtId: string;
  graphTarget: MailboxGraphTarget;
  graphMode: 'legacy_me' | 'shared_mailbox';
  mailboxId: string | null;
  mailboxUpn: string | null;
  oauthAccountEmail: string;
};

export type ResolveOutlookContextResult =
  | { ok: true; ctx: ResolvedOutlookContext }
  | { ok: false; status: number; message: string };

type OutlookConnectionExtended = OutlookConnectionRow & {
  graph_mode?: 'legacy_me' | 'shared_mailbox' | null;
  active_court_id?: string | null;
  active_mailbox_id?: string | null;
};

export async function userHasCourtAccess(
  admin: SupabaseClient,
  userId: string,
  courtId: string
): Promise<boolean> {
  const { data: prof, error } = await admin
    .from('profiles')
    .select('court_id, is_superuser')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (prof?.is_superuser) return true;

  const { data: memb } = await admin
    .from('profile_court_memberships')
    .select('id')
    .eq('profile_id', userId)
    .eq('court_id', courtId)
    .maybeSingle();
  if (memb) return true;

  return String(prof?.court_id || '') === courtId;
}

async function loadCourtMailbox(
  admin: SupabaseClient,
  mailboxId: string
): Promise<CourtMailboxRow | null> {
  const { data, error } = await admin
    .from('court_mailboxes')
    .select('id, court_id, mailbox_upn, display_name, is_primary, is_active')
    .eq('id', mailboxId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return data as CourtMailboxRow | null;
}

async function loadPrimaryCourtMailbox(
  admin: SupabaseClient,
  courtId: string
): Promise<CourtMailboxRow | null> {
  const { data, error } = await admin
    .from('court_mailboxes')
    .select('id, court_id, mailbox_upn, display_name, is_primary, is_active')
    .eq('court_id', courtId)
    .eq('is_active', true)
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as CourtMailboxRow | null;
}

async function courtHasConfiguredMailboxes(admin: SupabaseClient, courtId: string): Promise<boolean> {
  const { count, error } = await admin
    .from('court_mailboxes')
    .select('id', { count: 'exact', head: true })
    .eq('court_id', courtId)
    .eq('is_active', true);
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function resolveDefaultCourtId(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data: defMem } = await admin
    .from('profile_court_memberships')
    .select('court_id')
    .eq('profile_id', userId)
    .eq('is_default', true)
    .maybeSingle();
  if (defMem?.court_id) return String(defMem.court_id);

  const { data: anyMem } = await admin
    .from('profile_court_memberships')
    .select('court_id')
    .eq('profile_id', userId)
    .limit(1)
    .maybeSingle();
  if (anyMem?.court_id) return String(anyMem.court_id);

  const { data: prof } = await admin.from('profiles').select('court_id').eq('id', userId).maybeSingle();
  return prof?.court_id ? String(prof.court_id) : null;
}

function parseMailboxIdFromRequest(req: Request): string | undefined {
  const hdr = String(req.headers['x-tutelia-mailbox-id'] || '').trim();
  if (hdr) return hdr;
  const q = typeof req.query.mailboxId === 'string' ? req.query.mailboxId.trim() : '';
  if (q) return q;
  const body = req.body as { mailboxId?: unknown; courtId?: unknown } | undefined;
  if (body && typeof body.mailboxId === 'string' && body.mailboxId.trim()) {
    return body.mailboxId.trim();
  }
  return undefined;
}

function parseCourtIdFromRequest(req: Request): string | undefined {
  const body = req.body as { courtId?: unknown } | undefined;
  if (body && typeof body.courtId === 'string' && body.courtId.trim()) {
    return body.courtId.trim();
  }
  const q = typeof req.query.courtId === 'string' ? req.query.courtId.trim() : '';
  return q || undefined;
}

function sharedTargetFromRow(row: CourtMailboxRow): MailboxGraphTarget {
  return { mode: 'shared', upn: normalizeMailboxUpn(row.mailbox_upn) };
}

export async function listUserCourtMailboxes(
  admin: SupabaseClient,
  userId: string
): Promise<
  Array<CourtMailboxRow & { courtName: string }>
> {
  const { data: memberships, error: memErr } = await admin
    .from('profile_court_memberships')
    .select('court_id')
    .eq('profile_id', userId);
  if (memErr) throw memErr;

  const courtIds = new Set<string>();
  for (const m of memberships || []) {
    if (m.court_id) courtIds.add(String(m.court_id));
  }

  const { data: prof } = await admin.from('profiles').select('court_id, is_superuser').eq('id', userId).maybeSingle();
  if (prof?.court_id) courtIds.add(String(prof.court_id));

  if (prof?.is_superuser) {
    const { data: allCourts } = await admin.from('courts').select('id');
    for (const c of allCourts || []) courtIds.add(String(c.id));
  }

  if (!courtIds.size) return [];

  const { data: boxes, error: boxErr } = await admin
    .from('court_mailboxes')
    .select('id, court_id, mailbox_upn, display_name, is_primary, is_active')
    .in('court_id', [...courtIds])
    .eq('is_active', true)
    .order('is_primary', { ascending: false });
  if (boxErr) throw boxErr;

  const { data: courts } = await admin.from('courts').select('id, name').in('id', [...courtIds]);
  const nameById = new Map((courts || []).map((c) => [String(c.id), String(c.name || c.id)]));

  return (boxes || []).map((b) => ({
    ...(b as CourtMailboxRow),
    courtName: nameById.get(String(b.court_id)) || String(b.court_id),
  }));
}

export async function setUserOutlookMailboxContext(
  admin: SupabaseClient,
  userId: string,
  mailboxId: string
): Promise<{ courtId: string; mailbox: CourtMailboxRow }> {
  const row = await loadCourtMailbox(admin, mailboxId);
  if (!row) throw new Error('Buzón no encontrado o inactivo.');

  const allowed = await userHasCourtAccess(admin, userId, row.court_id);
  if (!allowed) throw new Error('No tiene permiso para este despacho.');

  const { error } = await admin
    .from('outlook_connections')
    .update({
      graph_mode: 'shared_mailbox',
      active_court_id: row.court_id,
      active_mailbox_id: row.id,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (error) throw error;

  return { courtId: row.court_id, mailbox: row };
}

export async function resolveOutlookContext(
  req: Request,
  admin: SupabaseClient,
  userId: string
): Promise<ResolveOutlookContextResult> {
  let conn: OutlookConnectionExtended | null;
  try {
    conn = (await getOutlookConnection(admin, userId)) as OutlookConnectionExtended | null;
  } catch (e) {
    return { ok: false, status: 500, message: String((e as Error).message || 'Error de conexión.') };
  }
  if (!conn) {
    return { ok: false, status: 409, message: 'Outlook no conectado para este usuario.' };
  }

  let accessToken: string;
  let oauthAccountEmail: string;
  try {
    const tokens = await getValidOutlookAccessToken(admin, userId);
    accessToken = tokens.accessToken;
    oauthAccountEmail = tokens.mailboxEmail;
  } catch (e) {
    const msg = String((e as Error).message || '');
    return { ok: false, status: msg.includes('no conectado') ? 409 : 502, message: msg };
  }

  const reqMailboxId = parseMailboxIdFromRequest(req);
  const reqCourtId = parseCourtIdFromRequest(req);

  const resolveShared = async (row: CourtMailboxRow): Promise<ResolveOutlookContextResult> => {
    const allowed = await userHasCourtAccess(admin, userId, row.court_id);
    if (!allowed) {
      return { ok: false, status: 403, message: 'No tiene permiso para el buzón de este despacho.' };
    }
    return {
      ok: true,
      ctx: {
        accessToken,
        userId,
        courtId: row.court_id,
        graphTarget: sharedTargetFromRow(row),
        graphMode: 'shared_mailbox',
        mailboxId: row.id,
        mailboxUpn: row.mailbox_upn,
        oauthAccountEmail,
      },
    };
  };

  if (reqMailboxId) {
    const row = await loadCourtMailbox(admin, reqMailboxId);
    if (!row) return { ok: false, status: 404, message: 'Buzón no encontrado.' };
    return resolveShared(row);
  }

  if (reqCourtId) {
    const hasBoxes = await courtHasConfiguredMailboxes(admin, reqCourtId);
    if (hasBoxes) {
      const primary = await loadPrimaryCourtMailbox(admin, reqCourtId);
      if (!primary) {
        return {
          ok: false,
          status: 400,
          message: 'Este despacho tiene buzones configurados. Indique mailboxId explícito.',
        };
      }
      return resolveShared(primary);
    }
  }

  if (conn.active_mailbox_id) {
    const row = await loadCourtMailbox(admin, String(conn.active_mailbox_id));
    if (row) return resolveShared(row);
  }

  const defaultCourt = await resolveDefaultCourtId(admin, userId);
  if (!defaultCourt) {
    return { ok: false, status: 403, message: 'Perfil sin despacho asignado.' };
  }

  const hasBoxes = await courtHasConfiguredMailboxes(admin, defaultCourt);

  if (hasBoxes && isOutlookRequireExplicitMailbox()) {
    return {
      ok: false,
      status: 400,
      message:
        'Seleccione el buzón del despacho en Tutelia antes de operar el correo. Use el selector de buzón o PUT /api/outlook/context.',
    };
  }

  if (hasBoxes && !isOutlookRequireExplicitMailbox()) {
    const primary = await loadPrimaryCourtMailbox(admin, defaultCourt);
    if (primary) return resolveShared(primary);
  }

  if (isOutlookAllowLegacyMe()) {
    return {
      ok: true,
      ctx: {
        accessToken,
        userId,
        courtId: conn.active_court_id || defaultCourt,
        graphTarget: { mode: 'me' },
        graphMode: 'legacy_me',
        mailboxId: null,
        mailboxUpn: null,
        oauthAccountEmail,
      },
    };
  }

  return {
    ok: false,
    status: 400,
    message: 'Configure un buzón compartido del despacho o habilite OUTLOOK_ALLOW_LEGACY_ME.',
  };
}

export async function getOutlookContextSnapshot(
  admin: SupabaseClient,
  userId: string
): Promise<{
  mailboxes: Array<CourtMailboxRow & { courtName: string }>;
  activeMailboxId: string | null;
  activeCourtId: string | null;
  graphMode: 'legacy_me' | 'shared_mailbox' | null;
  legacyMeAllowed: boolean;
  requireExplicitMailbox: boolean;
}> {
  const conn = (await getOutlookConnection(admin, userId)) as OutlookConnectionExtended | null;
  const mailboxes = await listUserCourtMailboxes(admin, userId);
  return {
    mailboxes,
    activeMailboxId: conn?.active_mailbox_id ? String(conn.active_mailbox_id) : null,
    activeCourtId: conn?.active_court_id ? String(conn.active_court_id) : null,
    graphMode: conn?.graph_mode ?? null,
    legacyMeAllowed: isOutlookAllowLegacyMe(),
    requireExplicitMailbox: isOutlookRequireExplicitMailbox(),
  };
}
