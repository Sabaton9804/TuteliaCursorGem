import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

type PostgresChangeBinding = {
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
  schema?: string;
  table: string;
  filter?: string;
  onEvent: () => void;
};

/**
 * Crea un canal Realtime con todos los bindings *antes* de `subscribe()`,
 * y con nombre único por montaje.
 *
 * Evita: `cannot add postgres_changes callbacks ... after subscribe()`
 * (Strict Mode / cleanup async / deps inestables que reusan el mismo topic).
 */
export function subscribePostgresChanges(opts: {
  /** Prefijo estable (p. ej. case-stages-{id}). Se le añade un UUID. */
  topicPrefix: string;
  bindings: PostgresChangeBinding[];
}): RealtimeChannel {
  const topic = `${opts.topicPrefix}-${crypto.randomUUID()}`;
  let channel = supabase.channel(topic);
  for (const binding of opts.bindings) {
    const { onEvent, event, schema, table, filter } = binding;
    channel = channel.on(
      'postgres_changes',
      {
        event: event ?? '*',
        schema: schema ?? 'public',
        table,
        filter,
      },
      () => onEvent(),
    );
  }
  channel.subscribe();
  return channel;
}

export function removeRealtimeChannel(channel: RealtimeChannel | null | undefined): void {
  if (!channel) return;
  void supabase.removeChannel(channel);
}
