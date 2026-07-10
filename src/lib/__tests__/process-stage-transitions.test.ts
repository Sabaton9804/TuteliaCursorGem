import { describe, expect, it, beforeEach } from 'vitest';
import {
  setProcessDefinitionsCache,
  type LoadedProcessDefinition,
} from '../process-definitions-service';
import {
  getBranchTransitionsFromStage,
  getLinearNextStage,
  resolveTerminoRespuestaVencidoNext,
} from '../process-stage-transitions';
import { STAGE_PIPELINE_BY_CASE_TYPE } from '../case-workflow-stages';

function mockDef(
  legacy: keyof typeof STAGE_PIPELINE_BY_CASE_TYPE,
  transitions: LoadedProcessDefinition['transitions'] = [],
): LoadedProcessDefinition {
  const pipeline = STAGE_PIPELINE_BY_CASE_TYPE[legacy];
  return {
    id: `pd-${legacy}`,
    code: legacy,
    label: legacy,
    process_domain: legacy.startsWith('civil') ? 'civil' : 'constitucional',
    instance_level: 1,
    case_term_days: null,
    case_term_type: 'none',
    legacy_case_type: legacy,
    is_active: true,
    stages: [],
    transitions,
    pipeline,
  };
}

describe('process-stage-transitions', () => {
  beforeEach(() => {
    setProcessDefinitionsCache('court-test', [
      mockDef('tutela_primera', [
        {
          process_definition_id: 'pd-tutela_primera',
          from_stage_code: 'ADMISION',
          to_stage_code: 'INADMISION',
          label: 'Inadmisión',
          is_default: false,
        },
      ]),
      mockDef('civil_ordinario', [
        {
          process_definition_id: 'pd-civil_ordinario',
          from_stage_code: 'TERMINO_RESPUESTA',
          to_stage_code: 'TRAMITE',
          label: 'Trámite probatorio (CGP)',
          is_default: false,
        },
      ]),
    ]);
  });

  it('getLinearNextStage sigue el pipeline BD', () => {
    expect(getLinearNextStage('tutela_primera', 'RADICACION')).toBe('ADMISION');
    expect(getLinearNextStage('tutela_primera', 'FALLO')).toBe('NOTIFICACION_FALLO');
  });

  it('getBranchTransitionsFromStage expone ramas del grafo', () => {
    const branches = getBranchTransitionsFromStage('tutela_primera', 'ADMISION');
    expect(branches).toHaveLength(1);
    expect(branches[0]?.to_stage_code).toBe('INADMISION');
  });

  it('resolveTerminoRespuestaVencidoNext usa transición civil a TRAMITE', () => {
    expect(resolveTerminoRespuestaVencidoNext('civil_ordinario')).toBe('TRAMITE');
    expect(resolveTerminoRespuestaVencidoNext('tutela_primera')).toBe('INGRESO_DESPACHO_FALLO');
  });
});
