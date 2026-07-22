/**
 * Arranque de producción: asegura dist/ y levanta server.ts con NODE_ENV=production.
 * Usado por `npm start` (Cloud Run / AI Studio Publish).
 */
import { existsSync } from 'node:fs';
import { spawnSync, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distIndex = path.join(root, 'dist', 'index.html');

if (!existsSync(distIndex)) {
  console.log('[tutelia] dist/index.html no existe; ejecutando npm run build…');
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
}

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production';
}

console.log(`[tutelia] Iniciando Express (NODE_ENV=${process.env.NODE_ENV}, PORT=${process.env.PORT ?? '3451'})…`);

const result = spawnSync('tsx', ['server.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
