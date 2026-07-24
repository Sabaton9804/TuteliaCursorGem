import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft } from 'lucide-react';
import roadmapMd from '../../docs/correo-roadmap.md?raw';

export default function CorreoRoadmap() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      <Link
        to="/correo"
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-accent"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Volver a Correo
      </Link>
      <header className="space-y-2 border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Roadmap — Módulo Correo</h1>
        <p className="text-sm text-slate-600">Documento interno de prioridades (Outlook / Jurion).</p>
      </header>
      <article className="prose prose-sm max-w-none prose-slate prose-headings:text-slate-900 prose-a:text-accent">
        <ReactMarkdown>{roadmapMd}</ReactMarkdown>
      </article>
    </div>
  );
}
