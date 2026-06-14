import type { Express } from 'express';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  assertCourtScope,
  assertTerritoryScope,
  requirePlatformAdmin,
  requirePlatformOperator,
} from './platform-auth';

type CreateCourtBody = {
  id?: string;
  name?: string;
  email?: string;
  city?: string;
  status?: string;
  official_name?: string;
  dane_code?: string;
  entity_code?: string;
  specialty_code?: string;
  despacho_number?: string;
  territory_id?: string;
  judicial_specialty_id?: string;
  entity_category_id?: string;
  adminUser?: {
    email?: string;
    name?: string;
    password?: string;
    role?: string;
  };
};

type InviteUserBody = {
  email?: string;
  name?: string;
  password?: string;
  role?: string;
};

const VALID_ROLES = new Set([
  'admin',
  'judge',
  'clerk',
  'official',
  'sustanciador',
  'escribiente',
  'asistente_judicial',
]);

async function findUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  const target = email.toLowerCase();
  let page: number | null = 1;
  const perPage = 200;
  while (page != null) {
    const { data: list, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const batch = list as { users: User[]; nextPage: number | null };
    const hit = batch.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit.id;
    page = batch.nextPage != null ? batch.nextPage : null;
  }
  return null;
}

async function ensureAuthUser(admin: SupabaseClient, opts: {
  email: string;
  password: string;
  name: string;
}): Promise<string> {
  const email = opts.email.trim().toLowerCase();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: opts.password,
    email_confirm: true,
    user_metadata: { full_name: opts.name, name: opts.name.split(' ')[0] },
  });
  if (!createErr && created.user?.id) return created.user.id;

  const msg = createErr?.message?.toLowerCase() ?? '';
  if (!msg.includes('already') && !msg.includes('registered') && !msg.includes('exists')) {
    throw new Error(createErr?.message || 'No se pudo crear usuario Auth');
  }
  const existing = await findUserIdByEmail(admin, email);
  if (!existing) throw new Error('Usuario existente pero no encontrado en Auth');
  const { error: updErr } = await admin.auth.admin.updateUserById(existing, {
    password: opts.password,
    email_confirm: true,
    user_metadata: { full_name: opts.name, name: opts.name.split(' ')[0] },
  });
  if (updErr) throw new Error(updErr.message);
  return existing;
}

