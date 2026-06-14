import React, { useState } from 'react';
import { X } from 'lucide-react';
import { createPlatformCourt, type JudicialCatalogs } from '../../services/platformCourtService';
import type { UserRole } from '../../types';

type Props = {
  catalogs: JudicialCatalogs | null;
  onClose: () => void;
  onCreated: () => void;
};

export default function PlatformCreateCourtModal({ catalogs, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [city, setCity] = useState('');
  const [email, setEmail] = useState('');
  const [territoryId, setTerritoryId] = useState('');
  const [specialtyId, setSpecialtyId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [daneCode, setDaneCode] = useState('');
  const [entityCode, setEntityCode] = useState('');
  const [specialtyCode, setSpecialtyCode] = useState('');
  const [despachoNumber, setDespachoNumber] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPassword, setAdminPassword] = useState('123456');
  const [adminRole, setAdminRole] = useState<UserRole>('admin');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onTerritoryChange = (tid: string) => {
    setTerritoryId(tid);
    const t = catalogs?.territories.find((x) => x.id === tid);
    if (t) {
      setCity(t.name);
      setDaneCode(t.dane_code);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createPlatformCourt({
        id: id.trim() || undefined,
        name: name.trim(),
        city: city.trim(),
        email: email.trim(),
        territory_id: territoryId || undefined,
        judicial_specialty_id: specialtyId || undefined,
        entity_category_id: categoryId || undefined,
        dane_code: daneCode.trim() || undefined,
        entity_code: entityCode.trim() || undefined,
        specialty_code: specialtyCode.trim() || undefined,
        despacho_number: despachoNumber.trim() || undefined,
        adminUser: adminEmail.trim()
          ? {
              email: adminEmail.trim(),
              name: adminName.trim() || adminEmail.trim(),
              password: adminPassword.trim(),
              role: adminRole,
            }
          : undefined,
      });
      onCreated();
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Crear despacho</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={(e) => void submit(e)} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block sm:col-span-2">
              <span className="text-xs font-bold text-slate-500 uppercase">Nombre *</span>
              <input className="input-modern mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Id (opcional)</span>
              <input
                className="input-modern mt-1 font-mono text-sm"
                placeholder="court-999"
                value={id}
                onChange={(e) => setId(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Correo notificaciones</span>
              <input className="input-modern mt-1" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Territorio</span>
              <select className="input-modern mt-1" value={territoryId} onChange={(e) => onTerritoryChange(e.target.value)}>
                <option value="">—</option>
                {(catalogs?.territories ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Especialidad</span>
              <select className="input-modern mt-1" value={specialtyId} onChange={(e) => setSpecialtyId(e.target.value)}>
                <option value="">—</option>
                {(catalogs?.specialties ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Categoría entidad</span>
              <select className="input-modern mt-1" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">—</option>
                {(catalogs?.categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">DANE</span>
              <input className="input-modern mt-1 font-mono" value={daneCode} onChange={(e) => setDaneCode(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Entidad CUI</span>
              <input className="input-modern mt-1 font-mono" value={entityCode} onChange={(e) => setEntityCode(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Especialidad CUI</span>
              <input className="input-modern mt-1 font-mono" value={specialtyCode} onChange={(e) => setSpecialtyCode(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Nº despacho</span>
              <input className="input-modern mt-1 font-mono" value={despachoNumber} onChange={(e) => setDespachoNumber(e.target.value)} />
            </label>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-bold text-slate-500 uppercase mb-3">Administrador inicial (opcional)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block sm:col-span-2">
                <span className="text-xs text-slate-500">Email</span>
                <input className="input-modern mt-1" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Nombre</span>
                <input className="input-modern mt-1" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Contraseña temporal</span>
                <input className="input-modern mt-1" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
              </label>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50"
            >
              {saving ? 'Creando…' : 'Crear despacho'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
