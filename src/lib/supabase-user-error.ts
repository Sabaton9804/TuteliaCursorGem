/** PostgREST: relación inexistente o no expuesta (p. ej. migración no aplicada en el proyecto). */
export function isPostgrestTableMissingError(err: unknown, table: string): boolean {
  if (!err || typeof err !== 'object') return false;
  const o = err as { code?: string; message?: string };
  const msg = String(o.message || '').toLowerCase();
  const t = table.toLowerCase();
  if (o.code === 'PGRST205' && msg.includes(t)) return true;
  return msg.includes('schema cache') && msg.includes(t);
}

/** Mensaje legible aunque Supabase/Auth devuelva objetos que no son `instanceof Error`. */
export function userFacingSupabaseError(err: unknown): string {
  if (err instanceof Error) return enrichHint(err.message, err);

  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint, o.error_description]
      .filter((x) => typeof x === 'string' && String(x).trim())
      .map(String);
    if (parts.length) return enrichHint(parts.join(' — '), err);
  }

  if (typeof err === 'string' && err.trim()) return enrichHint(err, err);

  return enrichHint('Error desconocido al comunicarse con el servidor.', err);
}

function enrichHint(message: string, raw: unknown): string {
  if (message.includes('20250429190000')) return message;

  const lower = message.toLowerCase();

  if (lower.includes('review_markup_json') && lower.includes('case_word_reviews')) {
    return `${message}\n\nEn Supabase → SQL Editor, ejecute la migración del proyecto «20250503140000_case_word_review_markup.sql» (añade la columna jsonb review_markup_json a la tabla case_word_reviews). Guarde, espere unos segundos a que se actualice el esquema y recargue esta página.`;
  }
  const code =
    raw && typeof raw === 'object' && 'code' in raw && typeof (raw as { code: unknown }).code === 'string'
      ? String((raw as { code: string }).code)
      : '';

  if (
    lower.includes('template_toggles') ||
    (lower.includes('column') && (lower.includes('does not exist') || lower.includes('unknown'))) ||
    code === '42703'
  ) {
    return `${message}\n\nFalta la columna en la base de datos. En Supabase → Editor SQL, ejecute el archivo de migración «20250429190000_document_templates_ui_toggles.sql» (añade template_toggles a document_templates) y vuelva a intentar.`;
  }

  if (code === 'PGRST116' || lower.includes('0 rows')) {
    return `${message}\n\nNo se actualizó ninguna fila: compruebe permisos (RLS), que la plantilla exista y que su usuario pertenezca al mismo court_id.`;
  }

  if (lower.includes('jwt') || lower.includes('permission denied') || lower.includes('row-level security')) {
    return `${message}\n\nRevise inicio de sesión en la aplicación y que su perfil tenga permiso para editar plantillas del despacho.`;
  }

  return message;
}
