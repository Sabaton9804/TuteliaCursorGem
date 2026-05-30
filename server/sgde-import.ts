import type { SupabaseClient } from '@supabase/supabase-js';
import type { SgdeClient } from './sgde-client';
import {
  migrateSgdeOriginToCase,
  preflightSgdeOriginExpediente,
  type SgdePreflightStatus,
} from './sgde-migrate';
import {
  cuiBase21,
  deriveRadicadoSegundaInstancia,
} from '../src/lib/radicado-cui.ts';
import type { CaseAppellant, CaseOriginRuling, CaseType } from '../src/types.ts';

const NOTEBOOK_PI = 'PI_C01_PRINCIPAL';
const NOTEBOOK_SI = 'SI_C01_PRINCIPAL';

export type ImportFromSgdeResult = {
  ok: boolean;
  caseId: string;
  created: boolean;
  radicado: string;
  originRadicado: string | null;
  sgdeRootId: string;
  migrated: number;
  failed: number;
  skipped: number;
  errors: string[];
  preflightStatus: SgdePreflightStatus;
  message: string;
};

export type ImportFromSgdeOpts = {
  client: SgdeClient;
  admin: SupabaseClient;
  userId: string;
  userName?: string;
  courtId: string;
  caseType: 'tutela_primera' | 'tutela_segunda';
  /** Primera: CUI del expediente en SGDE. Segunda: CUI de origen (primera instancia). */
  radicadoRaw: string;
  sgdeNodeIdHint?: string | null;
  originCourt?: string;
  appellant?: CaseAppellant | null;
  originRuling?: CaseOriginRuling | null;
  forceMigrate?: boolean;
};

function parsePartiesFromRootName(rootName: string | null): { claimant: string; defendant: string } {
  const name = String(rootName || '').trim();
  if (!name) {
    return { claimant: 'Pendiente (importación SGDE)', defendant: 'Pendiente (importación SGDE)' };
  }
  const vs = name.split(/\s+(?:vs\.?|contra|v\.?)\s+/i);
  if (vs.length >= 2) {
    return {
      claimant: vs[0].trim().slice(0, 500) || 'Pendiente (importación SGDE)',
      defendant: vs.slice(1).join(' ').trim().slice(0, 500) || 'Pendiente (importación SGDE)',
    };
  }
  return { claimant: name.slice(0, 500), defendant: 'Pendiente (importación SGDE)' };
}

async function listSegundaRadicadosForBase(
  admin: SupabaseClient,
  courtId: string,
  base21: string
): Promise<string[]> {
  const { data, error } = await admin.from('cases').select('radicado').eq('court_id', courtId).like('radicado', `${base21}%`);
  if (error) throw error;
  return (data ?? [])
    .map((row) => String(row.radicado || '').replace(/\D/g, ''))
    .filter((d) => d.length === 23 && d.startsWith(base21));
}

async function ensureSgdeFolderMap(opts: {
  admin: SupabaseClient;
  client: SgdeClient;
  caseType: CaseType;
  caseId: string;
  courtId: string;
  sgdeRootId: string;
}): Promise<void> {
  const { admin, client, caseType, caseId, courtId, sgdeRootId } = opts;
  if (caseType === 'tutela_primera') {
    const structure = await client.ensurePrimeraInstanciaPrincipal(sgdeRootId);
    if (structure.ok === false) throw new Error(structure.error);
    await admin.from('case_sgde_folder_map').upsert(
      {
        court_id: courtId,
        case_id: caseId,
        notebook_code: NOTEBOOK_PI,
        sgde_folder_node_id: structure.principalFolderId,
        folder_path: 'Primera instancia / Principal',
      },
      { onConflict: 'case_id,notebook_code' }
    );
    return;
  }
  const folders = await client.ensureSegundaInstanciaImpugnacion(sgdeRootId);
  if (folders.ok === false) throw new Error(folders.error);
  await admin.from('case_sgde_folder_map').upsert(
    {
      court_id: courtId,
      case_id: caseId,
      notebook_code: NOTEBOOK_SI,
      sgde_folder_node_id: folders.impugnacionFolderId,
      folder_path: 'Segunda instancia / Impugnación',
    },
    { onConflict: 'case_id,notebook_code' }
  );
}

