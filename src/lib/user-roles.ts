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
  const s = String(raw ?? '').trim();
  return (ALL_ROLES as readonly string[]).includes(s) ? (s as UserRole) : 'admin';
}

/** Etiqueta corta en español para UI (configuración, listados). */
export function userRoleLabelEs(role: UserRole): string {
  const m: Record<UserRole, string> = {
    admin: 'Administrador',
    judge: 'Juez',
    clerk: 'Secretario(a)',
    official: 'Funcionario',
    sustanciador: 'Sustanciador(a)',
    escribiente: 'Escribiente',
    asistente_judicial: 'Asistente judicial',
  };
  return m[role] ?? role;
}
