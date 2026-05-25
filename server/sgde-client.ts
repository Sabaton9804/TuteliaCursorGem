/**
 * Cliente mínimo SGDE / Alfresco público para lectura de árbol de expediente.
 * Basado en el flujo documentado del portal (login webscript + API Alfresco).
 * Credenciales solo en servidor; TLS por defecto verificado (SGDE_TLS_INSECURE=1 solo para diagnóstico).
 */

import axios, { type AxiosInstance } from 'axios';
import https from 'node:https';
import { encryptSgdePortalPassword } from './sgde-sign-crypto';
import { formatSgdeConnectionError, isSgdeTlsInsecure } from './sgde-tls';

const EXPEDIENTE_REGEX = /\d{23}/;

export type SgdeTreeNode = {
  id: string;
  name: string;
  isFolder: boolean;
  tipoDocumental?: string;
  orden?: string;
  children?: SgdeTreeNode[];
};

export type SgdePdfLeaf = {
  id: string;
  name: string;
  tipoDocumental?: string;
  orden?: string;
  /** Ruta de carpetas SGDE (p. ej. Primera Instancia / 01CdoPrincipal). */
  folderPath?: string;
};

/** Recorre el árbol (carpetas anidadas) y devuelve hojas PDF. */
export function flattenSgdePdfLeaves(
  node: SgdeTreeNode,
  out: SgdePdfLeaf[] = [],
  folderPath = ''
): SgdePdfLeaf[] {
  if (!node.isFolder) {
    const nm = String(node.name || '').trim();
    const lower = nm.toLowerCase();
    if (!lower || lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      return out;
    }
    if (lower.endsWith('.pdf') || !lower.includes('.')) {
      out.push({
        id: node.id,
        name: nm,
        tipoDocumental: node.tipoDocumental,
        orden: node.orden,
        ...(folderPath ? { folderPath } : {}),
      });
    }
    return out;
  }
  for (const ch of node.children || []) {
    const childPath = folderPath
      ? `${folderPath} / ${String(ch.name || '').trim()}`
      : String(ch.name || '').trim();
    if (ch.isFolder) {
      flattenSgdePdfLeaves(ch, out, childPath);
    } else {
      flattenSgdePdfLeaves(ch, out, folderPath);
    }
  }
  return out;
}

export function sgdeLeafDisplayPath(leaf: SgdePdfLeaf): string {
  return leaf.folderPath ? `${leaf.folderPath} / ${leaf.name}` : leaf.name;
}

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

function entryIsFolder(entry: Record<string, unknown>): boolean {
  const nt = String(entry.nodeType || '').toLowerCase();
  if (nt.includes('rama:documentos')) return false;
  if (entry.isFolder === true) return true;
  if (entry.isFile === true) return false;
  if (nt.includes('rama:carpeta') || nt.includes('rama:expedientes') || nt.includes('rama:instancia')) {
    return true;
  }
  return nt.includes('cm:folder') || nt.endsWith(':folder') || nt.includes('folder');
}

