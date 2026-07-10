import type { UserRole } from '../types';

const ALL_ROLES: readonly UserRole[] = [
  'admin',
  'judge',
  'clerk',
  'official',
  'sustanciador',
  'escribiente',
  'asistente_judicial',
] as const;

export function parseUserRole(raw: unknown): UserRole {
  const s0 = String(raw ?? '').trim();
  const s = s0.toLowerCase();
  /** Valores que a veces vienen en BD o seed manual (no están en `UserRole`). */
  const alias: Record<string, UserRole> = {
    magistrado: 'judge',
    juez: 'judge',
    secretario: 'clerk',
    'secretario(a)': 'clerk',
    'oficial mayor': 'official',
    oficial_mayor: 'official',
    'asistente judicial': 'asistente_judicial',
    asistente: 'asistente_judicial',
  };
  const mapped = alias[s] ?? s;
  return (ALL_ROLES as readonly string[]).includes(mapped) ? (mapped as UserRole) : 'clerk';
}

/** Etiqueta corta en español para UI (configuración, listados). */
export function userRoleLabelEs(role: UserRole): string {
  const m: Record<UserRole, string> = {
    admin: 'Administrador',
    judge: 'Juez',
    clerk: 'Secretario(a)',
    official: 'Oficial mayor',
    sustanciador: 'Sustanciador(a)',
    escribiente: 'Escribiente',
    asistente_judicial: 'Asistente judicial',
  };
  return m[role] ?? role;
}
