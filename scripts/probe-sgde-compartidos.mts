/**
 * Prueba búsqueda de expediente en Mis compartidos (compartirUnificado).
 * Uso: npx tsx scripts/probe-sgde-compartidos.mts [radicado23] [userId?]
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SgdeClient, getDefaultSgdeBaseUrl } from '../server/sgde-client';
import { decryptSgdePassword } from '../server/sgde-crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

for (const name of ['.env', '.env.local'] as const) {
  const full = path.join(projectRoot, name);
  if (fs.existsSync(full)) dotenv.config({ path: full });
}

const radicado = (process.argv[2] || '11001418907620260061600').replace(/\D/g, '');
const userIdArg = process.argv[3]?.trim();

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

async function supabaseRest<T>(path: string): Promise<T> {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/json',
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Supabase REST ${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json() as Promise<T>;
}

type Creds = { username: string; password: string };

async function loadCreds(): Promise<Creds> {
  const probeUser = process.env.SGDE_PROBE_USER?.trim();
  const probePass = process.env.SGDE_PROBE_PASSWORD ?? '';
  if (probeUser && probePass) {
    console.log('Credenciales: SGDE_PROBE_USER');
    return { username: probeUser, password: probePass };
  }

  if (!url || !serviceKey) {
    console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o use SGDE_PROBE_USER/PASSWORD).');
    process.exit(1);
  }

  let userId = userIdArg;
  if (!userId) {
    const rows = await supabaseRest<Array<{ user_id: string; username: string; updated_at: string }>>(
      'sgde_credentials?select=user_id,username,updated_at&order=updated_at.desc&limit=1'
    );
    userId = rows?.[0]?.user_id;
    if (!userId) {
      console.error('No hay credenciales SGDE guardadas. Configure en Ajustes → Interconexión SGDE.');
      process.exit(1);
    }
    console.log('Usuario SGDE:', rows[0].username?.slice(0, 3) + '***', '| user_id:', userId);
  }

  const rows = await supabaseRest<Array<{ username: string; password_ciphertext: string }>>(
    `sgde_credentials?select=username,password_ciphertext&user_id=eq.${encodeURIComponent(userId!)}`
  );
  const row = rows?.[0];
  if (!row?.username || !row.password_ciphertext) {
    console.error('Sin fila sgde_credentials para', userId);
    process.exit(1);
  }
  try {
    return { username: row.username.trim(), password: decryptSgdePassword(row.password_ciphertext) };
  } catch (e) {
    console.error('Error descifrando contraseña:', (e as Error).message);
    process.exit(1);
  }
}

const creds = await loadCreds();

const baseUrl = getDefaultSgdeBaseUrl();
console.log('SGDE base:', baseUrl);
console.log('Radicado:', radicado);

const client = new SgdeClient(baseUrl);
client.setCredentials(creds.username, creds.password);

console.log('\n--- Login ---');
const login = await client.login();
if (!login.ok) {
  console.error('Login falló:', login.message);
  process.exit(1);
}
console.log('Login OK');

console.log('\n--- buscarExpedienteEnCompartidos ---');
const compartidoId = await client.buscarExpedienteEnCompartidos(radicado);
console.log('UUID compartidos:', compartidoId || '(no encontrado)');

console.log('\n--- buscarExpedienteNodeId (flujo completo) ---');
const nodeId = await client.buscarExpedienteNodeId(radicado);
console.log('nodeId final:', nodeId || '(no encontrado)');

if (nodeId) {
  const name = await client.getNodeName(nodeId);
  console.log('Nombre nodo:', name || '(vacío)');
  console.log('Desde compartidos:', client.wasLastNodeFromCompartidos());
  const backendNode = await client.getNodeViaBackend(nodeId, 'path,properties');
  if (backendNode) {
    console.log('Backend getNode name:', backendNode.name, '| type:', backendNode.nodeType);
    const pathEls = (backendNode.path as { elements?: Array<{ name?: string; nodeType?: string }> })?.elements;
    if (pathEls?.length) {
      console.log('Path:', pathEls.map((e) => e.name).filter(Boolean).join(' / '));
    }
  } else {
    console.log('Backend getNode: (sin respuesta)');
  }
  const ch = await client.fetchChildren(nodeId);
  console.log('fetchChildren count:', ch.length);
  for (const c of ch.slice(0, 5)) console.log(' -', c.name, c.nodeType);
  const leaves = await client.collectPdfLeavesForExpediente(nodeId, {
    maxDepth: 8,
    maxNodes: 200,
    maxSearchDocs: 100,
    originRadicado: radicado,
  });
  console.log('PDFs encontrados:', leaves.length);
  for (const l of leaves.slice(0, 8)) {
    console.log(' -', l.folderPath ? `${l.folderPath} / ${l.name}` : l.name);
  }
  if (leaves.length > 8) console.log(` ... y ${leaves.length - 8} más`);
}
