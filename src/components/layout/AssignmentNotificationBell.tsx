import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatRadicado } from '../../lib/formatters';
import { isPostgrestTableMissingError } from '../../lib/supabase-user-error';

type Row = {
  id: string;
  case_id: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

export function AssignmentNotificationBell({ userId }: { userId: string | null | undefined }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  /** Solo suscribirse a Realtime si el primer listado REST funcionó (evita ruido si falta la tabla en BD). */
  const [realtimeOk, setRealtimeOk] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('user_notifications')
        .select('id, case_id, title, body, read_at, created_at, metadata')
        .eq('recipient_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(25);
      if (error) throw error;
      setRows((data ?? []) as Row[]);
      setRealtimeOk(true);
    } catch (e) {
      if (isPostgrestTableMissingError(e, 'user_notifications')) {
        setRealtimeOk(false);
        setRows([]);
      } else {
        console.error('user_notifications:', e);
        setRows([]);
        setRealtimeOk(false);
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId || !realtimeOk) return;
    const ch = supabase
      .channel(`user-notif-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_notifications',
          filter: `recipient_user_id=eq.${userId}`,
        },
        () => void load()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [userId, load, realtimeOk]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!userId) return null;

  const unread = rows.filter((r) => !r.read_at).length;

  const openCase = async (r: Row) => {
    if (!r.read_at) {
      const now = new Date().toISOString();
      const { error } = await supabase.from('user_notifications').update({ read_at: now }).eq('id', r.id);
      if (error && !isPostgrestTableMissingError(error, 'user_notifications')) console.error(error);
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, read_at: now } : x)));
    }
    setOpen(false);
    navigate(`/case/${r.case_id}`);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          void load();
        }}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        aria-label="Notificaciones"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(100vw-2rem,22rem)] rounded-xl border border-slate-100 bg-white py-2 shadow-xl">
          <div className="border-b border-slate-50 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Notificaciones
          </div>
          {loading ? (
            <p className="px-4 py-6 text-xs text-slate-500">Cargando…</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-xs text-slate-500">No hay avisos recientes.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {rows.map((r) => {
                const rad =
                  typeof r.metadata?.radicado === 'string' ? r.metadata.radicado : '';
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => void openCase(r)}
                      className={`flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left text-xs hover:bg-slate-50 ${
                        r.read_at ? 'opacity-70' : 'bg-emerald-50/50'
                      }`}
                    >
                      <span className="font-bold text-slate-800">{r.title}</span>
                      {rad ? (
                        <span className="font-mono text-[11px] text-slate-500">{formatRadicado(rad)}</span>
                      ) : null}
                      {r.body ? <span className="text-slate-600">{r.body}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
