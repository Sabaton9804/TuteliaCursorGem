/**
 * Árbol SGDE de un CUI (solo lectura).
 * Uso: npx tsx scripts/probe-sgde-tree.mts [radicado23]
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  SgdeClient,
  flattenSgdePdfLeaves,
  getDefaultSgdeBaseUrl,
  sgdeLeafDisplayPath,
} from '../server/sgde-client';
import { decryptSgdePassword } from '../server/sgde-crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
for (const name of ['.env', '.env.local'] as const) {
  const full = path.join(projectRoot, name);
  if (fs.existsSync(full)) dotenv.config({ path: full });
}

const radicado = (process.argv[2] || '11001418907620260061600').replace(/\D/g, '');

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

async function loadCreds() {
  const r = await fetch(
    `${url}/rest/v1/sgde_credentials?select=username,password_ciphertext&order=updated_at.desc&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const row = ((await r.json()) as Array<{ username: string; password_ciphertext: string }>)[0];
  if (!row) throw new Error('Sin credenciales SGDE');
  return {
    username: row.username.trim(),
    password: decryptSgdePassword(row.password_ciphertext),
  };
}

type Tree = { id: string; name: string; isFolder: boolean; children?: Tree[] };

function printTree(n: Tree, indent = '', maxFiles = 8): void {
  if (!n.isFolder) {
    console.log(`${indent}${n.name}`);
    return;
  }
  console.log(`${indent}${n.name}/`);
  const kids = n.children || [];
  const folders = kids.filter((c) => c.isFolder);
  const files = kids.filter((c) => !c.isFolder);
  for (const f of folders) printTree(f, indent + '  ', maxFiles);
  for (const f of files.slice(0, maxFiles)) printTree(f, indent + '  ', maxFiles);
  if (files.length > maxFiles) console.log(`${indent}  ... +${files.length - maxFiles} PDF(s) más`);
}

const creds = await loadCreds();
const client = new SgdeClient(getDefaultSgdeBaseUrl());
client.setCredentials(creds.username, creds.password);
const login = await client.login();
if (!login.ok) throw new Error(login.message);

console.log('Radicado:', radicado);
const rootId = await client.buscarExpedienteNodeId(radicado);
if (!rootId) {
  console.error('No se encontró nodo expediente.');
  process.exit(1);
}
console.log('Root UUID:', rootId);
console.log('Root name:', (await client.getNodeName(rootId)) || '(sin nombre)');

const ch = await client.fetchChildren(rootId);
console.log('\nHijos directos del CUI:');
for (const c of ch) console.log(' -', c.name, '|', c.nodeType);

const tree = await client.buildTree(rootId, { maxDepth: 6, maxNodes: 400 });
console.log('\n=== Árbol (hasta 6 niveles) ===');
printTree(tree as Tree, '', 5);

const leaves = flattenSgdePdfLeaves(tree);
const byTop: Record<string, number> = {};
for (const l of leaves) {
  const top = (l.folderPath || '').split(' / ')[0] || '(raíz)';
  byTop[top] = (byTop[top] || 0) + 1;
}
console.log('\nPDFs por instancia/carpeta raíz:', byTop);
console.log('Total PDFs:', leaves.length);
console.log('\nPrimeras 10 rutas:');
for (const l of leaves.slice(0, 10)) console.log(' -', sgdeLeafDisplayPath(l));
