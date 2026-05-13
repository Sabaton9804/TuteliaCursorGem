import type { SupabaseClient } from '@supabase/supabase-js';
import { overdueThresholdIso } from './workflow-tasks-ui';

/** Pending con fecha límite vencida hace más de 24 h → `escalated`. */
export async function escalateStaleWorkflowTasks(
  supabase: SupabaseClient,
  opts: { assigneeId: string; courtId: string },
): Promise<number> {
  const threshold = overdueThresholdIso();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('workflow_tasks')
    .update({ status: 'escalated', updated_at: now })
    .eq('assignee_id', opts.assigneeId)
    .eq('court_id', opts.courtId)
    .eq('status', 'pending')
    .not('deadline', 'is', null)
    .lt('deadline', threshold)
    .select('id');
  if (error) {
    console.error('escalateStaleWorkflowTasks:', error);
    return 0;
  }
  return data?.length ?? 0;
}
