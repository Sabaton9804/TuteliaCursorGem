/**
 * Diagnóstico: permisos Alfresco sobre UUID devuelto por compartirUnificado.
 * Uso: npx tsx scripts/probe-sgde-compartidos-access.mts [radicado23]
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import https from 'https';
import { SgdeClient, getDefaultSgdeBaseUrl } from '../server/sgde-client';
import { decryptSgdePassword } from '../server/sgde-crypto';
import { isSgdeTlsInsecure } from '../server/sgde-tls';

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

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

const creds = await loadCreds();
const base = getDefaultSgdeBaseUrl();
const alf = `${base}/alfresco/api/-default-/public`;
const back = `${base}/backendrama`;

const insecure = isSgdeTlsInsecure();
const http = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: !insecure }),
  timeout: 60_000,
  validateStatus: () => true,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; TuteliaSGDE/1.0) Node.js',
    Accept: 'application/json, text/plain, */*',
    Origin: base,
    Referer: `${base}/expedientes/login`,
  },
});

console.log('Login SGDE...');
let csrf = '';
const r0 = await http.get(`${base}/expedientes/login`);
for (const line of ([] as string[]).concat(r0.headers['set-cookie'] || [])) {
  const m = /alf-csrftoken=([^;]+)/.exec(line);
  if (m) csrf = decodeURIComponent(m[1]);
}
const loginBody = { username: b64(creds.username), password: b64(creds.password) };
const lr = await http.post(`${base}/alfresco/s/sgde/login`, loginBody, {
  headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(csrf ? { 'alf-csrftoken': csrf } : {}) },
});
const loginData = (lr.data || {}) as Record<string, unknown>;
const token = String(loginData.token || loginData.access_token || loginData.accessToken || '').trim();
if (!token && lr.status !== 200 && lr.status !== 201) {
  throw new Error(`Login falló HTTP ${lr.status}: ${JSON.stringify(loginData).slice(0, 200)}`);
}
if (!token) throw new Error(`Login sin token HTTP ${lr.status}: ${JSON.stringify(loginData).slice(0, 200)}`);
http.defaults.headers.common.Authorization = `Bearer ${token}`;
let ticket = '';
try {
  const seg = token.split('.')[1];
  const pad = seg + '='.repeat((4 - (seg.length % 4)) % 4);
  const payload = JSON.parse(Buffer.from(pad, 'base64').toString('utf8')) as Record<string, unknown>;
  ticket = String(payload.alfTicket || '').trim();
} catch {
  /* ignore */
}
console.log('Login OK | ticket:', ticket ? `${ticket.slice(0, 12)}…` : '(no)');

// Contexto compartidos
const usuarios = new Set<string>([creds.username]);
const gr = await http.get(`${alf}/alfresco/versions/1/people/-me-/groups`, {
  params: { include: 'description' },
  headers: { ...(csrf ? { 'alf-csrftoken': csrf } : {}) },
});
for (const row of (gr.data as { list?: { entries?: unknown[] } })?.list?.entries || []) {
  const ent = row && typeof row === 'object' && 'entry' in row ? (row as { entry: { id?: string } }).entry : (row as { id?: string });
  const id = String(ent?.id || '');
  if (id.includes('GROUP_OFPR')) usuarios.add(id);
}
console.log('Grupos OFPR:', [...usuarios].filter((u) => u.startsWith('GROUP_')));

// compartirUnificado — fila completa
const compBody = {
  expediente: radicado,
  usuarios: [...usuarios],
  despachos: null,
  usuarioBusquedaLibre: null,
  fechaInicio: null,
  fechaFin: null,
  page: 0,
  size: 5,
  sortBy: 'fechaCompartir',
  asc: false,
};
const compR = await http.post(`${back}/interno/compartirUnificado`, compBody, {
  headers: { 'Content-Type': 'application/json', ...(csrf ? { 'alf-csrftoken': csrf } : {}) },
});
console.log('\ncompartirUnificado HTTP', compR.status, '| total:', (compR.data as { totalElements?: number })?.totalElements);
const content = (compR.data as { content?: unknown[] })?.content || [];
for (const [i, row] of content.entries()) {
  console.log(`\n--- fila ${i} (JSON) ---`);
  console.log(JSON.stringify(row, null, 2));
}

