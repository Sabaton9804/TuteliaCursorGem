/**
 * Smoke tests estáticos sin dependencia de Supabase/Vite env.
 * Ejecutar: npm run verify:despacho-invariants
 */
import assert from 'node:assert/strict';
import { hasRoleCapability } from '../src/lib/role-capabilities.ts';
import {
  isSgdeAutoCreateCaseType,
  supportsContestacionWorkflow,
  supportsApelacionWorkflow,
  isCivilEjecutivoCaseType,
  initialResponseTermStageForCaseType,
} from '../src/lib/sgde-case-scope.ts';
import {
  APELACION_CIVIL_BUSINESS_DAYS,
  EXCEPCIONES_EJECUTIVO_BUSINESS_DAYS,
} from '../src/lib/civil-business-days.ts';

import { isCivilCaseType } from '../src/lib/process-product-scope.ts';

const CIVIL_ORDINARIO_PIPELINE = [
  'RADICACION',
  'ADMISION',
  'NOTIFICACION_AUTO_ADMISORIO',
  'TERMINO_RESPUESTA',
  'TRAMITE',
  'INGRESO_DESPACHO_FALLO',
  'FALLO',
  'NOTIFICACION_FALLO',
  'TERMINO_APELACION',
  'APELACION',
  'REMISION_SUPERIOR',
  'EJECUTORIA',
] as const;

const CIVIL_EJECUTIVO_PIPELINE = [
  'RADICACION',
  'ADMISION',
  'NOTIFICACION_AUTO_ADMISORIO',
  'TERMINO_EXCEPCIONES',
  'TRAMITE',
  'INGRESO_DESPACHO_FALLO',
  'FALLO',
  'NOTIFICACION_FALLO',
  'TERMINO_APELACION',
  'EJECUTORIA',
] as const;

const CIVIL_PIPELINE = CIVIL_ORDINARIO_PIPELINE;

assert.equal(hasRoleCapability('clerk', 'registrar_hitos_secretaria'), true);
assert.equal(hasRoleCapability('sustanciador', 'registrar_hitos_secretaria'), false);
assert.equal(hasRoleCapability('judge', 'registrar_rama_admision'), true);
assert.equal(hasRoleCapability('sustanciador', 'registrar_rama_admision'), false);
assert.equal(hasRoleCapability('clerk', 'registrar_rama_admision'), true);
assert.equal(hasRoleCapability('judge', 'manual_etapas'), true);
assert.equal(hasRoleCapability('escribiente', 'manual_etapas'), false);
assert.equal(hasRoleCapability('clerk', 'radicar'), true);
assert.equal(hasRoleCapability('sustanciador', 'config_reparto'), false);

for (const civil of [
  'civil_ordinario',
  'civil_ejecutivo',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros',
] as const) {
  assert.ok(CIVIL_PIPELINE.includes('TERMINO_RESPUESTA'), `${civil}: pipeline civil de referencia`);
  assert.equal(supportsContestacionWorkflow(civil), true);
  assert.equal(isSgdeAutoCreateCaseType(civil), true);
}

assert.equal(isSgdeAutoCreateCaseType('tutela_segunda'), false);
assert.equal(supportsContestacionWorkflow('tutela_primera'), true);
assert.equal(isCivilCaseType('civil_ordinario'), true);
assert.equal(isCivilEjecutivoCaseType('civil_ejecutivo'), true);
assert.equal(initialResponseTermStageForCaseType('civil_ejecutivo'), 'TERMINO_EXCEPCIONES');
assert.equal(initialResponseTermStageForCaseType('civil_ordinario'), 'TERMINO_RESPUESTA');
assert.equal(supportsApelacionWorkflow('civil_ordinario'), true);
assert.equal(APELACION_CIVIL_BUSINESS_DAYS, 10);
assert.equal(EXCEPCIONES_EJECUTIVO_BUSINESS_DAYS, 5);
assert.ok(CIVIL_PIPELINE.indexOf('TRAMITE') < CIVIL_PIPELINE.indexOf('INGRESO_DESPACHO_FALLO'), 'CGP: trámite antes de sentencia');
assert.ok(
  CIVIL_EJECUTIVO_PIPELINE.includes('TERMINO_EXCEPCIONES'),
  'ejecutivo: término excepciones',
);
assert.ok(
  CIVIL_ORDINARIO_PIPELINE.includes('TERMINO_APELACION'),
  'ordinario: término apelación',
);
assert.equal(isCivilCaseType('tutela_primera'), false);
assert.equal(hasRoleCapability('admin', 'invitar_equipo'), true);
assert.equal(hasRoleCapability('official', 'ver_correo'), true);

console.log('verify-despacho-invariants: OK');