export async function importExpedienteFromSgde(opts: ImportFromSgdeOpts): Promise<ImportFromSgdeResult> {
  const { client, admin, userId, courtId, caseType } = opts;
  const sgdeLookupRadicado = opts.radicadoRaw.replace(/\D/g, '');
  if (sgdeLookupRadicado.length !== 23) {
    throw new Error('El radicado debe tener 23 dígitos (CUI nacional).');
  }

  const preflight = await preflightSgdeOriginExpediente(client, sgdeLookupRadicado, {
    sgdeNodeIdHint: opts.sgdeNodeIdHint,
  });

  const sgdeRootId = String(preflight.sgdeRootId || '').trim();
  if (!sgdeRootId) {
    throw new Error(preflight.message || 'No se encontró el expediente en SGDE.');
  }

  if (preflight.status === 'no_encontrado' || preflight.status === 'error_login') {
    throw new Error(preflight.message || 'Expediente no disponible en SGDE para importar.');
  }

  let targetRadicado = sgdeLookupRadicado;
  let originRadicado: string | null = null;

  if (caseType === 'tutela_segunda') {
    originRadicado = sgdeLookupRadicado;
    const base = cuiBase21(originRadicado);
    if (!base) throw new Error('CUI de origen inválido.');
    const known = await listSegundaRadicadosForBase(admin, courtId, base);
    const derived = deriveRadicadoSegundaInstancia(originRadicado, known);
    if (!derived) {
      throw new Error(
        'No se pudo derivar el radicado de segunda instancia (límite de sufijos 01–99 para esta base CUI).'
      );
    }
    targetRadicado = derived;

    const court = String(opts.originCourt || '').trim();
    const appellant = opts.appellant ?? preflight.segundaExtract?.appellant ?? null;
    const originRuling = opts.originRuling ?? preflight.segundaExtract?.originRuling ?? null;
    if (!court) {
      throw new Error('Indique el juzgado de origen para segunda instancia.');
    }
    if (appellant !== 'accionante' && appellant !== 'accionado') {
      throw new Error('Indique el impugnante (accionante o accionado).');
    }
    if (originRuling !== 'concedio' && originRuling !== 'nego') {
      throw new Error('Indique el fallo en origen (concedió o negó).');
    }
  }

  const { data: existing } = await admin
    .from('cases')
    .select('id, sgde_id')
    .eq('court_id', courtId)
    .eq('radicado', targetRadicado)
    .maybeSingle();

  const parties = parsePartiesFromRootName(preflight.rootName);
  const now = new Date().toISOString();
  let caseId = String(existing?.id || '').trim();
  let created = false;

  if (!caseId) {
    caseId = crypto.randomUUID();
    created = true;
    const row: Record<string, unknown> = {
      id: caseId,
      court_id: courtId,
      radicado: targetRadicado,
      claimant: parties.claimant,
      defendant: parties.defendant,
      status: 'received',
      source_channel: 'sgde_import',
      subject: preflight.rootName
        ? `Importado desde SGDE — ${preflight.rootName}`
        : 'Importado desde SGDE',
      raw_text: '',
      summary: '',
      case_type: caseType,
      sgde_id: sgdeRootId,
      sgde_linked_at: now,
      sgde_sync_status: 'linked',
      updated_at: now,
    };

    if (caseType === 'tutela_segunda') {
      row.origin_court = String(opts.originCourt || '').trim();
      row.origin_radicado = originRadicado;
      row.appellant = opts.appellant ?? preflight.segundaExtract?.appellant;
      row.origin_ruling = opts.originRuling ?? preflight.segundaExtract?.originRuling;
    } else {
      row.origin_court = null;
      row.origin_radicado = null;
      row.appellant = null;
      row.origin_ruling = null;
    }

    const { error: insErr } = await admin.from('cases').insert(row);
    if (insErr) throw new Error(insErr.message || 'No se pudo crear el expediente en Tutelia.');
  } else if (!String(existing?.sgde_id || '').trim()) {
    await admin
      .from('cases')
      .update({
        sgde_id: sgdeRootId,
        sgde_linked_at: now,
        sgde_sync_status: 'linked',
        updated_at: now,
      })
      .eq('id', caseId);
  }

  await ensureSgdeFolderMap({
    admin,
    client,
    caseType,
    caseId,
    courtId,
    sgdeRootId,
  });

  const notebookCode = caseType === 'tutela_segunda' ? NOTEBOOK_SI : NOTEBOOK_PI;
  const mig = await migrateSgdeOriginToCase({
    client,
    admin,
    caseId,
    originRadicado: sgdeLookupRadicado,
    sgdeRootId,
    sgdeNodeIdHint: opts.sgdeNodeIdHint,
    notebookCode,
    force: opts.forceMigrate === true,
  });

  const actionDesc =
    created
      ? `Importación desde SGDE: expediente creado en Tutelia (${mig.migrated} PDF).`
      : `Importación desde SGDE: expediente existente (${mig.migrated} PDF nuevos).`;

  await admin.from('case_actions').insert({
    case_id: caseId,
    type: 'sgde_import',
    description: actionDesc,
    user_id: userId,
    user_name: String(opts.userName || 'Sistema').slice(0, 200),
    metadata: {
      case_type: caseType,
      radicado: targetRadicado,
      origin_radicado: originRadicado,
      sgde_root_id: sgdeRootId,
      migrated: mig.migrated,
      failed: mig.failed,
      preflight_status: preflight.status,
      created,
    },
  });

  const parts = [
    created ? 'Expediente creado en Tutelia' : 'Expediente ya existía en Tutelia',
    `vinculado a SGDE`,
    mig.migrated > 0 ? `${mig.migrated} PDF importados` : 'sin PDF nuevos (ya migrados o carpeta vacía)',
  ];
  if (mig.failed > 0) parts.push(`${mig.failed} con error`);

  return {
    ok: true,
    caseId,
    created,
    radicado: targetRadicado,
    originRadicado,
    sgdeRootId,
    migrated: mig.migrated,
    failed: mig.failed,
    skipped: mig.skipped,
    errors: mig.errors,
    preflightStatus: preflight.status,
    message: parts.join(' · ') + '.',
  };
}
