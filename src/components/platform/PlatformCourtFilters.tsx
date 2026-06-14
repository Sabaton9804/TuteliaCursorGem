import React from 'react';
import type { JudicialCatalogs, PlatformCourtFilters } from '../../services/platformCourtService';

type Props = {
  filters: PlatformCourtFilters;
  catalogs: JudicialCatalogs | null;
  onChange: (next: PlatformCourtFilters) => void;
};

export default function PlatformCourtFiltersBar({ filters, catalogs, onChange }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
      <input
        type="search"
        placeholder="Buscar nombre, id, ciudad…"
        className="input-modern xl:col-span-2"
        value={filters.q ?? ''}
        onChange={(e) => onChange({ ...filters, q: e.target.value })}
      />
      <select
        className="input-modern"
        value={filters.status ?? 'all'}
        onChange={(e) => onChange({ ...filters, status: e.target.value })}
      >
        <option value="all">Estado: todos</option>
        <option value="active">Activos</option>
        <option value="inactive">Inactivos</option>
        <option value="suspended">Suspendidos</option>
      </select>
      <select
        className="input-modern"
        value={filters.judicialSpecialtyId ?? ''}
        onChange={(e) =>
          onChange({ ...filters, judicialSpecialtyId: e.target.value || undefined })
        }
      >
        <option value="">Especialidad: todas</option>
        {(catalogs?.specialties ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <select
        className="input-modern"
        value={filters.territoryId ?? ''}
        onChange={(e) => onChange({ ...filters, territoryId: e.target.value || undefined })}
      >
        <option value="">Territorio: todos</option>
        {(catalogs?.territories ?? []).map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.department})
          </option>
        ))}
      </select>
      <select
        className="input-modern md:col-span-2 xl:col-span-1"
        value={filters.entityCategoryId ?? ''}
        onChange={(e) =>
          onChange({ ...filters, entityCategoryId: e.target.value || undefined })
        }
      >
        <option value="">Categoría: todas</option>
        {(catalogs?.categories ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}