function entryToPdfLeaf(ent: Record<string, unknown>, folderPath?: string): SgdePdfLeaf | null {
  const nt = String(ent.nodeType || '').toLowerCase();
  if (!nt.includes('rama:documentos') && !nt.includes('documentos')) {
    const nm0 = String(ent.name || '').toLowerCase();
    if (!nm0.endsWith('.pdf')) return null;
  }
  const nm = String(ent.name || '').trim();
  if (!nm) return null;
  const lower = nm.toLowerCase();
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return null;
  const id = String(ent.id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const props = (ent.properties as Record<string, unknown> | undefined) || {};
  const tipo = String(props['rama:tipoDocumental'] || '').trim();
  const ordenRaw = props['rama:orden'] ?? props['rama:idDocumento'];
  const orden = ordenRaw != null ? String(ordenRaw).trim() : '';
  return {
    id: id.toLowerCase(),
    name: nm,
    ...(tipo ? { tipoDocumental: tipo } : {}),
    ...(orden ? { orden } : {}),
    ...(folderPath ? { folderPath } : {}),
  };
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
  /** Último nodeId resuelto vía Mis compartidos (Alfresco público suele devolver 401). */
  private nodeFromCompartidos = false;

  constructor(baseUrl: string) {
    const base = baseUrl.replace(/\/$/, '');
    this.base = base;
    this.alf = `${base}/alfresco/api/-default-/public`;
    this.back = `${base}/backendrama`;
    const insecure = isSgdeTlsInsecure();
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
      return {
        ok: false,
        message: formatSgdeConnectionError(`No se pudo cargar la página de login SGDE: ${String(e)}`),
      };
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

  private jsonHeaders(): Record<string, string> {
    const csrf = this.csrf();
    return {
      Accept: 'application/json',
      ...(csrf ? { 'alf-csrftoken': csrf } : {}),
    };
  }

  private ticketAuthHeader(): string | null {
    if (!this.ticket) return null;
    const inner = this.ticket.startsWith('TICKET_')
      ? `ROLE_TICKET:${this.ticket}`
      : this.ticket;
    return `Basic ${b64(inner)}`;
  }

  /** Restaura Authorization previa tras un request con alf_ticket. */
  private async withTicketAlfrescoAuth<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.axios.defaults.headers.common.Authorization;
    const ticketHdr = this.ticketAuthHeader();
    if (ticketHdr) this.axios.defaults.headers.common.Authorization = ticketHdr;
    try {
      return await fn();
    } finally {
      if (ticketHdr) {
        if (prev) this.axios.defaults.headers.common.Authorization = prev;
        else delete this.axios.defaults.headers.common.Authorization;
      }
    }
  }

  /**
   * GET /backendrama/getNode/{uuid}?alf_ticket=… — mismo proxy que SGDE en compartidos (flag=true).
   */
  async getNodeViaBackend(
    nodeId: string,
    include = 'path,properties,permissions,allowableOperations'
  ): Promise<Record<string, unknown> | null> {
    if (!this.ticket) await this.fetchTicketFallback();
    const params: Record<string, string> = { include };
    if (this.ticket) params.alf_ticket = this.ticket;
    const r = await this.axios.get(`${this.back}/getNode/${encodeURIComponent(nodeId)}`, {
      params,
      headers: this.jsonHeaders(),
    });
    if (r.status < 200 || r.status >= 300) {
      console.warn(`[sgde] getNode backend HTTP ${r.status} ${nodeId.slice(0, 8)}…`);
      return null;
    }
    const ent = (r.data as { entry?: Record<string, unknown> })?.entry;
    return ent && typeof ent === 'object' ? ent : null;
  }

  /** Indica si el último nodeId vino de Mis compartidos. */
  wasLastNodeFromCompartidos(): boolean {
    return this.nodeFromCompartidos;
  }

  private limpiarIdGrupoOfpr(groupId: string): string {
    return groupId.replace(/^GROUP_(?:OFPR\s+)?/i, '').trim();
  }

  private radicadosCoinciden(a: string, b: string): boolean {
    if (!a || !b) return false;
    if (a === b) return true;
    return a.includes(b) || b.includes(a);
  }

  private collectGroupIdsFromPayload(data: unknown): string[] {
    const out: string[] = [];
    const walk = (obj: unknown, depth: number): void => {
      if (depth > 12 || obj == null) return;
      if (Array.isArray(obj)) {
        for (const x of obj) walk(x, depth + 1);
        return;
      }
      if (typeof obj !== 'object') return;
      const o = obj as Record<string, unknown>;
      for (const key of ['id', 'authorityId', 'name', 'groupId', 'shortName']) {
        const v = String(o[key] ?? '').trim();
        if (v.includes('GROUP_')) out.push(v);
      }
      for (const v of Object.values(o)) walk(v, depth + 1);
    };
    walk(data, 0);
    return out;
  }

  /** Usuario + grupos OFPR, igual que la pantalla Mis compartidos del portal SGDE. */
  private async fetchMyCompartidosContext(): Promise<{
    usuarios: string[];
    despachoEmisor: string[];
  }> {
    const usuarios = new Set<string>();
    if (this.user) usuarios.add(this.user);

    const csrf = this.csrf();
    const hdrs: Record<string, string> = {
      Accept: 'application/json',
      ...(csrf ? { 'alf-csrftoken': csrf } : {}),
    };

    const peoplePaths = [
      `${this.alf}/alfresco/versions/1/people/-me-/groups`,
      this.user
        ? `${this.alf}/alfresco/versions/1/people/${encodeURIComponent(this.user)}/groups`
        : null,
    ].filter(Boolean) as string[];

    for (const url of peoplePaths) {
      try {
        const r = await this.axios.get(url, {
          headers: hdrs,
          params: { include: 'description' },
        });
        if (r.status >= 200 && r.status < 300 && r.data) {
          const entries = (r.data as { list?: { entries?: unknown[] } })?.list?.entries || [];
          for (const row of entries) {
            const ent =
              row && typeof row === 'object' && 'entry' in row
                ? (row as { entry: { id?: string } }).entry
                : (row as { id?: string });
            const id = String(ent?.id || '').trim();
            if (id.includes('GROUP_OFPR')) usuarios.add(id);
          }
        }
      } catch {
        /* siguiente */
      }
    }

    if (this.user) {
      try {
        const r = await this.axios.get(`${this.back}/grupos/peopleGroupsList`, {
          headers: hdrs,
          params: { username: this.user },
        });
        if (r.status >= 200 && r.status < 300 && r.data) {
          for (const id of this.collectGroupIdsFromPayload(r.data)) {
            if (id.includes('GROUP_OFPR')) usuarios.add(id);
          }
        }
      } catch {
        /* sin grupos backend */
      }
    }

    const despachoEmisor = [...usuarios]
      .filter((u) => u.startsWith('GROUP_'))
      .map((u) => this.limpiarIdGrupoOfpr(u))
      .filter(Boolean);

    console.info(
      `[sgde] Compartidos: usuario=${this.user || '?'} grupos=${usuarios.size} despachos=${despachoEmisor.length}`
    );

    return { usuarios: [...usuarios], despachoEmisor };
  }

  private extractUuidFromCompartirRow(row: unknown, radicado: string): string | null {
    if (!row || typeof row !== 'object') return null;
    const o = row as Record<string, unknown>;
    const comp = (
      o.compartir && typeof o.compartir === 'object' ? o.compartir : o
    ) as Record<string, unknown>;
    const expDigits = String(
      comp.expediente ?? o.expediente ?? comp.nombre ?? o.nombre ?? ''
    ).replace(/\D/g, '');
    if (expDigits && !this.radicadosCoinciden(expDigits, radicado)) return null;
    const uuid = String(comp.uuid ?? comp.nodeId ?? o.uuid ?? o.nodeId ?? '').trim();
    return /^[0-9a-f-]{36}$/i.test(uuid) ? uuid.toLowerCase() : null;
  }

  /**
   * Misma API que SGDE → Mis compartidos (pestañas Con el despacho / Por el despacho).
   * POST /backendrama/interno/compartirUnificado
   */
  private async compartirUnificadoBuscarPages(
    radicado: string,
    modo: 'conDespacho' | 'porDespacho',
    ctx: { usuarios: string[]; despachoEmisor: string[] },
    expedienteFiltro: string,
    maxPages: number
  ): Promise<string | null> {
    const pageSize = 50;
    const csrf = this.csrf();
    const postHdrs: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(csrf ? { 'alf-csrftoken': csrf } : {}),
    };

    for (let page = 0; page < maxPages; page++) {
      const body: Record<string, unknown> =
        modo === 'conDespacho'
          ? {
              expediente: expedienteFiltro,
              usuarios: ctx.usuarios,
              despachos: null,
              usuarioBusquedaLibre: null,
              fechaInicio: null,
              fechaFin: null,
              page,
              size: pageSize,
              sortBy: 'fechaCompartir',
              asc: false,
            }
          : {
              expediente: expedienteFiltro,
              usuarioBusquedaLibre: null,
              fechaInicio: null,
              fechaFin: null,
              page,
              size: pageSize,
              sortBy: 'fechaCompartir',
              asc: false,
              despachoEmisor: ctx.despachoEmisor,
            };

      try {
        const r = await this.axios.post(`${this.back}/interno/compartirUnificado`, body, {
          headers: postHdrs,
        });
        if (r.status < 200 || r.status >= 300 || r.data == null) {
          console.warn(
            `[sgde] compartirUnificado ${modo} HTTP ${r.status} p=${page} filtro="${expedienteFiltro || '*'}"`
          );
          break;
        }

        const data = r.data as { content?: unknown[]; totalElements?: number };
        const content = Array.isArray(data.content) ? data.content : [];
        for (const row of content) {
          const nid = this.extractUuidFromCompartirRow(row, radicado);
          if (nid) {
            console.info(
              `[sgde] Expediente ${radicado} en compartidos (${modo}) p=${page} filtro="${expedienteFiltro || 'lista'}"`
            );
            return nid;
          }
        }
        if (content.length < pageSize) break;
        const total = data.totalElements;
        if (typeof total === 'number' && (page + 1) * pageSize >= total) break;
      } catch (e) {
        console.warn(`[sgde] compartirUnificado ${modo} error p=${page}:`, e);
        break;
      }
    }
    return null;
  }

  private async compartirUnificadoBuscar(
    radicado: string,
    modo: 'conDespacho' | 'porDespacho',
    ctx: { usuarios: string[]; despachoEmisor: string[] }
  ): Promise<string | null> {
    if (modo === 'conDespacho' && !ctx.usuarios.length) return null;
    if (modo === 'porDespacho' && !ctx.despachoEmisor.length) return null;

    const filtros = [radicado, radicado.slice(0, 21), ''];
    const seen = new Set<string>();
    for (const filtro of filtros) {
      if (seen.has(filtro)) continue;
      seen.add(filtro);
      const maxPages = filtro === '' ? 12 : 4;
      const nid = await this.compartirUnificadoBuscarPages(radicado, modo, ctx, filtro, maxPages);
      if (nid) return nid;
    }
    return null;
  }

  /** Expedientes en Mis compartidos (no aparecen en la grilla principal ni en Alfresco por CUI). */
  async buscarExpedienteEnCompartidos(radicadoRaw: string): Promise<string | null> {
    const radicado = radicadoRaw.replace(/\D/g, '');
    if (!EXPEDIENTE_REGEX.test(radicado)) return null;

    const ctx = await this.fetchMyCompartidosContext();
    const con = await this.compartirUnificadoBuscar(radicado, 'conDespacho', ctx);
    if (con) return con;
    return this.compartirUnificadoBuscar(radicado, 'porDespacho', ctx);
  }

  async buscarExpedienteNodeId(
    radicadoRaw: string,
    opts?: { nodeIdHint?: string | null }
  ): Promise<string | null> {
    this.nodeFromCompartidos = false;
    const hint = String(opts?.nodeIdHint || '').trim();
    if (/^[0-9a-f-]{36}$/i.test(hint)) return hint;

    const radicado = radicadoRaw.replace(/\D/g, '');
    if (!EXPEDIENTE_REGEX.test(radicado)) return null;

    const compartidoPrimero = await this.buscarExpedienteEnCompartidos(radicado);
    if (compartidoPrimero) {
      this.nodeFromCompartidos = true;
      return compartidoPrimero;
    }

    const url = `${this.alf}/search/versions/1/search`;
    const queries = [
      `TYPE:"rama:expedientes" AND =cm:name:"${radicado}"`,
      `TYPE:"rama:expedientes" AND cm:name:"${radicado}"`,
      `TYPE:"rama:expedientes" AND cm:name:"*${radicado}*"`,
      `=cm:name:"${radicado}"`,
      `cm:name:"*${radicado}*"`,
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
    const read = async (): Promise<{ name: string; status: number }> => {
      const url = `${this.alf}/alfresco/versions/1/nodes/${encodeURIComponent(nodeId)}`;
      const r = await this.axios.get(url, {
        headers: this.jsonHeaders(),
        params: { include: 'properties' },
      });
      if (r.status < 200 || r.status >= 300) return { name: '', status: r.status };
      const ent = (r.data as { entry?: { name?: string } })?.entry;
      return { name: String(ent?.name || '').trim(), status: r.status };
    };

    let { name, status } = await read();
    if (!name && (status === 401 || this.nodeFromCompartidos) && this.ticket) {
      ({ name } = await this.withTicketAlfrescoAuth(read));
    }
    if (name) return name;

    const ent = await this.getNodeViaBackend(nodeId, 'properties');
    return String(ent?.name || '').trim();
  }

  /**
   * Misma consulta que SGDE usa en el visor de ficheros (busquedaDocumentos):
   * documentos bajo el nodo del expediente vía ANCESTOR, no solo hijos directos.
   */
  async fetchPdfLeavesViaSearch(rootId: string, opts?: { maxDocs?: number }): Promise<SgdePdfLeaf[]> {
    const maxDocs = opts?.maxDocs ?? 600;
    const pageSize = 100;
    const url = `${this.alf}/search/versions/1/search`;
    const ancestor = `workspace://SpacesStore/${rootId}`;
    const query = `TYPE:('rama:carpetaDocumento' OR 'rama:documentos') and ANCESTOR:'${ancestor}' and ISUNSET:'rama:eliminadoLogico'`;

    const runSearch = async (): Promise<SgdePdfLeaf[]> => {
      const hdrs: Record<string, string> = {
        ...this.jsonHeaders(),
        'Content-Type': 'application/json',
      };
      const out: SgdePdfLeaf[] = [];
      const seen = new Set<string>();

      for (let skip = 0; skip < maxDocs; skip += pageSize) {
        const r = await this.axios.post(
          url,
          {
            query: { query, language: 'afts' },
            include: ['aspectNames', 'properties', 'isLink', 'path'],
            paging: { maxItems: pageSize, skipCount: skip },
          },
          { headers: hdrs }
        );
        if (r.status < 200 || r.status >= 300 || !r.data) {
          console.warn(`[sgde] busquedaDocumentos HTTP ${r.status} skip=${skip}`);
          if (r.status === 401) throw Object.assign(new Error('alfresco_search_401'), { status: 401 });
          break;
        }
        const entries = (r.data as { list?: { entries?: unknown[] } })?.list?.entries || [];
        if (!entries.length) break;

        for (const row of entries) {
          const ent =
            row && typeof row === 'object' && 'entry' in row
              ? (row as { entry: Record<string, unknown> }).entry
              : (row as Record<string, unknown>);
          const nt = String(ent.nodeType || '').toLowerCase();
          if (!nt.includes('rama:documentos')) continue;
          const pathEls = (ent.path as { elements?: Array<{ name?: string }> } | undefined)?.elements;
          const folderPath =
            pathEls && pathEls.length > 1
              ? pathEls
                  .slice(1, -1)
                  .map((e) => String(e.name || '').trim())
                  .filter(Boolean)
                  .join(' / ')
              : undefined;
          const leaf = entryToPdfLeaf(ent, folderPath);
          if (leaf && !seen.has(leaf.id)) {
            seen.add(leaf.id);
            out.push(leaf);
          }
        }

        if (entries.length < pageSize) break;
      }

      if (out.length) {
        console.info(`[sgde] ${out.length} documento(s) vía ANCESTOR bajo ${rootId.slice(0, 8)}…`);
      }
      return out;
    };

    try {
      return await runSearch();
    } catch (e) {
      if ((e as { status?: number })?.status === 401 && this.ticket) {
        console.info('[sgde] Reintento busquedaDocumentos con alf_ticket…');
        return this.withTicketAlfrescoAuth(runSearch);
      }
      return [];
    }
  }

  async fetchChildren(nodeId: string): Promise<Record<string, unknown>[]> {
    const url = `${this.alf}/alfresco/versions/1/nodes/${encodeURIComponent(nodeId)}/children`;

    const readPage = async (skip: number, page: number): Promise<{ chunk: Record<string, unknown>[]; status: number }> => {
      const r = await this.axios.get(url, {
        headers: this.jsonHeaders(),
        params: { maxItems: page, skipCount: skip, include: 'properties' },
      });
      if (r.status < 200 || r.status >= 300) return { chunk: [], status: r.status };
      const raw = (r.data as { list?: { entries?: unknown[] } })?.list?.entries || [];
      const chunk: Record<string, unknown>[] = [];
      for (const e of raw) {
        if (!e || typeof e !== 'object') continue;
        const row = e as Record<string, unknown>;
        const ent = row.entry;
        if (ent && typeof ent === 'object') chunk.push(ent as Record<string, unknown>);
        else if (row.id) chunk.push(row);
      }
      return { chunk, status: r.status };
    };

    const readAll = async (): Promise<{ all: Record<string, unknown>[]; status: number }> => {
      const all: Record<string, unknown>[] = [];
      let skip = 0;
      const page = 200;
      let lastStatus = 200;
      while (true) {
        const { chunk, status } = await readPage(skip, page);
        lastStatus = status;
        if (status === 401) return { all, status };
        if (!chunk.length) break;
        all.push(...chunk);
        if (chunk.length < page) break;
        skip += page;
      }
      return { all, status: lastStatus };
    };

    let { all, status } = await readAll();
    if (!all.length && status === 401 && this.ticket) {
      ({ all } = await this.withTicketAlfrescoAuth(readAll));
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

  private async buscarNodoExpedienteAlfresco(cui: string): Promise<string | null> {
    const url = `${this.alf}/search/versions/1/search`;
    const csrf = this.csrf();
    const hdrs: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(csrf ? { 'alf-csrftoken': csrf } : {}),
    };
    const q = `TYPE:'rama:expedientes' and cm:name:'${cui}' and ISUNSET:'rama:eliminadoLogico'`;
    const r = await this.axios.post(
      url,
      { query: { query: q, language: 'afts' }, paging: { maxItems: 5, skipCount: 0 } },
      { headers: hdrs }
    );
    if (r.status < 200 || r.status >= 300 || !r.data) return null;
    const entries = (r.data as { list?: { entries?: unknown[] } })?.list?.entries || [];
    for (const row of entries) {
      const ent =
        row && typeof row === 'object' && 'entry' in row
          ? (row as { entry: { id?: string; name?: string } }).entry
          : (row as { id?: string; name?: string });
      const id = String(ent?.id || '').trim();
      const name = String(ent?.name || '').replace(/\D/g, '');
      if (id && name === cui) return id.toLowerCase();
    }
    return null;
  }

  /** Árbol por hijos; si queda vacío, búsqueda ANCESTOR como el visor SGDE. */
  async collectPdfLeavesForExpediente(
    rootId: string,
    opts?: { maxDepth?: number; maxNodes?: number; maxSearchDocs?: number; originRadicado?: string }
  ): Promise<SgdePdfLeaf[]> {
    const tree = await this.buildTree(rootId, {
      maxDepth: opts?.maxDepth ?? 12,
      maxNodes: opts?.maxNodes ?? 800,
    });
    const fromTree = flattenSgdePdfLeaves(tree);
    if (fromTree.length > 0) return fromTree;

    let fromSearch = await this.fetchPdfLeavesViaSearch(rootId, { maxDocs: opts?.maxSearchDocs });
    if (fromSearch.length > 0) return fromSearch;

    const rootName = await this.getNodeName(rootId);
    const cui = (opts?.originRadicado || rootName).replace(/\D/g, '');
    if (cui.length === 23) {
      const altId = await this.buscarNodoExpedienteAlfresco(cui);
      if (altId && altId !== rootId.toLowerCase()) {
        console.info(`[sgde] Reintento ANCESTOR con nodo expediente ${altId.slice(0, 8)}…`);
        fromSearch = await this.fetchPdfLeavesViaSearch(altId, { maxDocs: opts?.maxSearchDocs });
      }
    }
    return fromSearch;
  }

  /** Descarga el contenido binario de un nodo documento en Alfresco. */
  async downloadNodeContent(
    nodeId: string
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    const url = `${this.alf}/alfresco/versions/1/nodes/${encodeURIComponent(nodeId)}/content`;

    const read = async (): Promise<{ buffer: Buffer; contentType: string } | null> => {
      const r = await this.axios.get(url, {
        headers: {
          ...this.jsonHeaders(),
          Accept: 'application/pdf,application/octet-stream,*/*',
        },
        responseType: 'arraybuffer',
        maxContentLength: 20 * 1024 * 1024,
        maxBodyLength: 20 * 1024 * 1024,
      });
      if (r.status === 401) throw Object.assign(new Error('alfresco_content_401'), { status: 401 });
      if (r.status < 200 || r.status >= 300 || !r.data) return null;
      const buf = Buffer.from(r.data);
      if (buf.length < 5) return null;
      const isPdf =
        buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d;
      const ct = String(r.headers['content-type'] || '').split(';')[0].trim();
      if (!isPdf && ct && !ct.includes('pdf') && !ct.includes('octet-stream')) {
        return null;
      }
      return {
        buffer: buf,
        contentType: isPdf || ct.includes('pdf') ? 'application/pdf' : ct || 'application/pdf',
      };
    };

    try {
      return await read();
    } catch (e) {
      if ((e as { status?: number })?.status === 401 && this.ticket) {
        return this.withTicketAlfrescoAuth(read);
      }
      return null;
    }
  }

  /** Ticket Alfresco para operaciones de escritura (tras login). */
  alfTicketValue(): string {
    return this.ticket;
  }

  bearerTokenValue(): string {
    return this.accessToken;
  }

  sgdeUsername(): string {
    return this.user;
  }

  private nodesUrl(): string {
    return `${this.alf}/alfresco/versions/1/nodes`;
  }

  private sanitizeSgdeName(nombre: string): string {
    let s = (nombre || '').trim().replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
    return s;
  }

  private async alfrescoJsonRequest<T>(
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    opts?: { body?: unknown; params?: Record<string, string> }
  ): Promise<{ status: number; data: T | null }> {
    const run = async (): Promise<{ status: number; data: T | null }> => {
      const r = await this.axios.request({
        method,
        url,
        headers: { ...this.jsonHeaders(), 'Content-Type': 'application/json' },
        data: opts?.body,
        params: opts?.params,
      });
      return { status: r.status, data: (r.data as T) ?? null };
    };
    try {
      return await run();
    } catch {
      return { status: 0, data: null };
    }
  }

  private async searchFirstNodeId(query: string): Promise<string | null> {
    const url = `${this.alf}/search/versions/1/search`;
    const run = async (): Promise<string | null> => {
      const r = await this.axios.post(
        url,
        {
          query: { query, language: 'afts' },
          paging: { maxItems: 5, skipCount: 0 },
        },
        { headers: { ...this.jsonHeaders(), 'Content-Type': 'application/json' } }
      );
      if (r.status < 200 || r.status >= 300) return null;
      const entries = (r.data as { list?: { entries?: unknown[] } })?.list?.entries || [];
      for (const row of entries) {
        const ent =
          row && typeof row === 'object' && 'entry' in row
            ? (row as { entry: { id?: string } }).entry
            : (row as { id?: string });
        const id = String(ent?.id || '').trim();
        if (/^[0-9a-f-]{36}$/i.test(id)) return id.toLowerCase();
      }
      return null;
    };
    try {
      return await run();
    } catch (e) {
      if ((e as { status?: number })?.status === 401 && this.ticket) {
        return this.withTicketAlfrescoAuth(run);
      }
      return null;
    }
  }

  private async obtenerParentNodeId(nodeId: string): Promise<string | null> {
    const url = `${this.nodesUrl()}/${encodeURIComponent(nodeId)}`;
    const { status, data } = await this.alfrescoJsonRequest<{ entry?: { parentId?: string } }>('GET', url, {
      params: { include: 'path' },
    });
    if (status < 200 || status >= 300) return null;
    const pid = String(data?.entry?.parentId || '').trim();
    return /^[0-9a-f-]{36}$/i.test(pid) ? pid.toLowerCase() : null;
  }

  /** Carpeta contenedora de expedientes del despacho (12 dígitos de radicación). */
  async resolveParentContainer(codigoRadicacion12: string): Promise<string | null> {
    const c12 = codigoRadicacion12.replace(/\D/g, '').slice(0, 12);
    if (c12.length !== 12 || !this.ticket) return null;

    const pref = c12;
    for (const q of [
      `TYPE:"rama:expedientes" AND @rama\\:nomExpediente:${pref}*`,
      `TYPE:'rama:expedientes' AND cm:name:${pref}*`,
    ]) {
      const expId = await this.searchFirstNodeId(q);
      if (expId) {
        const parent = await this.obtenerParentNodeId(expId);
        if (parent) return parent;
      }
    }

    const despacho3 = c12.slice(9, 12);
    for (const nombre of [c12, despacho3]) {
      const q = `TYPE:"cm:folder" AND cm:name:"${nombre}" AND -TYPE:"rama:expedientes"`;
      const folderId = await this.searchFirstNodeId(q);
      if (folderId) return folderId;
    }
    return null;
  }

  async createExpedienteNode(
    parentNodeUuid: string,
    radicado23: string,
    properties: Record<string, string>
  ): Promise<{ ok: true; nodeId: string; yaExiste?: boolean } | { ok: false; error: string }> {
    const name = radicado23.replace(/\D/g, '').slice(0, 23);
    if (name.length !== 23) {
      return { ok: false, error: 'El radicado debe tener 23 dígitos.' };
    }
    if (!this.ticket || !parentNodeUuid) {
      return { ok: false, error: 'Faltan sesión SGDE o carpeta padre del despacho.' };
    }

    const url = `${this.nodesUrl()}/${encodeURIComponent(parentNodeUuid)}/children`;
    const body = { name, nodeType: 'rama:expedientes', properties: { 'rama:nomExpediente': name, ...properties } };

    const post = async (): Promise<{ status: number; data: { entry?: { id?: string } } | null }> => {
      const r = await this.axios.post(url, body, {
        headers: { ...this.jsonHeaders(), 'Content-Type': 'application/json' },
      });
      return { status: r.status, data: (r.data as { entry?: { id?: string } }) ?? null };
    };

    let { status, data } = await post();
    if (status === 401 && this.ticket) {
      ({ status, data } = await this.withTicketAlfrescoAuth(post));
    }

    if (status === 201) {
      const id = String(data?.entry?.id || '').trim();
      if (id) return { ok: true, nodeId: id.toLowerCase() };
      return { ok: false, error: 'SGDE devolvió 201 sin id de expediente.' };
    }

    if (status === 409 || status === 422) {
      const existing = await this.buscarExpedienteNodeId(name);
      if (existing) return { ok: true, nodeId: existing, yaExiste: true };
    }

    return { ok: false, error: `No se pudo crear el expediente en SGDE (HTTP ${status}).` };
  }

  private async createCmFolder(
    parentNodeUuid: string,
    nombre: string
  ): Promise<{ ok: true; nodeId: string } | { ok: false; error: string }> {
    const name = this.sanitizeSgdeName(nombre);
    if (!name) return { ok: false, error: 'Nombre de carpeta vacío.' };
    const url = `${this.nodesUrl()}/${encodeURIComponent(parentNodeUuid)}/children`;
    const post = async () => {
      const r = await this.axios.post(
        url,
        { name, nodeType: 'cm:folder' },
        { headers: { ...this.jsonHeaders(), 'Content-Type': 'application/json' } }
      );
      return r.status;
    };
    let status = await post();
    if (status === 401 && this.ticket) {
      status = await this.withTicketAlfrescoAuth(post);
    }
    if (status === 201) {
      const children = await this.fetchChildren(parentNodeUuid);
      for (const ch of children) {
        if (entryIsFolder(ch) && String(ch.name || '').toLowerCase() === name.toLowerCase()) {
          const id = String(ch.id || '').trim();
          if (id) return { ok: true, nodeId: id.toLowerCase() };
        }
      }
      return { ok: false, error: 'Carpeta creada pero no se encontró su id.' };
    }
    if (status === 409 || status === 422) {
      const children = await this.fetchChildren(parentNodeUuid);
      const want = name.toLowerCase();
      for (const ch of children) {
        if (entryIsFolder(ch) && String(ch.name || '').toLowerCase() === want) {
          const id = String(ch.id || '').trim();
          if (id) return { ok: true, nodeId: id.toLowerCase() };
        }
      }
    }
    return { ok: false, error: `No se pudo crear carpeta «${name}» (HTTP ${status}).` };
  }

  private findChildFolderId(entries: Record<string, unknown>[], matcher: (n: string) => boolean): string | null {
    for (const ch of entries) {
      if (!entryIsFolder(ch)) continue;
      const n = String(ch.name || '').trim().toLowerCase();
      if (matcher(n)) {
        const id = String(ch.id || '').trim();
        if (id) return id.toLowerCase();
      }
    }
    return null;
  }

  /** Idempotente: Primera instancia → Principal. */
  async ensurePrimeraInstanciaPrincipal(
    expedienteNodeUuid: string
  ): Promise<
    | { ok: true; primeraInstanciaId: string; principalFolderId: string }
    | { ok: false; error: string }
  > {
    if (!this.ticket || !expedienteNodeUuid) {
      return { ok: false, error: 'Faltan sesión SGDE o nodo expediente.' };
    }

    const expChildren = await this.fetchChildren(expedienteNodeUuid);
    let primeraId =
      this.findChildFolderId(expChildren, (n) => n.includes('primera')) ||
      this.findChildFolderId(expChildren, (n) => n.includes('01primera'));

    if (!primeraId) {
      let folderRes = await this.createCmFolder(expedienteNodeUuid, 'Primera instancia');
      if (!folderRes.ok) {
        folderRes = await this.createCmFolder(expedienteNodeUuid, '01PrimeraInstancia');
      }
      if (folderRes.ok === false) {
        return { ok: false, error: folderRes.error };
      }
      primeraId = folderRes.nodeId;
    }

    const piChildren = await this.fetchChildren(primeraId);
    let principalId =
      this.findChildFolderId(piChildren, (n) => n.includes('principal')) ||
      this.findChildFolderId(piChildren, (n) => n.includes('c01'));

    if (!principalId) {
      const folderRes = await this.createCmFolder(primeraId, 'Principal');
      if (folderRes.ok === false) {
        return { ok: false, error: folderRes.error };
      }
      principalId = folderRes.nodeId;
    }

    return { ok: true, primeraInstanciaId: primeraId, principalFolderId: principalId };
  }

  private async getAzureSas(): Promise<{
    sasToken?: string;
    container?: string;
    account?: string;
  } | null> {
    if (!this.accessToken) return null;
    const r = await this.axios.get(`${this.back}/azure/sas`, {
      headers: { ...this.jsonHeaders(), Authorization: `Bearer ${this.accessToken}` },
    });
    if (r.status < 200 || r.status >= 300) return null;
    const d = r.data as Record<string, unknown>;
    return {
      sasToken: String(d.sasToken || d.sas || ''),
      container: String(d.container || 'alfresco'),
      account: String(d.account || 'stalfrescoprod'),
    };
  }

  private async getSiguienteOrdenDocumento(folderUuid: string): Promise<number> {
    const docs = await this.fetchChildren(folderUuid);
    let max = 0;
    for (const d of docs) {
      if (entryIsFolder(d)) continue;
      const props = (d.properties as Record<string, unknown> | undefined) || {};
      const ord = Number(props['rama:idDocumento'] ?? 0);
      if (Number.isFinite(ord) && ord > max) max = ord;
    }
    return max + 1;
  }

  private azureMetaAscii(val: string, maxLen = 400): string {
    let s = val.replace(/[^\x20-\x7e]/g, '_');
    if (s.length > maxLen) s = s.slice(0, maxLen);
    return s;
  }

  async uploadDocumentToFolder(opts: {
    folderNodeUuid: string;
    radicado23: string;
    buffer: Buffer;
    fileName: string;
    contentType: string;
    tipoDocumental: string;
    expedienteMetadata: Record<string, string>;
    orden?: number;
  }): Promise<{ ok: true; sgdeDocId?: string } | { ok: false; error: string }> {
    const { folderNodeUuid, buffer, fileName, tipoDocumental, expedienteMetadata } = opts;
    if (!this.ticket || !this.accessToken) {
      return { ok: false, error: 'Sesión SGDE incompleta para subir documentos.' };
    }

    const cui = opts.radicado23.replace(/\D/g, '').slice(0, 23);
    if (cui.length !== 23) return { ok: false, error: 'CUI inválido para subida SGDE.' };

    const sas = await this.getAzureSas();
    if (!sas?.sasToken) return { ok: false, error: 'No se obtuvo SAS de Azure desde SGDE.' };

    const mime = opts.contentType?.includes('pdf') ? 'application/pdf' : 'application/pdf';
    const idDoc = opts.orden ?? (await this.getSiguienteOrdenDocumento(folderNodeUuid));
    const now = new Date();
    const hoy = now.toISOString().slice(0, 10);
    const { randomUUID } = await import('node:crypto');
    const blobUuid = randomUUID().replace(/-/g, '');
    const pathParts = [
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      String(now.getUTCDate()).padStart(2, '0'),
      String(now.getUTCHours()).padStart(2, '0'),
      String(now.getUTCMinutes()).padStart(2, '0'),
    ];
    const blobPath = `${pathParts.join('/')}/${blobUuid}.bin`;
    const pathData = `store://${blobPath}`;
    const account = sas.account || 'stalfrescoprod';
    const container = sas.container || 'alfresco';
    const azureUrl = `https://${account}.blob.core.windows.net/${container}/alf_data/contentstore/${blobPath}?${sas.sasToken}`;

    const fechaCarga = now.toISOString().replace(/:/g, '%3A');
    const azureRes = await fetch(azureUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-ms-blob-type': 'BlockBlob',
        'x-ms-meta-cui': this.azureMetaAscii(cui),
        'x-ms-meta-fecha_carga': fechaCarga,
        'x-ms-meta-originalname': this.azureMetaAscii(fileName),
        'x-ms-meta-username': this.azureMetaAscii(this.user || 'tutelia'),
        'x-ms-meta-uuid': 'temporal',
        'x-ms-version': '2025-05-05',
      },
      body: new Uint8Array(buffer),
    });
    if (!azureRes.ok) {
      const t = await azureRes.text().catch(() => '');
      return { ok: false, error: `Azure PUT ${azureRes.status}: ${t.slice(0, 200)}` };
    }

    const s = (x: string | undefined) => (x == null ? '' : this.sanitizeSgdeName(String(x)));
    const nodeProps: Record<string, string | number> = {
      'rama:idDocumento': idDoc,
      'rama:nomExpediente': cui,
      'rama:nombreSerie': s(expedienteMetadata['rama:nombreSerie'] || SGDE_SERIE_TUTELA),
      'rama:nomOficinaProductora': s(expedienteMetadata['rama:nomOficinaProductora'] || ''),
      'rama:nomSubserie': s(expedienteMetadata['rama:nomSubserie'] || SGDE_SUBSERIE_TUTELA),
      'rama:anexos': 'No',
      'rama:docPdfA': 'No',
      'rama:origen': 'Electronico',
      'rama:observacionesDoc': '',
      'rama:fechaDeclaracionArchivoD': hoy,
      'rama:fechaPublicacion': hoy,
      'rama:tipoDocumental': tipoDocumental,
      'rama:palabrasClave': '',
      'rama:acceso': 'Publico',
      'cm:title': s(fileName) || '-',
      'rama:paginaInicioDoc': 1,
      'rama:paginaFinDoc': 1,
      'rama:tamano': buffer.length,
      'rama:formato': 'PDF',
      'rama:paginas': 1,
    };

    const createBody = {
      alf_token: this.ticket,
      node: {
        id: null,
        name: fileName.endsWith('.pdf') ? fileName : `${fileName.replace(/\.[^.]+$/, '')}.pdf`,
        nodeType: 'rama:documentos',
        properties: nodeProps,
        aspectNames: ['cm:titled'],
      },
      pathData,
      uuid: folderNodeUuid,
      mimetype: mime,
      filesize: buffer.length,
      auditoria: {
        accion: 'Anadir archivo',
        despacho: '',
        nodoReferencia: '',
        path: '',
        usuario: this.user,
        descripcion: `Se ha anadido el archivo "${fileName}"`,
        fechaRegistro:
          new Date().toLocaleString('sv-SE', { timeZone: 'America/Bogota' }).replace(' ', 'T') +
          '.000-05:00',
        registroId: null,
      },
    };

    const cr = await this.axios.post(`${this.back}/nodos/createNodeAzure`, createBody, {
      headers: {
        ...this.jsonHeaders(),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
    if (cr.status >= 200 && cr.status < 300) {
      const docId = String((cr.data as { id?: string; nodeId?: string })?.id || '').trim();
      return { ok: true, ...(docId ? { sgdeDocId: docId } : {}) };
    }
    const errText = typeof cr.data === 'string' ? cr.data : JSON.stringify(cr.data || '');
    return { ok: false, error: `createNodeAzure ${cr.status}: ${errText.slice(0, 400)}` };
  }

  /**
   * Firma electrónica de un PDF en SGDE (mismo endpoint que el portal: POST /backendrama/documento/firma).
   */
  async signDocument(opts: {
    nodeId: string;
    username: string;
    password: string;
  }): Promise<{ ok: true; detail?: string } | { ok: false; message: string }> {
    const nodeId = String(opts.nodeId || '')
      .trim()
      .toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(nodeId)) {
      return { ok: false, message: 'ID de documento SGDE inválido.' };
    }
    const user = String(opts.username || '').trim();
    const pass = String(opts.password || '');
    if (!user || !pass) {
      return { ok: false, message: 'Usuario y contraseña SGDE son obligatorios para firmar.' };
    }

    const p = encryptSgdePortalPassword(pass);
    try {
      const r = await this.axios.post(
        `${this.back}/documento/firma`,
        { uuid: nodeId, user, p },
        {
          headers: { ...this.jsonHeaders(), 'Content-Type': 'application/json' },
          responseType: 'text',
        }
      );
      if (r.status >= 200 && r.status < 300) {
        const detail = typeof r.data === 'string' ? r.data.trim() : '';
        return { ok: true, ...(detail ? { detail } : {}) };
      }
      const msg =
        typeof r.data === 'string'
          ? r.data.trim()
          : r.data != null
            ? JSON.stringify(r.data)
            : '';
      return {
        ok: false,
        message:
          msg ||
          `SGDE no pudo firmar el documento (HTTP ${r.status}). Compruebe credenciales y permisos en el portal.`,
      };
    } catch (e) {
      return {
        ok: false,
        message: formatSgdeConnectionError(String((e as Error)?.message || e)),
      };
    }
  }
}

const SGDE_SERIE_TUTELA = 'Constitucional';
const SGDE_SUBSERIE_TUTELA = 'Acciones Constitucionales de Tutela';

export function getDefaultSgdeBaseUrl(): string {
  return (
    process.env.SGDE_BASE_URL?.trim() ||
    'https://siugj-sgde.ramajudicial.gov.co'
  ).replace(/\/$/, '');
}
