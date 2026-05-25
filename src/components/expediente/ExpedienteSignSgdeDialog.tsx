import React, { useEffect, useState } from 'react';
import { Loader2, PenLine, X } from 'lucide-react';
import { fetchSgdeUserStatus, sgdeSignDocument } from '../../lib/sgde-api';
import type { Document } from '../../types';

type Props = {
  open: boolean;
  caseId: string;
  doc: Document | null;
  onClose: () => void;
  onSigned: () => void;
};

export function ExpedienteSignSgdeDialog({ open, caseId, doc, onClose, onSigned }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setErr(null);
    setHint(null);
    void fetchSgdeUserStatus()
      .then((s) => {
        setConfigured(s.userConfigured);
        if (s.usernameMasked) {
          setHint(`Usuario configurado: ${s.usernameMasked}`);
        }
        if (!s.userConfigured) {
          setErr('Configure SGDE en Ajustes → Interconexión SGDE antes de firmar.');
        }
      })
      .catch(() => {
        setHint(null);
        setConfigured(false);
      });
  }, [open]);

  if (!open || !doc) return null;

  const docName = doc.name?.trim() || 'Documento';

  const handleSign = async () => {
    setErr(null);
    const user = username.trim();
    const pass = password;
    if (!user && !configured) {
      setErr('Indique su usuario SGDE o configúrelo en Ajustes.');
      return;
    }
    if (!pass) {
      setErr('Indique su contraseña SGDE (la misma del portal de la Rama).');
      return;
    }
    setBusy(true);
    try {
      const result = await sgdeSignDocument({
        caseId,
        documentId: doc.id,
        ...(user ? { username: user } : {}),
        password: pass,
        refreshLocal: true,
      });
      onSigned();
      onClose();
      if (result.message) {
        // El padre puede mostrar toast; por ahora alert breve opcional — evitamos alert, el refetch basta
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo firmar en SGDE.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sgde-sign-title"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-600">
              <PenLine className="h-4 w-4" />
            </span>
            <div>
              <h4 id="sgde-sign-title" className="text-sm font-bold text-slate-800">
                Firmar en SGDE
              </h4>
              <p className="mt-0.5 text-[11px] text-slate-500 line-clamp-2" title={docName}>
                {docName}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-slate-600">
          La firma se realiza en el expediente electrónico de la Rama (mismo servicio que el portal
          SGDE). Tras firmar, Tutelia descargará la nueva versión del PDF al expediente digital.
        </p>

        {hint ? <p className="mt-2 text-[10px] text-slate-500">{hint}</p> : null}

        <div className="mt-4 space-y-3">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Usuario SGDE
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Si está en Ajustes, puede dejarlo vacío"
              className="input-modern mt-1 w-full text-sm"
              disabled={busy}
            />
          </label>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Contraseña SGDE
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Contraseña del portal"
              className="input-modern mt-1 w-full text-sm"
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) void handleSign();
              }}
            />
          </label>
        </div>

        {err ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
            {err}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSign()}
            className="inline-flex items-center gap-2 rounded-lg bg-[#274a8a] px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-[#1e3a6f] disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
            Sí, firmar
          </button>
        </div>
      </div>
    </div>
  );
}
