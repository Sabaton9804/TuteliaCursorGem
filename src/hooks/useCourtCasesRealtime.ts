import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { courtCasesQueryRootKey } from '../lib/court-cases-query';

/**
 * Invalida todas las queries de listado de expedientes del despacho cuando cambia `cases` en Supabase.
 * Así el caché de React Query se refresca sin duplicar la lógica de fetch en cada pantalla.
 */
export function useInvalidateCourtCasesOnRealtime(courtId: string, channelSuffix: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel(`court-cases-rt-${courtId}-${channelSuffix}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cases', filter: `court_id=eq.${courtId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: [...courtCasesQueryRootKey, courtId] });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [courtId, channelSuffix, queryClient]);
}
