export type UserRole = 'judge' | 'clerk' | 'official' | 'admin';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  courtId: string;
}

export type CaseStatus = 'received' | 'admitted' | 'transfer' | 'judgment' | 'archived';

export interface Case {
  id: string;
  radicado: string;
  courtId: string;
  claimant: string;
  defendant: string;
  status: CaseStatus;
  operationalStatus?: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  deadlineAt?: string;
  sgdeId?: string;
  sourceChannel?: string;
  summary?: string;
  // Legal Extraction Fields
  claimantId?: string;
  claimantEmail?: string;
  defendantId?: string;
  defendantEmail?: string;
  legalHechos?: string;
  legalPretensiones?: string;
  legalDerechoTutelado?: string;
  legalIdentificaciones?: string;
}

export interface Document {
  id: string;
  caseId: string;
  type: string;
  name: string;
  storageKey: string;
  hash: string;
  sgdeId?: string;
  createdAt: string;
  content?: string;
  contentType?: string;
  size?: number;
}

export interface Action {
  id: string;
  caseId: string;
  userId: string;
  userName: string;
  type: string;
  description: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface Court {
  id: string;
  name: string;
  email: string;
  city: string;
}