const first = content[0] as Record<string, unknown> | undefined;
const comp = (first?.compartir && typeof first.compartir === 'object' ? first.compartir : first) as Record<string, unknown> | undefined;
const nodeId = String(comp?.uuid ?? comp?.nodeId ?? '').toLowerCase();
if (!nodeId) {
  console.error('Sin UUID en respuesta compartidos');
  process.exit(1);
}
console.log('\n=== Probar acceso Alfresco sobre UUID:', nodeId, '===');

async function probe(label: string, method: 'GET' | 'POST', url: string, body?: unknown) {
  const hdrs: Record<string, string> = { ...(csrf ? { 'alf-csrftoken': csrf } : {}) };
  if (body) hdrs['Content-Type'] = 'application/json';
  const r =
    method === 'GET'
      ? await http.get(url, { headers: hdrs })
      : await http.post(url, body, { headers: hdrs });
  const snippet =
    typeof r.data === 'string'
      ? r.data.slice(0, 120)
      : JSON.stringify(r.data)?.slice(0, 200) || '';
  console.log(`${label}: HTTP ${r.status} | ${snippet}${snippet.length >= 200 ? '…' : ''}`);
  return r;
}

await probe('GET node metadata', 'GET', `${alf}/alfresco/versions/1/nodes/${nodeId}?include=properties,path,permissions`);
await probe('GET node children', 'GET', `${alf}/alfresco/versions/1/nodes/${nodeId}/children?maxItems=5&include=properties`);
await probe('GET node content (head)', 'GET', `${alf}/alfresco/versions/1/nodes/${nodeId}/content`);

const ancestor = `workspace://SpacesStore/${nodeId}`;
await probe(
  'POST search ANCESTOR',
  'POST',
  `${alf}/search/versions/1/search`,
  {
    query: {
      query: `TYPE:('rama:carpetaDocumento' OR 'rama:documentos') and ANCESTOR:'${ancestor}' and ISUNSET:'rama:eliminadoLogico'`,
      language: 'afts',
    },
    paging: { maxItems: 5, skipCount: 0 },
  }
);

await probe(
  'POST search expediente by CUI',
  'POST',
  `${alf}/search/versions/1/search`,
  {
    query: {
      query: `TYPE:'rama:expedientes' and cm:name:'${radicado}' and ISUNSET:'rama:eliminadoLogico'`,
      language: 'afts',
    },
    paging: { maxItems: 5, skipCount: 0 },
  }
);

// Endpoints backend SGDE
await probe('POST abrir_expediente', 'POST', `${back}/indice/abrir_expediente/${nodeId}`, {});
await probe('POST abrir_instancia', 'POST', `${back}/indice/abrir_instancia/${nodeId}`, {});
await probe('POST valida_expediente', 'POST', `${back}/indice/valida_expediente/${nodeId}`, {});

console.log('\n--- Tras abrir_expediente: reintento Alfresco ---');
await probe('GET node metadata (2)', 'GET', `${alf}/alfresco/versions/1/nodes/${nodeId}?include=properties,path,permissions`);
await probe('GET node children (2)', 'GET', `${alf}/alfresco/versions/1/nodes/${nodeId}/children?maxItems=5&include=properties`);
await probe('GET findById interno', 'GET', `${back}/interno/findById/${nodeId}`);
await probe(
  'GET allUserCompInter',
  'GET',
  `${back}/interno/allUserCompInter?despacho=${encodeURIComponent(String(comp?.despacho || ''))}&uuid=${nodeId}`
);

// Cliente Tutelia (misma sesión axios aparte)
console.log('\n=== Cliente SgdeClient (login propio) ===');
const client = new SgdeClient(base);
client.setCredentials(creds.username, creds.password);
const login = await client.login();
console.log('client.login:', login.ok ? 'OK' : login.message);
if (login.ok) {
  console.log('getNodeName:', (await client.getNodeName(nodeId)) || '(vacío)');
  const ch = await client.fetchChildren(nodeId);
  console.log('fetchChildren count:', ch.length);
  for (const c of ch.slice(0, 5)) console.log(' -', c.name, c.nodeType);
  const leaves = await client.fetchPdfLeavesViaSearch(nodeId, { maxDocs: 10 });
  console.log('fetchPdfLeavesViaSearch:', leaves.length);
}
