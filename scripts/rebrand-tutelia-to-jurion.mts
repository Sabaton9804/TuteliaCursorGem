/**
 * Reemplaza la marca visible «Tutelia» → «Jurion» sin tocar identificadores técnicos.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const TARGET_DIRS = ['src', 'server'] as const;
const TARGET_FILES = [
  'index.html',
  'metadata.json',
  'README.md',
  '.env.example',
  'Dockerfile',
] as const;

const EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.html', '.json', '.md']);

/** Identificadores técnicos que conservan «Tutelia» (compatibilidad). */
const PRESERVE_LITERALS = [
  'TuteliaAlignCenter',
  'TuteliaAlignRight',
  'TuteliaAlignJustify',
  'cleanupTuteliaPdfGenerationOverlays',
  'X-Tutelia-Mailbox-Id',
  'tutelia_outlook_active_mailbox_id',
  'tutelia_outlook_radicacion',
  'tutelia_correo_limits_dismissed',
  'tutelia_new_case_draft',
  'tutelia_ai_analysis_cache_v4',
  'tutelia_fresh_new_case_nav',
  'tutelia_mock_user',
  'tutelia_plantillas_v1',
  'tutelia-despacho-new-comment',
  'tutelia-despacho-review-rail',
  'tutelia-pdf-from-docx',
  'tutelia-docxjs-wrapper',
  'tutelia-docxjs',
  'tutelia-mammoth-pdf',
  'tutelia-align-center',
  'tutelia-align-right',
  'tutelia-align-justify',
  'data-tutelia-pdf-host',
  'admin@tutelia.local',
  'tutelia-despacho.seed',
  'tutelia_core',
  'tutelia_workflow',
];

function rebrandContent(content: string): { next: string; count: number } {
  const tokens: string[] = [];
  let work = content;
  for (let i = 0; i < PRESERVE_LITERALS.length; i += 1) {
    const literal = PRESERVE_LITERALS[i]!;
    const token = `__JURION_PRESERVE_${i}__`;
    if (work.includes(literal)) {
      work = work.split(literal).join(token);
      tokens.push(token, literal);
    }
  }

  let count = 0;
  work = work.replace(/\bTutelia\b/g, () => {
    count += 1;
    return 'Jurion';
  });

  for (let i = 0; i < tokens.length; i += 2) {
    work = work.split(tokens[i]!).join(tokens[i + 1]!);
  }

  return { next: work, count };
}

function walkDir(dir: string, out: string[]): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist') continue;
      walkDir(full, out);
      continue;
    }
    const ext = path.extname(ent.name);
    if (EXTENSIONS.has(ext)) out.push(full);
  }
}

const files: string[] = [];
for (const d of TARGET_DIRS) walkDir(path.join(ROOT, d), files);
for (const f of TARGET_FILES) {
  const full = path.join(ROOT, f);
  if (fs.existsSync(full)) files.push(full);
}

let total = 0;
let touched = 0;
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const { next, count } = rebrandContent(content);
  if (count === 0) continue;
  fs.writeFileSync(file, next, 'utf8');
  total += count;
  touched += 1;
  console.log(`${path.relative(ROOT, file)}: ${count}`);
}

console.log(`\nListo: ${total} reemplazos en ${touched} archivos.`);
