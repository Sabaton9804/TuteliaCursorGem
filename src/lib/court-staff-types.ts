import type { UserRole } from '../types';

/** Persona del equipo del despacho (UI, reparto, plantillas). */
export interface ExpedienteAssignee {
  id: string;
  initials: string;
  name: string;
  ring: string;
  bg: string;
  text: string;
  emails?: readonly string[];
  courtRole?: UserRole;
  profileId?: string;
}
