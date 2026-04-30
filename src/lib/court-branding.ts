import { supabase } from './supabase';
import { DEFAULT_PLANTILLAS as V1_DEFAULT } from './plantillas-store-v1-shim';
import type { PlantillasMembrete } from './plantillas-store';
import { ensureSupabaseSessionForWrites } from './supabase-write-auth';
import { userFacingSupabaseError } from './supabase-user-error';

export function defaultMembrete(): PlantillasMembrete {
  return {
    auto: { ...V1_DEFAULT.auto },
    informe: { ...V1_DEFAULT.informe },
    membreteImageDataUrl: '',
    membreteEditorJson: '',
    autoDatosExpedienteEditorJson: '',
  };
}

/** Combina JSON de BD con valores por defecto si faltan claves. */
export function mergeBrandingJson(raw: unknown): PlantillasMembrete {
  const d = defaultMembrete();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  const auto = o.auto as Record<string, unknown> | undefined;
  const inf = o.informe as Record<string, unknown> | undefined;
  return {
    auto: {
      line1: typeof auto?.line1 === 'string' ? auto.line1 : d.auto.line1,
      line2: typeof auto?.line2 === 'string' ? auto.line2 : d.auto.line2,
      line3: typeof auto?.line3 === 'string' ? auto.line3 : d.auto.line3,
    },
    informe: {
      juzgado: typeof inf?.juzgado === 'string' ? inf.juzgado : d.informe.juzgado,
      direccion: typeof inf?.direccion === 'string' ? inf.direccion : d.informe.direccion,
      correo: typeof inf?.correo === 'string' ? inf.correo : d.informe.correo,
    },
    membreteImageDataUrl:
      typeof o.membreteImageDataUrl === 'string' ? o.membreteImageDataUrl : d.membreteImageDataUrl,
    membreteEditorJson: typeof o.membreteEditorJson === 'string' ? o.membreteEditorJson : d.membreteEditorJson ?? '',
    autoDatosExpedienteEditorJson:
      typeof o.autoDatosExpedienteEditorJson === 'string'
        ? o.autoDatosExpedienteEditorJson
        : d.autoDatosExpedienteEditorJson ?? '',
  };
}

export async function fetchCourtBranding(courtId: string): Promise<PlantillasMembrete> {
  const { data, error } = await supabase.from('courts').select('branding').eq('id', courtId).maybeSingle();
  if (error) throw error;
  return mergeBrandingJson(data?.branding);
}

/** Mensaje claro si falla el guardado (migración, permisos, sesión). */
export function describeBrandingSaveError(err: unknown): string {
  const raw = userFacingSupabaseError(err);
  const t = raw.toLowerCase();
  const code =
    err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string'
      ? String((err as { code: string }).code)
      : '';

  const looksLikeMissingBrandingColumn =
    code === '42703' ||
    /\bbranding\b.*(does not exist|unknown column|no existe)/i.test(raw) ||
    /column\s+["']?branding["']?\s+of\s+["']?courts["']?/i.test(raw) ||
    (t.includes('schema cache') && t.includes('branding'));

  if (looksLikeMissingBrandingColumn) {
    return 'No se pudo guardar el membrete en el servidor: falta aplicar en la base de datos la migración que añade la columna `branding` en `courts` (p. ej. `20250429140000_courts_branding.sql`). Hasta entonces los cambios solo quedan en este navegador.';
  }
  if (t.includes('permission') || t.includes('policy') || t.includes('row-level') || t.includes('rls')) {
    return 'No tiene permiso para guardar el membrete en el servidor. Inicie sesión con una cuenta autorizada.';
  }
  if (t.includes('jwt') || t.includes('session')) {
    return 'La sesión caducó o no está iniciada. Vuelva a entrar e intente de nuevo.';
  }
  return `No se pudo guardar el membrete en el servidor: ${raw}`;
}

export async function saveCourtBranding(courtId: string, membrete: PlantillasMembrete): Promise<void> {
  await ensureSupabaseSessionForWrites();
  const { error } = await supabase
    .from('courts')
    .update({
      branding: membrete,
      updated_at: new Date().toISOString(),
    })
    .eq('id', courtId);
  if (error) throw error;
}
