import type { ExpedienteAssignee } from './court-staff-types';

/** Fallback demo (051) si el despacho aún no tiene perfiles en BD. Coincide con seed-court-users.mts. */
export const DEMO_DESPACHO_STAFF: readonly ExpedienteAssignee[] = [
  {
    id: 'gloria-montero',
    initials: 'GM',
    name: 'Gloria Patricia Montero Cabas',
    ring: 'ring-violet-200',
    bg: 'bg-violet-100',
    text: 'text-violet-900',
    emails: ['gloria.montero.cabas@tutelia-despacho.seed'],
    courtRole: 'judge',
  },
  {
    id: 'camilo-marroquin',
    initials: 'CM',
    name: 'Camilo Andres Marroquín Hernandez',
    ring: 'ring-blue-200',
    bg: 'bg-blue-100',
    text: 'text-blue-800',
    emails: ['camilo.marroquin.hernandez@tutelia-despacho.seed'],
    courtRole: 'clerk',
  },
  {
    id: 'diego-guarin',
    initials: 'DG',
    name: 'Diego Enrique Guarin Vega',
    ring: 'ring-emerald-200',
    bg: 'bg-emerald-100',
    text: 'text-emerald-900',
    emails: ['diego.guarin.vega@tutelia-despacho.seed'],
    courtRole: 'sustanciador',
  },
  {
    id: 'myriam-fonseca',
    initials: 'MF',
    name: 'Myriam Francesa Fonseca Alvarez',
    ring: 'ring-teal-200',
    bg: 'bg-teal-100',
    text: 'text-teal-900',
    emails: ['myriam.fonseca.alvarez@tutelia-despacho.seed'],
    courtRole: 'sustanciador',
  },
  {
    id: 'yeiner-osorio',
    initials: 'YF',
    name: 'Yeiner Giovanny Osorio Florez',
    ring: 'ring-amber-200',
    bg: 'bg-amber-100',
    text: 'text-amber-900',
    emails: ['yeiner.osorio.florez@tutelia-despacho.seed'],
    courtRole: 'escribiente',
  },
  {
    id: 'lina-martinez',
    initials: 'LM',
    name: 'Lina Paola Martinez Orjuela',
    ring: 'ring-orange-200',
    bg: 'bg-orange-100',
    text: 'text-orange-900',
    emails: ['paola.martinez@tutelia-despacho.seed'],
    courtRole: 'escribiente',
  },
  {
    id: 'edisson-cantor',
    initials: 'EC',
    name: 'Edisson James Cantor Burgos',
    ring: 'ring-slate-300',
    bg: 'bg-slate-200',
    text: 'text-slate-800',
    emails: ['edisson.cantor.burgos@tutelia-despacho.seed'],
    courtRole: 'asistente_judicial',
  },
] as const;

export function demoSustanciadores(): ExpedienteAssignee[] {
  return DEMO_DESPACHO_STAFF.filter((p) => p.courtRole === 'sustanciador');
}
