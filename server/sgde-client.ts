/**
 * Cliente mínimo SGDE / Alfresco público para lectura de árbol de expediente.
 * Basado en el flujo documentado del portal (login webscript + API Alfresco).
 * Credenciales solo en servidor; TLS por defecto verificado (SGDE_TLS_INSECURE=1 solo para diagnóstico).
 */

import axios, { type AxiosInstance } from 'axios';
import https from 'node:https';

const EXPEDIENTE_REGEX = /\d{23}/;

export type SgdeTreeNode = {
  id: string;
  name: string;
  isFolder: boolean;
  tipoDocumental?: string;
  orden?: string;
  children?: SgdeTreeNode[];
};

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

function entryIsFolder(entry: Record<string, unknown>): boolean {
  if (entry.isFolder === true) return true;
  if (entry.isFile === true) return false;
  const nt = String(entry.nodeType || '').toLowerCase();
  return nt.includes('cm:folder') || nt.endsWith(':folder') || nt.includes('folder');
}

export class SgdeClient {
  private readonly base: string;
  private readonly alf: string;
  private readonly back: string;
  private readonly axios: AxiosInstance;
  private accessToken = '';
  private ticket = '';
  private user = '';
  private pwd = '';

  constructor(baseUrl: string) {
    const base = baseUrl.replace(/\/$/, '');
    this.base = base;
    this.alf = `${base}/alfresco/api/-default-/public`;
    this.back = `${base}/backendrama`;
    const insecure = process.env.SGDE_TLS_INSECURE === '1';
    this.axios = axios.create({
      httpsAgent: new https.Agent({ rejectUnauthorized: !insecure }),
      timeout: 45_000,
      validateStatus: () => true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; TuteliaSGDE/1.0; +https://tutelia) Node.js',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'es,es-ES;q=0.9',
        Origin: base,
        Referer: `${base}/expedientes/login`,
      },
    });
  }

  setCredentials(user: string, password: string): void {
    this.user = user.trim();
    this.pwd = password;
  }

  /** Une cabecera Cookie para peticiones posteriores (sesión Alfresco / CSRF). */
  private mergeCookiesFrom(setCookie: string | string[] | undefined): void {
    const prev =
      typeof this.axios.defaults.headers.common.Cookie === 'string'
        ? this.axios.defaults.headers.common.Cookie
        : '';
    const jar = new Map<string, string>();
    for (const part of prev.split(';')) {
      const p = part.trim();
      if (!p.includes('=')) continue;
      const eq = p.indexOf('=');
      jar.set(p.slice(0, eq), p.slice(eq + 1));
    }
    const lines = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    for (const line of lines) {
      const first = line.split(';')[0]?.trim();
      if (!first?.includes('=')) continue;
      const eq = first.indexOf('=');
      jar.set(first.slice(0, eq), first.slice(eq + 1));
    }
    if (jar.size > 0) {
      this.axios.defaults.headers.common.Cookie = [...jar.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    }
  }

  private applyAuthHeader(): void {
    delete this.axios.defaults.headers.common.Authorization;
    if (this.accessToken) {
      this.axios.defaults.headers.common.Authorization = `Bearer ${this.accessToken}`;
    } else if (this.ticket) {
      const inner = this.ticket.startsWith('TICKET_')
        ? `ROLE_TICKET:${this.ticket}`
        : this.ticket;
      this.axios.defaults.headers.common.Authorization = `Basic ${b64(inner)}`;
    }
  }

  async login(): Promise<{ ok: true } | { ok: false; message: string }> {
    this.accessToken = '';
    this.ticket = '';
    this.applyAuthHeader();

    let csrf = '';
    try {
      const r0 = await this.axios.get(`${this.base}/expedientes/login`, { maxRedirects: 5 });
      this.mergeCookiesFrom(r0.headers['set-cookie']);
      const setCookie = r0.headers['set-cookie'];
      if (Array.isArray(setCookie)) {
        for (const line of setCookie) {
          const m = /alf-csrftoken=([^;]+)/.exec(line);
          if (m) csrf = decodeURIComponent(m[1]);
        }
      }
    } catch (e) {
      return { ok: false, message: `No se pudo cargar la página de login SGDE: ${String(e)}` };
    }

    const hdrs: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (csrf) hdrs['alf-csrftoken'] = csrf;

    const body = { username: b64(this.user), password: b64(this.pwd) };
    try {
      const r = await this.axios.post(`${this.base}/alfresco/s/sgde/login`, body, { headers: hdrs });
      this.mergeCookiesFrom(r.headers['set-cookie']);
      if (r.status === 200 || r.status === 201) {
        const data = (r.data || {}) as Record<string, unknown>;
        const token = String(
          data.token || data.access_token || data.accessToken || ''
        ).trim();
        if (token) {
          this.accessToken = token;
          this.applyAuthHeader();
          try {
            const seg = token.split('.')[1];
            if (seg) {
              const pad = seg + '='.repeat((4 - (seg.length % 4)) % 4);
              const payload = JSON.parse(Buffer.from(pad, 'base64').toString('utf8')) as Record<
                string,
                unknown
              >;
              const alf = String(payload.alfTicket || '').trim();
              if (alf) this.ticket = alf;
            }
          } catch {
            /* ignore */
          }
          if (!this.ticket) await this.fetchTicketFallback();
          return { ok: true };
        }
        const tkt = String(data.ticket || '').trim();
        if (tkt.startsWith('TICKET_')) {
          this.ticket = tkt;
          this.accessToken = '';
          this.applyAuthHeader();
          return { ok: true };
        }
        if (r.status === 200 || String(r.headers['set-cookie'] || '').includes('refresh_token')) {
          await this.fetchTicketFallback();
          if (this.ticket || this.accessToken) return { ok: true };
        }
      }
    } catch (e) {
      return { ok: false, message: `Error login webscript SGDE: ${String(e)}` };
    }

    try {
      const r2 = await this.axios.post(
        `${this.alf}/authentication/versions/1/tickets`,
        { userId: this.user, password: this.pwd },
        { headers: { ...hdrs } }
      );
      this.mergeCookiesFrom(r2.headers['set-cookie']);
      if (r2.status === 201) {
        const ent = (r2.data as { entry?: { id?: string } })?.entry;
        const id = String(ent?.id || '').trim();
        if (id) {
          this.ticket = id;
          this.accessToken = '';
          this.applyAuthHeader();
          return { ok: true };
        }
      }
    } catch (e) {
      return { ok: false, message: `Error tickets Alfresco: ${String(e)}` };
    }

    return { ok: false, message: 'No se pudo autenticar contra el SGDE (credenciales o red).' };
  }

  private async fetchTicketFallback(): Promise<void> {
    try {
      const r = await this.axios.post(`${this.alf}/authentication/versions/1/tickets`, {
        userId: this.user,
        password: this.pwd,
      });
      if (r.status === 201) {
        const id = String((r.data as { entry?: { id?: string } })?.entry?.id || '').trim();
        if (id) this.ticket = id;
        this.applyAuthHeader();
      }
    } catch {
      /* ignore */
    }
  }

  private csrf(): string {
    const cookies = this.axios.defaults.headers.common.Cookie;
    if (typeof cookies !== 'string') return '';
    const m = /alf-csrftoken=([^;]+)/.exec(cookies);
    return m ? decodeURIComponent(m[1]) : '';
  }

  async buscarExpedienteNodeId(radicadoRaw: string): Promise<string | null> {
    const radicado = radicadoRaw.replace(/\D/g, '');
    if (!EXPEDIENTE_REGEX.test(radicado)) return null;

    const url = `${this.alf}/search/versions/1/search`;
    const queries = [
      `TYPE:"rama:expedientes" AND =cm:name:"${radicado}"`,
      `TYPE:"rama:expedientes" AND cm:name:"${radicado}"`,
      `TYPE:"rama:expedientes" AND cm:name:"*${radicado}*"`,
    ];
    const csrf = this.csrf();
    const hdrs: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(csrf ? { 'alf-csrftoken': csrf } : {}),
    };

    for (const q of queries) {
      const r = await this.axios.post(
        url,
        { query: { language: 'afts', query: q }, paging: { maxItems: 40, skipCount: 0 } },
        { headers: hdrs }
      );
      if (r.status >= 200 && r.status < 300 && r.data) {
        const entries = (r.data as { list?: { entries?: unknown[] } })?.list?.entries || [];
        let best: { id: string; score: number } | null = null;
        for (const row of entries) {
          const ent =
            row && typeof row === 'object' && 'entry' in row
              ? (row as { entry: Record<string, unknown> }).entry
              : (row as Record<string, unknown>);
          if (!ent?.id) continue;
          const id = String(ent.id);
          const name = String(ent.name || '');
          let score = 0;
          if (name === radicado) score = 1_000_000;
          else if (radicado === name.replace(/\D/g, '')) score = 900_000;
          else if (name.includes(radicado)) score = 100_000 - Math.min(name.length, 99_999);
          if (!best || score > best.score) best = { id, score };
        }
        if (best?.score) return best.id;
      }
    }

    for (const ep of [
      `${this.back}/expedientes/buscar?radicado=${encodeURIComponent(radicado)}`,
      `${this.back}/expedientes/${encodeURIComponent(radicado)}`,
    ] as const) {
      const r = await this.axios.get(ep);
      if (r.status >= 200 && r.status < 300 && r.data) {
        const data = r.data as unknown;
        if (Array.isArray(data) && data.length) {
          for (const row of data) {
            if (row && typeof row === 'object') {
              const o = row as Record<string, unknown>;
              const nid = String(o.nodeId || o.id || '').trim();
              if (nid) return nid;
            }
          }
        } else if (data && typeof data === 'object') {
          const o = data as Record<string, unknown>;
          const nid = String(o.nodeId || o.id || '').trim();
          if (nid) return nid;
        }
      }
    }
    return null;
  }

  async getNodeName(nodeId: string): Promise<string> {
    const url = `${this.alf}/alfresco/versions/1/nodes/${encodeURIComponent(nodeId)}`;
    const csrf = this.csrf();
    const hdrs: Record<string, string> = {
      Accept: 'application/json',
      ...(csrf ? { 'alf-csrftoken': csrf } : {}),
    };
    const r = await this.axios.get(url, {
      headers: hdrs,
      params: { include: 'properties' },
    });
    if (r.status < 200 || r.status >= 300) return '';
    const ent = (r.data as { entry?: { name?: string } })?.entry;
    return String(ent?.name || '').trim();
  }

  async fetchChildren(nodeId: string): Promise<Record<string, unknown>[]> {
    const url = `${this.alf}/alfresco/versions/1/nodes/${encodeURIComponent(nodeId)}/children`;
    const all: Record<string, unknown>[] = [];
    let skip = 0;
    const page = 200;
    const csrf = this.csrf();
    const hdrs: Record<string, string> = {
      Accept: 'application/json',
      ...(csrf ? { 'alf-csrftoken': csrf } : {}),
    };
    while (true) {
      const r = await this.axios.get(url, {
        headers: hdrs,
        params: { maxItems: page, skipCount: skip, include: 'properties' },
      });
      if (r.status < 200 || r.status >= 300) break;
      const raw = (r.data as { list?: { entries?: unknown[] } })?.list?.entries || [];
      const chunk: Record<string, unknown>[] = [];
      for (const e of raw) {
        if (!e || typeof e !== 'object') continue;
        const row = e as Record<string, unknown>;
        const ent = row.entry;
        if (ent && typeof ent === 'object') chunk.push(ent as Record<string, unknown>);
        else if (row.id) chunk.push(row);
      }
      if (!chunk.length) break;
      all.push(...chunk);
      if (chunk.length < page) break;
      skip += page;
    }
    return all;
  }

  async buildTree(
    rootId: string,
    opts: { maxDepth?: number; maxNodes?: number } = {}
  ): Promise<SgdeTreeNode> {
    const maxDepth = opts.maxDepth ?? 8;
    const maxNodes = opts.maxNodes ?? 400;
    let count = 0;

    const walk = async (id: string, name: string, depth: number): Promise<SgdeTreeNode> => {
      count += 1;
      if (count > maxNodes) {
        return { id, name, isFolder: true, children: [] };
      }
      const entries = await this.fetchChildren(id);
      const propsOf = (e: Record<string, unknown>) =>
        (e.properties as Record<string, unknown> | undefined) || {};
      const sorted = [...entries].sort((a, b) => {
        const fa = entryIsFolder(a) ? 0 : 1;
        const fb = entryIsFolder(b) ? 0 : 1;
        if (fa !== fb) return fa - fb;
        return String(a.name || '').localeCompare(String(b.name || ''), 'es', {
          sensitivity: 'base',
        });
      });

      const children: SgdeTreeNode[] = [];
      if (depth < maxDepth) {
        for (const ent of sorted) {
          if (count >= maxNodes) break;
          const nid = String(ent.id || '');
          const nm = String(ent.name || '—');
          const isDir = entryIsFolder(ent);
          const props = propsOf(ent);
          const tipo = String(props['rama:tipoDocumental'] || '').trim();
          const ordenRaw = props['rama:orden'] ?? props['rama:idDocumento'];
          const orden = ordenRaw != null ? String(ordenRaw).trim() : '';
          if (!nid) continue;
          if (isDir) {
            children.push(await walk(nid, nm, depth + 1));
          } else {
            count += 1;
            children.push({
              id: nid,
              name: nm,
              isFolder: false,
              ...(tipo ? { tipoDocumental: tipo } : {}),
              ...(orden ? { orden } : {}),
            });
          }
        }
      }
      return {
        id,
        name,
        isFolder: true,
        children,
      };
    };

    const rootLabel = (await this.getNodeName(rootId)) || rootId;
    return walk(rootId, rootLabel, 0);
  }
}

export function getDefaultSgdeBaseUrl(): string {
  return (
    process.env.SGDE_BASE_URL?.trim() ||
    'https://siugj-sgde.ramajudicial.gov.co'
  ).replace(/\/$/, '');
}
