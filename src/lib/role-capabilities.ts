import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  FileStack,
  Gavel,
  LayoutDashboard,
  ListTodo,
  Mail,
  PlusCircle,
  Reply,
  Scale,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import type { UserRole } from '../types';

export type RoleCapability =
  | 'radicar'
  | 'ver_expediente'
  | 'registrar_hitos_secretaria'
  | 'manual_etapas'
  | 'editar_fechas_etapa'
  | 'aprobar_borrador_juez'
  | 'responder_borrador_sustanciador'
  | 'editar_plantillas_secretaria'
  | 'editar_plantillas_despacho'
  | 'editar_membrete'
  | 'config_reparto'
  | 'config_sgde'
  | 'iniciar_incidente'
  | 'cambiar_sustanciador'
  | 'clasificar_sierju'
  | 'ver_estadisticas'
  | 'ver_sustanciador_tablero'
  | 'ver_correo'
  | 'eliminar_pieza_expediente'
  | 'invitar_equipo'
  | 'registrar_rama_admision';

const ALL: readonly RoleCapability[] = [
  'radicar',
  'ver_expediente',
  'registrar_hitos_secretaria',
  'manual_etapas',
  'editar_fechas_etapa',
  'aprobar_borrador_juez',
  'responder_borrador_sustanciador',
  'editar_plantillas_secretaria',
  'editar_plantillas_despacho',
  'editar_membrete',
  'config_reparto',
  'config_sgde',
  'iniciar_incidente',
  'cambiar_sustanciador',
  'clasificar_sierju',
  'ver_estadisticas',
  'ver_sustanciador_tablero',
  'ver_correo',
  'eliminar_pieza_expediente',
  'invitar_equipo',
  'registrar_rama_admision',
] as const;

const SECRETARIA_BASE: RoleCapability[] = [
  'radicar',
  'ver_expediente',
  'registrar_hitos_secretaria',
  'clasificar_sierju',
  'ver_correo',
  'ver_estadisticas',
];

const DESPACHO_BASE: RoleCapability[] = [
  'ver_expediente',
  'responder_borrador_sustanciador',
  'clasificar_sierju',
  'ver_sustanciador_tablero',
  'ver_estadisticas',
];

const ROLE_CAPABILITIES: Record<UserRole, ReadonlySet<RoleCapability>> = {
  admin: new Set(ALL),
  judge: new Set([
    ...DESPACHO_BASE,
    'aprobar_borrador_juez',
    'manual_etapas',
    'editar_fechas_etapa',
    'cambiar_sustanciador',
    'config_sgde',
    'eliminar_pieza_expediente',
    'registrar_rama_admision',
  ]),
  sustanciador: new Set([
    ...DESPACHO_BASE,
    'responder_borrador_sustanciador',
    'editar_plantillas_despacho',
    'registrar_rama_admision',
    'cambiar_sustanciador',
    'config_sgde',
    'ver_correo',
  ]),
  clerk: new Set([
    ...SECRETARIA_BASE,
    'manual_etapas',
    'editar_fechas_etapa',
    'editar_plantillas_secretaria',
    'iniciar_incidente',
    'cambiar_sustanciador',
    'config_reparto',
    'config_sgde',
    'eliminar_pieza_expediente',
    'registrar_rama_admision',
  ]),
  escribiente: new Set([
    ...SECRETARIA_BASE,
    'editar_plantillas_secretaria',
    'iniciar_incidente',
    'eliminar_pieza_expediente',
  ]),
  official: new Set([
    ...SECRETARIA_BASE,
    'manual_etapas',
    'iniciar_incidente',
    'config_sgde',
    'eliminar_pieza_expediente',
    'registrar_rama_admision',
  ]),
  asistente_judicial: new Set([
    ...SECRETARIA_BASE,
    ...DESPACHO_BASE,
    'aprobar_borrador_juez',
    'responder_borrador_sustanciador',
    'ver_correo',
    'registrar_rama_admision',
  ]),
};

export function hasRoleCapability(
  role: UserRole | null | undefined,
  capability: RoleCapability,
): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role]?.has(capability) ?? false;
}

export function canRegistrarHitosSecretaria(role: UserRole | null | undefined): boolean {
  return hasRoleCapability(role, 'registrar_hitos_secretaria');
}

export function canManualManageCaseStages(role: UserRole | null | undefined): boolean {
  return hasRoleCapability(role, 'manual_etapas');
}

export function canEditStageEnteredAt(role: UserRole | null | undefined): boolean {
  return hasRoleCapability(role, 'editar_fechas_etapa');
}

export function canEditPlantillas(role: UserRole | null | undefined, categoria: 'secretaria' | 'despacho'): boolean {
  if (categoria === 'secretaria') return hasRoleCapability(role, 'editar_plantillas_secretaria');
  return hasRoleCapability(role, 'editar_plantillas_despacho');
}

export function canEditMembrete(role: UserRole | null | undefined): boolean {
  return hasRoleCapability(role, 'editar_membrete');
}

export type NavLinkDef = {
  id: string;
  name: string;
  path: string;
  icon: LucideIcon;
  capability?: RoleCapability;
};

export const NAV_LINK_DEFS: readonly NavLinkDef[] = [
  { id: 'dashboard', name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { id: 'radicacion', name: 'Radicación', path: '/new', icon: PlusCircle, capability: 'radicar' },
  { id: 'tasks', name: 'Centro de trabajo', path: '/tasks', icon: ListTodo },
  {
    id: 'sustanciador',
    name: 'Tablero sustanciador',
    path: '/sustanciador',
    icon: Scale,
    capability: 'ver_sustanciador_tablero',
  },
  { id: 'estadisticas', name: 'Estadísticas', path: '/estadisticas', icon: BarChart3, capability: 'ver_estadisticas' },
  { id: 'precedentes', name: 'Biblioteca de precedentes', path: '/biblioteca-precedentes', icon: BookOpen },
  { id: 'plantillas', name: 'Plantillas', path: '/plantillas', icon: FileStack },
  { id: 'equipo', name: 'Equipo de trabajo', path: '/equipo', icon: Users },
  { id: 'correo', name: 'Correo', path: '/correo', icon: Mail, capability: 'ver_correo' },
  { id: 'contestaciones', name: 'Contestaciones', path: '/correo/contestaciones', icon: Reply, capability: 'ver_correo' },
  { id: 'pendientes', name: 'Pendientes correo', path: '/correo/pendientes', icon: ClipboardList, capability: 'ver_correo' },
  { id: 'sgde', name: 'Sincronización SGDE', path: '/sgde', icon: Search, capability: 'config_sgde' },
  { id: 'settings', name: 'Configuración', path: '/settings', icon: Settings, capability: 'config_reparto' },
] as const;

export function navLinksForRole(role: UserRole | null | undefined): NavLinkDef[] {
  return NAV_LINK_DEFS.filter((item) => {
    if (!item.capability) return true;
    return hasRoleCapability(role, item.capability);
  });
}

export function canRegistrarRamaAdmision(role: UserRole | null | undefined): boolean {
  return hasRoleCapability(role, 'registrar_rama_admision');
}

export const TUTELAS_NAV_CAPABILITY: RoleCapability = 'ver_expediente';
export const PROCESOS_NAV_CAPABILITY: RoleCapability = 'ver_expediente';
