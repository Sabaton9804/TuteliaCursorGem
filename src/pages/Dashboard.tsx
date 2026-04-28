import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Case } from '../types';
import { 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  ChevronRight, 
  Filter, 
  ArrowUpDown,
  Search
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { format, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatRadicado } from '../lib/formatters';

export default function Dashboard() {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const navigate = useNavigate();

  useEffect(() => {
    // In a real app we'd get courtId from context
    const courtId = 'court-1';
    const q = query(
      collection(db, 'courts', courtId, 'cases'),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const casesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Case[];
      setCases(casesData);
      setLoading(false);
    }, (error) => {
      console.error("Firestore Error in Dashboard:", error);
      // If permission denied, it might be because the profile is still being created
      // We don't set loading false yet, or we show a small error
      if (error.message.includes('permission-denied')) {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const getSemaforo = (caseItem: Case) => {
    if (caseItem.status === 'archived') return { color: 'bg-gray-200', icon: CheckCircle2, text: 'CERRADO' };
    
    // Mock deadline if not set
    const deadline = caseItem.deadlineAt ? new Date(caseItem.deadlineAt) : new Date();
    const daysLeft = differenceInDays(deadline, new Date());

    if (daysLeft < 0) return { color: 'bg-red-500 text-white', icon: AlertTriangle, text: 'VENCIDO' };
    if (daysLeft < 2) return { color: 'bg-orange-500 text-white', icon: Clock, text: 'URGENTE' };
    return { color: 'bg-green-500 text-white', icon: CheckCircle2, text: 'EN TÉRMINO' };
  };

  const filteredCases = cases.filter(c => {
    const matchesSearch = c.radicado.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          c.claimant.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="card-modern p-6 border-b-4 border-b-accent">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Expedientes Activos</div>
          <div className="text-3xl font-bold text-slate-900 tracking-tight">{cases.length.toString().padStart(3, '0')}</div>
        </div>
        <div className="card-modern p-6 border-b-4 border-b-red-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Términos Críticos</div>
          <div className="text-3xl font-bold text-red-600 tracking-tight">008</div>
        </div>
        <div className="card-modern p-6 border-b-4 border-b-amber-400">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Pendiente Firma</div>
          <div className="text-3xl font-bold text-slate-900 tracking-tight">015</div>
        </div>
        <div className="card-modern p-6 border-b-4 border-b-green-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Sincronización SGDE</div>
          <div className="text-3xl font-bold text-green-600 tracking-tight">134</div>
        </div>
      </div>

      <div className="card-modern overflow-hidden">
        <div className="p-6 border-b border-slate-50 bg-slate-50/30 flex flex-col md:flex-row gap-4 items-center">
          <div className="flex-1 relative w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar por radicado, accionante o demandado..."
              className="input-modern pl-11 bg-white"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex gap-3 w-full md:w-auto">
            <select 
              className="input-modern py-2 min-w-[200px]"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Filtrar por estado: Todos</option>
              <option value="received">Recibidos</option>
              <option value="admitted">Admitidos</option>
              <option value="transfer">Traslado</option>
              <option value="judgment">Fallo</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-white border-b border-slate-100">
                <th className="px-6 py-4 text-left text-[11px] font-bold text-slate-400 uppercase tracking-widest">Identificación Radicado</th>
                <th className="px-6 py-4 text-left text-[11px] font-bold text-slate-400 uppercase tracking-widest">Partes Intervinientes</th>
                <th className="px-6 py-4 text-left text-[11px] font-bold text-slate-400 uppercase tracking-widest">Estado Procesal</th>
                <th className="px-6 py-4 text-left text-[11px] font-bold text-slate-400 uppercase tracking-widest">Vencimiento del Término</th>
                <th className="px-6 py-4 text-left text-[11px] font-bold text-slate-400 uppercase tracking-widest">Responsable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={5} className="p-12 text-center text-sm text-slate-400 animate-pulse font-medium">Consultando sistema judicial...</td></tr>
              ) : filteredCases.length === 0 ? (
                <tr><td colSpan={5} className="p-12 text-center text-sm text-slate-400 font-medium">No hay registros coincidentes para la búsqueda.</td></tr>
              ) : filteredCases.map((c) => {
                const sem = getSemaforo(c);
                return (
                  <tr 
                    key={c.id} 
                    className="hover:bg-slate-50/80 transition-colors cursor-pointer group" 
                    onClick={() => navigate(`/case/${c.id}`)}
                  >
                    <td className="px-6 py-5">
                      <div className="text-sm font-bold text-accent tracking-tight group-hover:underline">{formatRadicado(c.radicado)}</div>
                      <div className="text-[10px] text-slate-400 font-medium mt-0.5">ORDEN DE TUTELA</div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-slate-700">{c.claimant}</span>
                        <div className="flex items-center gap-1.5 mt-1">
                           <span className="text-[9px] font-bold text-slate-300 uppercase">vs</span>
                           <span className="text-[11px] font-medium text-slate-500 truncate max-w-[200px]">{c.defendant || 'ADMINISTRACIÓN PÚBLICA'}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                        c.status === 'received' ? 'bg-blue-50 text-blue-600 border border-blue-100' :
                        c.status === 'admitted' ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                        'bg-slate-100 text-slate-500 border border-slate-200'
                      }`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <div className={`flex items-center gap-2 text-xs font-bold ${sem.text === 'VENCIDO' ? 'text-red-500' : 'text-emerald-600'}`}>
                        <div className={`w-2 h-2 rounded-full ${sem.text === 'VENCIDO' ? 'bg-red-500' : 'bg-emerald-500 shadow-sm'}`} />
                        {c.deadlineAt ? format(new Date(c.deadlineAt), 'dd MMM yyyy', { locale: es }) : '02 días hábiles'}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-500">
                          MA
                        </div>
                        <span className="text-xs font-semibold text-slate-600">Dra. Arango</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      
      <footer className="flex justify-between items-center text-[11px] text-slate-400 font-bold uppercase tracking-widest px-2">
         <div>Filtro: {filteredCases.length} de {cases.length} expedientes operativos</div>
         <div>Última actualización: {format(new Date(), 'hh:mm a')}</div>
      </footer>
    </div>
  );
}
