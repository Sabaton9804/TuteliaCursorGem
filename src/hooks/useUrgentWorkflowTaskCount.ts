import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Tareas urgentes aún abiertas (pendiente o escalada) del usuario en su despacho.
 * Para badge del menú lateral.
 */
export function useUrgentWorkflowTaskCount(userId: string | undefined, courtId: string | undefined) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId || !courtId) {
      setCount(0);
      return;
    }
    const { count: c, error } = await supabase
      .from('workflow_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('assignee_id', userId)
      .eq('court_id', courtId)
      .eq('priority', 'urgent')
      .in('status', ['pending', 'escalated']);
    if (error) {
      console.error('urgent workflow count:', error);
      return;
    }
    setCount(c ?? 0);
  }, [userId, courtId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`workflow-tasks-urgent-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'workflow_tasks', filter: `assignee_id=eq.${userId}` },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [userId, refresh]);

  return { count, refresh };
}