function slugCourtId(name: string, dane?: string): string {
  const base = (dane || name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `court-${base || Date.now()}`;
}

export function registerPlatformRoutes(app: Express, getSupabaseAdmin: () => SupabaseClient) {
  app.post('/api/platform/courts', async (req, res) => {
    try {
      const acc = await requirePlatformOperator(req, getSupabaseAdmin);
      if (acc.ok === false) return res.status(acc.status).json({ error: acc.message });

      const body = req.body as CreateCourtBody;
      const name = String(body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name es requerido' });

      const territoryErr = assertTerritoryScope(acc, body.territory_id ?? null);
      if (territoryErr) return res.status(403).json({ error: territoryErr });

      let courtId = String(body.id || '').trim();
      if (!courtId) courtId = slugCourtId(name, body.dane_code);

      const row = {
        id: courtId,
        name,
        email: String(body.email || '').trim(),
        city: String(body.city || '').trim(),
        status: body.status === 'inactive' || body.status === 'suspended' ? body.status : 'active',
        official_name: body.official_name?.trim() || null,
        dane_code: body.dane_code?.trim() || null,
        entity_code: body.entity_code?.trim() || null,
        specialty_code: body.specialty_code?.trim() || null,
        despacho_number: body.despacho_number?.trim() || null,
        territory_id: body.territory_id || null,
        judicial_specialty_id: body.judicial_specialty_id || null,
        entity_category_id: body.entity_category_id || null,
        updated_at: new Date().toISOString(),
      };

      const { error: insErr } = await acc.admin.from('courts').upsert(row, { onConflict: 'id' });
      if (insErr) return res.status(400).json({ error: insErr.message });

      let adminUserId: string | null = null;
      const au = body.adminUser;
      if (au?.email?.trim() && au?.password?.trim()) {
        const role = VALID_ROLES.has(String(au.role || 'admin')) ? String(au.role) : 'admin';
        const userName = String(au.name || au.email).trim();
        adminUserId = await ensureAuthUser(acc.admin, {
          email: au.email.trim(),
          password: au.password.trim(),
          name: userName,
        });
        await acc.admin.from('profiles').upsert(
          {
            id: adminUserId,
            email: au.email.trim().toLowerCase(),
            name: userName,
            role,
            court_id: courtId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        );
        await acc.admin.from('profile_court_memberships').upsert(
          {
            profile_id: adminUserId,
            court_id: courtId,
            role,
            is_default: true,
          },
          { onConflict: 'profile_id,court_id' }
        );
      }

      await acc.admin.from('platform_audit_log').insert({
        user_id: acc.userId,
        action: 'court_created',
        target_court_id: courtId,
        metadata: { admin_user_id: adminUserId },
      });

      return res.status(201).json({ courtId, adminUserId });
    } catch (e) {
      console.error('[platform/courts]', e);
      return res.status(500).json({ error: String((e as Error)?.message || e) });
    }
  });

  app.post('/api/platform/courts/:courtId/users', async (req, res) => {
    try {
      const acc = await requirePlatformOperator(req, getSupabaseAdmin);
      if (acc.ok === false) return res.status(acc.status).json({ error: acc.message });

      const courtId = String(req.params.courtId || '').trim();
      if (!courtId) return res.status(400).json({ error: 'courtId inválido' });

      const scopeErr = await assertCourtScope(acc, courtId);
      if (scopeErr) return res.status(403).json({ error: scopeErr });

      const { data: court } = await acc.admin.from('courts').select('id').eq('id', courtId).maybeSingle();
      if (!court?.id) return res.status(404).json({ error: 'Despacho no encontrado' });

      const body = req.body as InviteUserBody;
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '123456').trim();
      const name = String(body.name || email.split('@')[0]).trim();
      const role = VALID_ROLES.has(String(body.role || 'clerk')) ? String(body.role) : 'clerk';

      if (!email) return res.status(400).json({ error: 'email es requerido' });

      const userId = await ensureAuthUser(acc.admin, { email, password, name });

      await acc.admin.from('profiles').upsert(
        {
          id: userId,
          email,
          name,
          role,
          court_id: courtId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );

      await acc.admin.from('profile_court_memberships').upsert(
        {
          profile_id: userId,
          court_id: courtId,
          role,
          is_default: false,
        },
        { onConflict: 'profile_id,court_id' }
      );

      await acc.admin.from('platform_audit_log').insert({
        user_id: acc.userId,
        action: 'user_invited',
        target_court_id: courtId,
        metadata: { email, role, user_id: userId },
      });

      return res.status(201).json({ userId, email, role });
    } catch (e) {
      console.error('[platform/courts/users]', e);
      return res.status(500).json({ error: String((e as Error)?.message || e) });
    }
  });

  app.post('/api/platform/courts/bulk-import', async (req, res) => {
    try {
      const acc = await requirePlatformOperator(req, getSupabaseAdmin);
      if (acc.ok === false) return res.status(acc.status).json({ error: acc.message });

      const rows = req.body?.rows;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: 'rows debe ser un array no vacío' });
      }
      if (rows.length > 500) {
        return res.status(400).json({ error: 'Máximo 500 filas por solicitud' });
      }

      const { data, error } = await acc.admin.rpc('bulk_upsert_courts', { p_rows: rows });
      if (error) {
        if (/bulk_upsert_courts|function.*does not exist/i.test(error.message)) {
          return res.status(503).json({
            error: 'Migración bulk import no aplicada (20260614120000_bulk_import_courts.sql)',
          });
        }
        return res.status(400).json({ error: error.message });
      }

      const results = (data ?? []) as Array<{
        row_num: number;
        court_id: string | null;
        action: string;
        message: string | null;
      }>;

      const summary = {
        inserted: results.filter((r) => r.action === 'inserted').length,
        updated: results.filter((r) => r.action === 'updated').length,
        errors: results.filter((r) => r.action === 'error').length,
      };

      await acc.admin.from('platform_audit_log').insert({
        user_id: acc.userId,
        action: 'courts_bulk_import',
        target_court_id: null,
        metadata: { ...summary, row_count: rows.length },
      });

      return res.status(200).json({ summary, results });
    } catch (e) {
      console.error('[platform/courts/bulk-import]', e);
      return res.status(500).json({ error: String((e as Error)?.message || e) });
    }
  });

  app.post('/api/platform/regional-admins', async (req, res) => {
    try {
      const acc = await requirePlatformAdmin(req, getSupabaseAdmin);
      if (acc.ok === false) return res.status(acc.status).json({ error: acc.message });

      const email = String(req.body?.email || '')
        .trim()
        .toLowerCase();
      const territoryId = String(req.body?.territoryId || '').trim();
      const notes = String(req.body?.notes || '').trim() || null;

      if (!email) return res.status(400).json({ error: 'email es requerido' });
      if (!territoryId) return res.status(400).json({ error: 'territoryId es requerido' });

      const userId = await findUserIdByEmail(acc.admin, email);
      if (!userId) {
        return res.status(404).json({ error: 'Usuario no encontrado en Auth. Debe existir previamente.' });
      }

      const { error: insErr } = await acc.admin.from('platform_regional_admins').upsert(
        {
          user_id: userId,
          territory_id: territoryId,
          created_by: acc.userId,
          notes,
        },
        { onConflict: 'user_id,territory_id' }
      );
      if (insErr) return res.status(400).json({ error: insErr.message });

      await acc.admin.from('platform_audit_log').insert({
        user_id: acc.userId,
        action: 'regional_admin_granted',
        target_court_id: null,
        metadata: { email, user_id: userId, territory_id: territoryId },
      });

      return res.status(201).json({ userId, email, territoryId });
    } catch (e) {
      console.error('[platform/regional-admins]', e);
      return res.status(500).json({ error: String((e as Error)?.message || e) });
    }
  });

  app.delete('/api/platform/regional-admins', async (req, res) => {
    try {
      const acc = await requirePlatformAdmin(req, getSupabaseAdmin);
      if (acc.ok === false) return res.status(acc.status).json({ error: acc.message });

      const userId = String(req.body?.userId || '').trim();
      const territoryId = String(req.body?.territoryId || '').trim();
      if (!userId || !territoryId) {
        return res.status(400).json({ error: 'userId y territoryId son requeridos' });
      }

      const { error: delErr } = await acc.admin
        .from('platform_regional_admins')
        .delete()
        .eq('user_id', userId)
        .eq('territory_id', territoryId);
      if (delErr) return res.status(400).json({ error: delErr.message });

      await acc.admin.from('platform_audit_log').insert({
        user_id: acc.userId,
        action: 'regional_admin_revoked',
        target_court_id: null,
        metadata: { user_id: userId, territory_id: territoryId },
      });

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[platform/regional-admins DELETE]', e);
      return res.status(500).json({ error: String((e as Error)?.message || e) });
    }
  });
}
