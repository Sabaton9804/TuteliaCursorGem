import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const mainPath = path.join(os.tmpdir(), 'sgde-main.js');
if (!fs.existsSync(mainPath)) {
  console.error('Missing', mainPath, '- download main.js first');
  process.exit(1);
}
const s = fs.readFileSync(mainPath, 'utf8');
const paths = new Set<string>();
for (const m of s.matchAll(/backendrama\/[a-zA-Z0-9/_-]{3,120}/g)) paths.add(m[0]);

const needles = [
  'despachosCompartidos',
  'mCompartidos',
  'conElDespacho',
  'con el despacho',
  'CON_DESPACHO',
  'mis-compartidos',
  'buscarExpediente',
  'getDespacho',
];
for (const n of needles) {
  let idx = 0;
  let hits = 0;
  while ((idx = s.indexOf(n, idx)) !== -1 && hits < 8) {
    const start = Math.max(0, idx - 90);
    const snippet = s.slice(start, idx + n.length + 90).replace(/\s+/g, ' ');
    console.log(`\n[${n}] …${snippet}…`);
    idx += n.length;
    hits += 1;
  }
}

const comp = [...paths].filter((p) => /compartid|despacho|Despacho|Compartid|expediente/i.test(p)).sort();
console.log('\nexpediente/despacho backendrama paths:', comp.length);
for (const p of comp) console.log(p);
console.log('\nall backendrama paths:', paths.size);

for (const label of [
  'mis-compartidos',
  'misCompartidos',
  'compartidos/',
  'Con el Despacho',
  'conDespacho',
  'despachoCompartido',
  'rama:despachosCompartidos',
  'filterQueries',
]) {
  const idx = s.indexOf(label);
  if (idx >= 0) {
    console.log(`\n=== ${label} ===`);
    console.log(s.slice(Math.max(0, idx - 120), idx + 280).replace(/\s+/g, ' '));
  }
}

// buscarExpedientexName full query template
const bx = s.indexOf('buscarExpedientexName');
if (bx >= 0) console.log('\n=== buscarExpedientexName ===\n', s.slice(bx, bx + 600).replace(/\s+/g, ' '));

const dc = s.indexOf('rama:despachosCompartidos');
if (dc >= 0) {
  console.log('\n=== despachosCompartidos block (2k) ===\n');
  console.log(s.slice(Math.max(0, dc - 800), dc + 1200).replace(/\s+/g, ' '));
}

let pos = 0;
let hit = 0;
while ((pos = s.indexOf('rama:despachosCompartidos', pos)) !== -1 && hit < 9) {
  console.log(`\n--- hit ${hit + 1} @${pos} ---`);
  console.log(s.slice(Math.max(0, pos - 200), pos + 350).replace(/\s+/g, ' '));
  pos += 1;
  hit += 1;
}

const gdu = s.indexOf('getDespachoByUser');
if (gdu >= 0) {
  console.log('\n=== getDespachoByUser ===\n');
  console.log(s.slice(gdu, gdu + 500).replace(/\s+/g, ' '));
}
