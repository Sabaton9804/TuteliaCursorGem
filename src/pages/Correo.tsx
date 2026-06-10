import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { motion } from 'motion/react';
import {
  Download,
  ExternalLink,
  Eye,
  Loader2,
  Mail,
  MailOpen,
  Paperclip,
  RefreshCw,
  Send,
  Unplug,
  Inbox,
  FileInput,
  Sparkles,
  FolderInput,
  Search,
  FileEdit,
  SendHorizontal,
  Trash2,
  ShieldAlert,
  X,
  Reply,
  Info,
  ChevronDown,
} from 'lucide-react';
import {
  classifyOutlookMessage,
  disconnectOutlook,
  downloadOutlookAttachment,
  fetchOutlookAttachmentBytes,
  fetchOutlookAuthUrl,
  fetchOutlookFolders,
  fetchOutlookMessage,
  fetchOutlookMessageAttachments,
  fetchOutlookMessages,
  fetchMessagesReviewStatus,
  type OutlookAttachmentMeta,
  type OutlookMessageReviewListStatus,
  fetchOutlookStatus,
  fetchOutlookMailboxes,
  setOutlookMailboxContext,
  setOutlookActiveMailboxId,
  getOutlookActiveMailboxId,
  type OutlookCourtMailbox,
  openOutlookAttachmentInNewTab,
  parseOutlookMessageForRadicacion,
  scanOutlookInbox,
  sendOutlookMail,
  type OutlookEmailClasificacion,
  type OutlookFolderKey,
  type OutlookFolderSummary,
  type OutlookMessageSummary,
  type OutlookStatus,
} from '../lib/outlook-api';
import { formatRadicado } from '../lib/formatters';
import {
  etiquetaVinculo,
  mensajeVinculo,
  vinculoFromClassification,
} from '../lib/outlook-expediente-vinculo';
import { parseSegundaInstanciaClient } from '../lib/sgde-api';
import {
  openOutlookMessageBodyInNewTab,
  sanitizeOutlookBodyHtml,
} from '../lib/outlook-body-preview';

const OUTLOOK_RADICACION_KEY = 'tutelia_outlook_radicacion';
const MESSAGE_PAGE_SIZE = 40;
const INBOX_SCAN_TOP = 20;
const LIMITS_BANNER_KEY = 'tutelia_correo_limits_dismissed';

function extractFromAddress(from: unknown): string {
  if (!from || typeof from !== 'object') return '';
  const ea = (from as { emailAddress?: { address?: string } }).emailAddress;
  return ea?.address?.trim() || '';
}

function replySubjectLine(subject: string): string {
  const s = subject.trim() || '(Sin asunto)';
  return /^re:\s/i.test(s) ? s : `Re: ${s}`;
}

function messageWebLink(detail: Record<string, unknown> | null): string | null {
  const link = detail?.webLink;
  return typeof link === 'string' && /^https?:\/\//i.test(link) ? link : null;
}

function looksLikeSegundaInstanciaReparto(subject: string, bodyText: string): boolean {
  return parseSegundaInstanciaClient(subject, bodyText).isSegundaInstancia;
}

function formatFrom(msg: OutlookMessageSummary): string {
  const addr = msg.from?.emailAddress;
  return addr?.name?.trim() || addr?.address?.trim() || '—';
}

function messageDateIso(msg: OutlookMessageSummary): string | undefined {
  return msg.receivedDateTime || msg.sentDateTime || msg.lastModifiedDateTime;
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdfAttachment(att: OutlookAttachmentMeta): boolean {
  return att.contentType === 'application/pdf' || att.name.toLowerCase().endsWith('.pdf');
}

function canReadAttachment(att: OutlookAttachmentMeta): boolean {
  return att.kind === 'file' && !att.isInline;
}

const FOLDER_ICONS: Record<OutlookFolderKey, React.ComponentType<{ className?: string }>> = {
  inbox: Inbox,
  drafts: FileEdit,
  sentitems: SendHorizontal,
  deleteditems: Trash2,
  junkemail: ShieldAlert,
};

export default function Correo() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<OutlookStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [messages, setMessages] = useState<OutlookMessageSummary[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messageDetail, setMessageDetail] = useState<Record<string, unknown> | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [parsingId, setParsingId] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [classification, setClassification] = useState<OutlookEmailClasificacion | null>(null);
  const [parseSessionId, setParseSessionId] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<OutlookFolderKey>('inbox');
  const [folders, setFolders] = useState<OutlookFolderSummary[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [attachments, setAttachments] = useState<OutlookAttachmentMeta[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null);
  const [openingAttId, setOpeningAttId] = useState<string | null>(null);
  const [previewAtt, setPreviewAtt] = useState<OutlookAttachmentMeta | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [composeOpen, setComposeOpen] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendCc, setSendCc] = useState('');
  const [sendSubject, setSendSubject] = useState('');
  const [sendBody, setSendBody] = useState('');
  const [sending, setSending] = useState(false);
  const [scanningInbox, setScanningInbox] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [reviewStatusMap, setReviewStatusMap] = useState<
    Record<string, OutlookMessageReviewListStatus>
  >({});
  const [limitsBannerOpen, setLimitsBannerOpen] = useState(() => {
    try {
      return sessionStorage.getItem(LIMITS_BANNER_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const [courtMailboxes, setCourtMailboxes] = useState<OutlookCourtMailbox[]>([]);
  const [activeMailboxId, setActiveMailboxId] = useState<string | null>(() => getOutlookActiveMailboxId());
  const [mailboxPickerLoading, setMailboxPickerLoading] = useState(false);
  const [requireExplicitMailbox, setRequireExplicitMailbox] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const s = await fetchOutlookStatus();
      setStatus(s);
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : 'Error al consultar Outlook.');
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const loadMailboxContext = useCallback(async () => {
    if (!status?.connected) {
      setCourtMailboxes([]);
      return;
    }
    setMailboxPickerLoading(true);
    try {
      const snap = await fetchOutlookMailboxes();
      setCourtMailboxes(snap.mailboxes);
      setRequireExplicitMailbox(snap.requireExplicitMailbox);
      const preferred =
        snap.activeMailboxId ||
        snap.mailboxes.find((m) => m.isPrimary)?.id ||
        snap.mailboxes[0]?.id ||
        null;
      if (preferred) {
        setActiveMailboxId(preferred);
        setOutlookActiveMailboxId(preferred);
        if (!snap.activeMailboxId && snap.mailboxes.length > 0) {
          await setOutlookMailboxContext(preferred);
        }
      } else {
        setActiveMailboxId(null);
        setOutlookActiveMailboxId(null);
      }
    } catch (e) {
      console.error('outlook mailboxes:', e);
    } finally {
      setMailboxPickerLoading(false);
    }
  }, [status?.connected]);

  const loadFolders = useCallback(async () => {
    if (!status?.connected) return;
    if (requireExplicitMailbox && courtMailboxes.length > 0 && !activeMailboxId) return;
    setLoadingFolders(true);
    try {
      const list = await fetchOutlookFolders();
      setFolders(list);
    } catch (e) {
      console.error('outlook folders:', e);
    } finally {
      setLoadingFolders(false);
    }
  }, [status?.connected, requireExplicitMailbox, courtMailboxes.length, activeMailboxId]);

  const loadMessages = useCallback(async () => {
    if (!status?.connected) return;
    if (requireExplicitMailbox && courtMailboxes.length > 0 && !activeMailboxId) return;
    setLoadingMessages(true);
    setError(null);
    try {
      const list = await fetchOutlookMessages({
        top: MESSAGE_PAGE_SIZE,
        folder: activeFolder,
        search: search.trim() || undefined,
      });
      setMessages(list);
      setHasMoreMessages(list.length >= MESSAGE_PAGE_SIZE);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la bandeja.');
    } finally {
      setLoadingMessages(false);
    }
  }, [status?.connected, activeFolder, search, requireExplicitMailbox, courtMailboxes.length, activeMailboxId]);

  const loadMoreMessages = useCallback(async () => {
    if (!status?.connected || loadingMoreMessages) return;
    setLoadingMoreMessages(true);
    setError(null);
    try {
      const list = await fetchOutlookMessages({
        top: MESSAGE_PAGE_SIZE,
        skip: messages.length,
        folder: activeFolder,
        search: search.trim() || undefined,
      });
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...list.filter((m) => !seen.has(m.id))];
      });
      setHasMoreMessages(list.length >= MESSAGE_PAGE_SIZE);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar más correos.');
    } finally {
      setLoadingMoreMessages(false);
    }
  }, [status?.connected, activeFolder, search, messages.length, loadingMoreMessages]);

  const refreshMailbox = useCallback(async () => {
    await loadFolders();
    await loadMessages();
  }, [loadFolders, loadMessages]);

  const handleMailboxChange = useCallback(
    async (mailboxId: string) => {
      if (!mailboxId || mailboxId === activeMailboxId) return;
      setMailboxPickerLoading(true);
      setError(null);
      try {
        await setOutlookMailboxContext(mailboxId);
        setActiveMailboxId(mailboxId);
        await loadStatus();
        await refreshMailbox();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo cambiar el buzón.');
      } finally {
        setMailboxPickerLoading(false);
      }
    },
    [activeMailboxId, loadStatus, refreshMailbox]
  );

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (status?.connected) void loadMailboxContext();
    else {
      setCourtMailboxes([]);
      setActiveMailboxId(null);
    }
  }, [status?.connected, loadMailboxContext]);

  useEffect(() => {
    const outlook = searchParams.get('outlook');
    if (outlook === 'connected') {
      const mailbox = searchParams.get('mailbox');
      setBanner(mailbox ? `Outlook conectado: ${mailbox}` : 'Outlook conectado correctamente.');
      setSearchParams({}, { replace: true });
      void loadStatus();
    } else if (outlook === 'error') {
      const raw = searchParams.get('message') || 'Error al conectar Outlook.';
      const friendly = raw.includes('AADSTS900144') || /client_id/i.test(raw)
        ? 'Microsoft no recibió el Client ID. Configure OUTLOOK_CLIENT_ID y OUTLOOK_CLIENT_SECRET en .env, reinicie npm run dev y vuelva a conectar.'
        : raw.includes('status code 401')
          ? 'Microsoft rechazó la autenticación (401). Revise OUTLOOK_CLIENT_SECRET: debe ser el valor del secreto en Azure (no el ID). Reinicie npm run dev y vuelva a conectar.'
          : raw;
      setError(friendly);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, loadStatus]);

  useEffect(() => {
    if (status?.connected) void loadFolders();
  }, [status?.connected, loadFolders]);

  useEffect(() => {
    if (status?.connected) void loadMessages();
  }, [status?.connected, loadMessages]);

  useEffect(() => {
    if (!status?.connected || messages.length === 0) {
      setReviewStatusMap({});
      return;
    }
    const ids = [...new Set(messages.map((m) => m.id))];
    let cancelled = false;
    void fetchMessagesReviewStatus(ids)
      .then((map) => {
        if (!cancelled) setReviewStatusMap(map);
      })
      .catch((e) => {
        console.warn('outlook review-status:', e);
        if (!cancelled) setReviewStatusMap({});
      });
    return () => {
      cancelled = true;
    };
  }, [status?.connected, messages, activeFolder]);

  useEffect(() => {
    setSelectedId(null);
    setMessageDetail(null);
    setClassification(null);
    setParseSessionId(null);
  }, [activeFolder]);

  useEffect(() => {
    setClassification(null);
    setParseSessionId(null);
    setAttachments([]);
    setAttachmentsError(null);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !status?.connected) {
      setMessageDetail(null);
      setAttachments([]);
      setAttachmentsError(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setLoadingAttachments(true);
    setAttachmentsError(null);
    void (async () => {
      try {
        const detail = await fetchOutlookMessage(selectedId);
        if (cancelled) return;
        setMessageDetail(detail);

        if (detail.hasAttachments === true) {
          try {
            const atts = await fetchOutlookMessageAttachments(selectedId);
            if (!cancelled) {
              setAttachments(atts);
              if (!atts.length) {
                setAttachmentsError(
                  'No se listaron adjuntos (común en reenvíos RV). Pulse «Analizar con IA» para intentar extraerlos del correo embebido.'
                );
              }
            }
          } catch (attErr) {
            if (!cancelled) {
              setAttachments([]);
              setAttachmentsError(
                attErr instanceof Error
                  ? attErr.message
                  : 'Error al consultar adjuntos en Microsoft Graph.'
              );
            }
          }
        } else if (!cancelled) {
          setAttachments([]);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error al leer el mensaje.');
      } finally {
        if (!cancelled) {
          setLoadingDetail(false);
          setLoadingAttachments(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, status?.connected]);

  useEffect(() => {
    if (!previewAtt || !selectedId) {
      setPreviewUrl(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewUrl(null);
    void (async () => {
      try {
        const bytes = await fetchOutlookAttachmentBytes(selectedId, previewAtt);
        if (cancelled) return;
        const blob = new Blob([bytes], {
          type: previewAtt.contentType || 'application/pdf',
        });
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      } catch (e) {
        if (!cancelled) {
          setPreviewError(e instanceof Error ? e.message : 'No se pudo abrir el adjunto.');
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewAtt, selectedId]);

  const closeAttachmentPreview = () => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPreviewAtt(null);
    setPreviewError(null);
  };

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleOpenAttachment = async (att: OutlookAttachmentMeta) => {
    if (!selectedId) return;
    if (!canReadAttachment(att)) {
      setError(
        att.kind === 'reference'
          ? 'Este adjunto está en OneDrive. Ábralo desde Outlook.'
          : 'Este elemento no se puede abrir desde Tutelia.'
      );
      return;
    }
    setOpeningAttId(att.id);
    setError(null);
    try {
      if (isPdfAttachment(att)) {
        setPreviewAtt(att);
      } else {
        await downloadOutlookAttachment(selectedId, att);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el adjunto.');
    } finally {
      setOpeningAttId(null);
    }
  };

  const handleScanInbox = async () => {
    setScanningInbox(true);
    setError(null);
    try {
      const summary = await scanOutlookInbox({ top: INBOX_SCAN_TOP, folder: activeFolder });
      setBanner(
        `Analizados los ${INBOX_SCAN_TOP} más recientes de esta carpeta: ${summary.queued} en pendientes, ${summary.skipped} ya estaban, ${summary.failed} con error. Revise en «Pendientes».`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo analizar la bandeja.');
    } finally {
      setScanningInbox(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const url = await fetchOutlookAuthUrl();
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo conectar.');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setError(null);
    try {
      await disconnectOutlook();
      setSelectedId(null);
      setMessageDetail(null);
      setMessages([]);
      await loadStatus();
      setBanner('Outlook desconectado.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al desconectar.');
    }
  };

  const handleAnalyze = async (messageId: string) => {
    setClassifying(true);
    setError(null);
    try {
      const result = await classifyOutlookMessage(messageId, {
        parseSessionId: parseSessionId ?? undefined,
      });
      setClassification(result);
      setParseSessionId(result.parseSessionId);
      if (result.reviewId) {
        setBanner('Correo enviado a la cola de pendientes. Revise y apruebe el ingreso cuando esté listo.');
        setReviewStatusMap((prev) => ({ ...prev, [messageId]: 'pending' }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo analizar el correo.');
      setClassification(null);
    } finally {
      setClassifying(false);
    }
  };

  const handleCargarExpediente = (caseId: string) => {
    if (!selectedId || !parseSessionId) return;
    const qs = new URLSearchParams({
      fromOutlook: '1',
      parseSessionId,
      messageId: selectedId,
    });
    navigate(`/case/${caseId}?${qs.toString()}`);
  };

  const handleRadicar = async (messageId: string, opts?: { segundaInstancia?: boolean }) => {
    setParsingId(messageId);
    setError(null);
    try {
      const parsed = await parseOutlookMessageForRadicacion(messageId);
      const payload = {
        ...parsed,
        segundaInstancia:
          parsed.segundaInstancia ??
          (opts?.segundaInstancia
            ? { isSegundaInstancia: true, originRadicado: null, originCourt: null }
            : undefined),
      };
      sessionStorage.setItem(OUTLOOK_RADICACION_KEY, JSON.stringify(payload));
      const qs = opts?.segundaInstancia ? '?fromOutlook=1&segunda=1' : '?fromOutlook=1';
      navigate(`/new${qs}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo preparar el correo para radicación.');
    } finally {
      setParsingId(null);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const to = sendTo.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      const cc = sendCc.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      await sendOutlookMail({
        subject: sendSubject,
        bodyHtml: sendBody.replace(/\n/g, '<br/>'),
        to,
        cc: cc.length ? cc : undefined,
      });
      setBanner('Correo enviado.');
      setComposeOpen(false);
      setSendTo('');
      setSendCc('');
      setSendSubject('');
      setSendBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al enviar.');
    } finally {
      setSending(false);
    }
  };

  const bodyContent =
    messageDetail?.body && typeof messageDetail.body === 'object'
      ? String((messageDetail.body as { content?: string }).content ?? '')
      : '';
  const bodyType =
    messageDetail?.body && typeof messageDetail.body === 'object'
      ? String((messageDetail.body as { contentType?: string }).contentType ?? 'text')
      : 'text';
  const selectedSubject = String(messageDetail?.subject || '');
  const segundaRepartoHint = looksLikeSegundaInstanciaReparto(
    selectedSubject,
    bodyType === 'html' ? bodyContent.replace(/<[^>]+>/g, ' ') : bodyContent
  );
  const outlookWebLink = messageWebLink(messageDetail);
  const replyToAddress =
    extractFromAddress(messageDetail?.from) ||
    extractFromAddress(messages.find((m) => m.id === selectedId)?.from);

  const handleOpenBodyInNewTab = () => {
    if (!bodyContent.trim()) {
      setError('Este mensaje no tiene cuerpo para abrir en otra pestaña.');
      return;
    }
    try {
      openOutlookMessageBodyInNewTab({
        subject: selectedSubject,
        bodyContent,
        bodyType,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir el cuerpo del mensaje.');
    }
  };

  const handleReplyPrefill = () => {
    if (!replyToAddress) {
      setError('No se pudo obtener el remitente para responder.');
      return;
    }
    setSendTo(replyToAddress);
    setSendCc('');
    setSendSubject(replySubjectLine(selectedSubject));
    setSendBody('');
    setComposeOpen(true);
    setError(null);
  };

  const dismissLimitsBanner = () => {
    setLimitsBannerOpen(false);
    try {
      sessionStorage.setItem(LIMITS_BANNER_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-6xl space-y-6"
    >
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <motion.div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Correo judicial</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Bandeja Outlook / Microsoft 365 del funcionario conectado. Lea, envíe o radique desde el buzón.
          </p>
        </motion.div>
        {status?.connected ? (
          <motion.div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={scanningInbox || classifying}
              onClick={() => void handleScanInbox()}
              title={`Clasifica con IA hasta los ${INBOX_SCAN_TOP} correos más recientes de la carpeta activa`}
              className="inline-flex items-center gap-2 rounded-xl border border-violet-300 bg-violet-600 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-violet-700 disabled:opacity-60"
            >
              {scanningInbox ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              Analizar bandeja
            </button>
            <Link
              to="/correo/pendientes"
              className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-xs font-bold uppercase tracking-widest text-violet-800 hover:bg-violet-100"
            >
              <FolderInput className="h-4 w-4" aria-hidden />
              Pendientes
            </Link>
            <button type="button" onClick={() => setComposeOpen((v) => !v)} className="btn-primary inline-flex items-center gap-2 text-xs">
              <Send className="h-4 w-4" aria-hidden />
              Redactar
            </button>
            <button
              type="button"
              onClick={() => void refreshMailbox()}
              disabled={loadingMessages || loadingFolders}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${loadingMessages || loadingFolders ? 'animate-spin' : ''}`}
                aria-hidden
              />
              Actualizar
            </button>
          </motion.div>
        ) : null}
      </header>

      {banner ? (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {banner}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</div>
      ) : null}

      {status?.connected && limitsBannerOpen ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm text-slate-700">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
              <div className="min-w-0 space-y-1.5">
                <p className="font-semibold text-slate-800">Qué hace y qué no hace esta bandeja</p>
                <ul className="list-inside list-disc space-y-0.5 text-xs leading-relaxed text-slate-600">
                  <li>
                    <strong>Sí:</strong> leer correos, radicar, analizar con IA, ingreso vía Pendientes, enviar correo
                    nuevo.
                  </li>
                  <li>
                    <strong>No (aún):</strong> responder en el mismo hilo, adjuntos al redactar ni firma automática.
                  </li>
                  <li>
                    Para contestar con historial y adjuntos use <strong>Abrir en Outlook</strong> o{' '}
                    <strong>Responder</strong> (abre un borrador simple; no es respuesta en hilo).
                  </li>
                </ul>
                <p className="text-[11px] text-slate-500">
                  Roadmap interno:{' '}
                  <Link
                    to="/docs/roadmap"
                    className="font-medium text-accent underline decoration-accent/30 hover:decoration-accent"
                  >
                    prioridades Correo (v0.2 → v0.3)
                  </Link>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={dismissLimitsBanner}
              className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-600"
              title="Ocultar hasta la próxima sesión"
              aria-label="Ocultar aviso"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="card-modern p-6 space-y-4">
        <motion.div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <Mail className="h-4 w-4 text-accent" aria-hidden />
          Conexión Microsoft 365
        </motion.div>
        {loadingStatus ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Consultando…
          </p>
        ) : !status?.enabled ? (
          <div className="space-y-2 text-sm text-slate-600">
            <p>
              El servidor no tiene Outlook habilitado. Configure en <span className="font-mono text-xs">.env</span>:{' '}
              <span className="font-mono text-xs">OUTLOOK_CLIENT_ID</span>,{' '}
              <span className="font-mono text-xs">OUTLOOK_CLIENT_SECRET</span>, opcionalmente{' '}
              <span className="font-mono text-xs">OUTLOOK_TENANT_ID</span> y{' '}
              <span className="font-mono text-xs">OUTLOOK_REDIRECT_URI</span>.
            </p>
            <Link to="/settings" className="text-xs font-semibold text-accent hover:underline">
              Ver configuración del despacho
            </Link>
          </div>
        ) : status.connected ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 text-sm text-slate-700">
                <p>
                  Sesión Microsoft:{' '}
                  <strong>{status.oauthAccountEmail || status.mailboxEmail}</strong>
                </p>
                {status.activeMailbox ? (
                  <p>
                    Buzón del despacho:{' '}
                    <strong>{status.activeMailbox.displayName}</strong>{' '}
                    <span className="font-mono text-xs text-slate-500">({status.activeMailbox.upn})</span>
                  </p>
                ) : status.graphMode === 'legacy_me' ? (
                  <p className="text-amber-800/90">Modo piloto: bandeja personal (/me).</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void handleDisconnect()}
                className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-red-600"
              >
                <Unplug className="h-4 w-4" aria-hidden />
                Desconectar
              </button>
            </div>
            {courtMailboxes.length > 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                  Buzón institucional del despacho
                  <div className="relative">
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-800"
                      value={activeMailboxId || ''}
                      disabled={mailboxPickerLoading}
                      onChange={(e) => void handleMailboxChange(e.target.value)}
                    >
                      <option value="" disabled>
                        Seleccione un buzón…
                      </option>
                      {courtMailboxes.map((mb) => (
                        <option key={mb.id} value={mb.id}>
                          {mb.displayName || mb.upn} — {mb.courtName}
                        </option>
                      ))}
                    </select>
                    {mailboxPickerLoading ? (
                      <Loader2 className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 animate-spin text-slate-400" />
                    ) : (
                      <ChevronDown className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
                    )}
                  </div>
                </label>
                {requireExplicitMailbox && !activeMailboxId ? (
                  <p className="mt-2 text-xs text-amber-800">
                    Debe elegir el buzón compartido antes de listar o analizar correos.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <motion.div className="space-y-3">
            <p className="text-sm text-slate-600">
              Autorice a Tutelia con su cuenta corporativa. Se solicitan permisos delegados para buzones compartidos
              (Mail.Read.Shared, Mail.Send.Shared) y, en piloto, su bandeja personal.
            </p>
            {status.redirectUri ? (
              <div className="rounded-xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-xs leading-relaxed text-amber-950">
                <p className="font-semibold">En Azure → Autenticación → URI de redirección (plataforma Web), agregue exactamente:</p>
                <p className="mt-2 break-all font-mono text-[11px] text-amber-900">{status.redirectUri}</p>
                <p className="mt-2 text-amber-800/90">
                  Debe coincidir al pie de la letra (http, sin barra final, ruta{' '}
                  <span className="font-mono">/api/outlook/callback</span>). No use solo{' '}
                  <span className="font-mono">http://localhost:3000</span> ni{' '}
                  <span className="font-mono">127.0.0.1</span> si aquí dice localhost.
                </p>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={connecting}
              className="btn-primary inline-flex items-center gap-2 text-xs"
            >
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Conectar Outlook
            </button>
          </motion.div>
        )}
      </div>

      {composeOpen && status?.connected ? (
        <form onSubmit={(e) => void handleSend(e)} className="card-modern space-y-4 p-6">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            {sendSubject.startsWith('Re:') ? 'Responder (borrador simple)' : 'Nuevo mensaje'}
          </p>
          {sendSubject.startsWith('Re:') ? (
            <p className="text-xs text-amber-800/90">
              Esto envía un correo nuevo, no continúa el hilo en Outlook. Para respuesta con historial use{' '}
              <strong>Abrir en Outlook</strong> en el mensaje seleccionado.
            </p>
          ) : null}
          <input
            type="text"
            placeholder="Para (correos separados por coma)"
            value={sendTo}
            onChange={(e) => setSendTo(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm"
            required
          />
          <input
            type="text"
            placeholder="CC (opcional)"
            value={sendCc}
            onChange={(e) => setSendCc(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm"
          />
          <input
            type="text"
            placeholder="Asunto"
            value={sendSubject}
            onChange={(e) => setSendSubject(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm"
            required
          />
          <textarea
            placeholder="Cuerpo del mensaje"
            value={sendBody}
            onChange={(e) => setSendBody(e.target.value)}
            rows={8}
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm"
            required
          />
          <button type="submit" disabled={sending} className="btn-primary inline-flex items-center gap-2 text-xs">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar
          </button>
        </form>
      ) : null}

      {status?.connected ? (
        <>
          <div className="card-modern p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Panorama del buzón</p>
            {loadingFolders && !folders.length ? (
              <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Consultando carpetas…
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {folders.map((f) => {
                  const Icon = FOLDER_ICONS[f.id];
                  const active = f.id === activeFolder;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setActiveFolder(f.id)}
                      className={`inline-flex min-w-[9rem] flex-col rounded-xl border px-3 py-2 text-left transition-colors ${
                        active
                          ? 'border-accent/30 bg-accent/5 ring-1 ring-accent/20'
                          : 'border-slate-100 bg-slate-50/80 hover:border-slate-200 hover:bg-white'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        <Icon className={`h-3.5 w-3.5 ${active ? 'text-accent' : 'text-slate-400'}`} aria-hidden />
                        {f.label}
                      </span>
                      <span className="mt-1 text-lg font-bold tabular-nums text-slate-900">{f.total}</span>
                      {f.unread > 0 ? (
                        <span className="text-[10px] font-semibold text-accent">{f.unread} sin leer</span>
                      ) : (
                        <span className="text-[10px] text-slate-400">Sin pendientes</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
          <div className="card-modern flex flex-col overflow-hidden lg:col-span-2">
            <div className="flex items-center gap-2 border-b border-slate-50 px-4 py-3">
              {(() => {
                const Icon = FOLDER_ICONS[activeFolder];
                const label = folders.find((f) => f.id === activeFolder)?.label ?? 'Bandeja';
                return (
                  <>
                    <Icon className="h-4 w-4 text-accent" aria-hidden />
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-500">{label}</span>
                  </>
                );
              })()}
            </div>
            <motion.div className="border-b border-slate-50 p-3">
              <input
                type="search"
                placeholder="Buscar asunto…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void loadMessages()}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </motion.div>
            <div className="max-h-[32rem] flex-1 overflow-y-auto">
              {loadingMessages && !messages.length ? (
                <p className="flex items-center justify-center gap-2 p-8 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cargando…
                </p>
              ) : !messages.length ? (
                <p className="p-8 text-center text-sm text-slate-400">
                  {activeFolder === 'drafts'
                    ? 'No hay borradores.'
                    : activeFolder === 'sentitems'
                      ? 'No hay mensajes enviados.'
                      : 'Sin mensajes en esta carpeta.'}
                </p>
              ) : (
                <ul>
                  {messages.map((msg) => {
                    const active = msg.id === selectedId;
                    return (
                      <li key={msg.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(msg.id)}
                          className={`w-full border-b border-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                            active ? 'bg-blue-50/80' : ''
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {msg.isRead ? (
                              <MailOpen className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                            ) : (
                              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p
                                  className={`min-w-0 flex-1 truncate text-sm ${msg.isRead ? 'font-medium text-slate-600' : 'font-bold text-slate-900'}`}
                                >
                                  {msg.subject || '(Sin asunto)'}
                                </p>
                                {reviewStatusMap[msg.id] === 'pending' ? (
                                  <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                                    Pendiente
                                  </span>
                                ) : null}
                                {reviewStatusMap[msg.id] === 'ingested' ? (
                                  <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-900">
                                    Vinculado
                                  </span>
                                ) : null}
                              </div>
                              <p className="truncate text-xs text-slate-400">{formatFrom(msg)}</p>
                              {messageDateIso(msg) ? (
                                <p className="mt-1 text-[10px] text-slate-400">
                                  {format(new Date(messageDateIso(msg)!), 'dd MMM yyyy HH:mm', { locale: es })}
                                </p>
                              ) : null}
                            </div>
                            {msg.hasAttachments ? <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {messages.length > 0 && hasMoreMessages ? (
              <div className="border-t border-slate-50 p-3">
                <button
                  type="button"
                  disabled={loadingMoreMessages || loadingMessages}
                  onClick={() => void loadMoreMessages()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-2 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {loadingMoreMessages ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Cargar más
                </button>
              </div>
            ) : null}
          </div>

          <div className="card-modern flex min-h-[24rem] flex-col lg:col-span-3">
            {!selectedId ? (
              <p className="flex flex-1 items-center justify-center p-8 text-sm text-slate-400">Seleccione un correo de la lista.</p>
            ) : loadingDetail ? (
              <p className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando mensaje…
              </p>
            ) : messageDetail ? (
              <>
                <div className="space-y-2 border-b border-slate-50 p-5">
                  <h2 className="text-lg font-bold text-slate-900">{String(messageDetail.subject || '(Sin asunto)')}</h2>
                  <p className="text-xs text-slate-500">
                    De:{' '}
                    {messageDetail.from && typeof messageDetail.from === 'object'
                      ? String(
                          (messageDetail.from as { emailAddress?: { name?: string; address?: string } }).emailAddress
                            ?.address ?? ''
                        )
                      : '—'}
                  </p>

                  {loadingAttachments ? (
                    <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      Cargando adjuntos…
                    </p>
                  ) : attachments.length > 0 ? (
                    <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        <Paperclip className="h-3.5 w-3.5" aria-hidden />
                        Adjuntos ({attachments.length})
                      </p>
                      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                        {attachments.map((att) => {
                          const readable = canReadAttachment(att);
                          const busy = openingAttId === att.id;
                          return (
                            <li key={att.id}>
                              <button
                                type="button"
                                disabled={!readable || busy}
                                onClick={() => void handleOpenAttachment(att)}
                                className="flex w-full items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-left text-xs text-slate-700 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60"
                                title={
                                  readable
                                    ? isPdfAttachment(att)
                                      ? 'Ver PDF'
                                      : 'Descargar archivo'
                                    : att.kind === 'reference'
                                      ? 'Adjunto en OneDrive'
                                      : 'No disponible'
                                }
                              >
                                <span className="flex min-w-0 items-center gap-1.5">
                                  {busy ? (
                                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-600" />
                                  ) : readable && isPdfAttachment(att) ? (
                                    <Eye className="h-3.5 w-3.5 shrink-0 text-violet-600" aria-hidden />
                                  ) : readable ? (
                                    <Download className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                                  ) : null}
                                  <span className="truncate font-medium">{att.name}</span>
                                </span>
                                <span className="shrink-0 text-[10px] text-slate-400">
                                  {att.kind === 'reference'
                                    ? 'OneDrive'
                                    : att.kind === 'item'
                                      ? 'Correo'
                                      : formatAttachmentSize(att.size)}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="mt-2 text-[10px] text-slate-400">
                        Pulse un PDF para verlo aquí, u otro archivo para descargarlo. Para incorporarlos al
                        expediente use «Analizar con IA» y apruebe en Pendientes correo.
                      </p>
                    </div>
                  ) : attachmentsError ? (
                    <p className="mt-2 text-xs text-amber-800">{attachmentsError}</p>
                  ) : messageDetail.hasAttachments === true ? (
                    <p className="mt-2 text-xs text-amber-700">
                      Outlook indica adjuntos, pero no se listaron en este mensaje. Use «Analizar con IA» para
                      extraerlos del correo reenviado.
                    </p>
                  ) : null}

                  <motion.div className="mt-3 flex flex-wrap gap-2">
                    {outlookWebLink ? (
                      <a
                        href={outlookWebLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-700 hover:bg-slate-50"
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden />
                        Abrir en Outlook
                      </a>
                    ) : null}
                    <button
                      type="button"
                      disabled={!bodyContent.trim()}
                      onClick={handleOpenBodyInNewTab}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      title="Abre solo el cuerpo del mensaje en una pestaña nueva (HTML sanitizado)"
                    >
                      <Eye className="h-4 w-4" aria-hidden />
                      Cuerpo en pestaña
                    </button>
                    <button
                      type="button"
                      disabled={!replyToAddress}
                      onClick={handleReplyPrefill}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      title={
                        replyToAddress
                          ? 'Abre Redactar con destinatario y asunto Re:'
                          : 'Sin dirección de remitente'
                      }
                    >
                      <Reply className="h-4 w-4" aria-hidden />
                      Responder
                    </button>
                    <button
                      type="button"
                      disabled={classifying}
                      onClick={() => void handleAnalyze(selectedId)}
                      className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-xs font-bold uppercase tracking-widest text-violet-800 hover:bg-violet-100"
                    >
                      {classifying ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      Analizar con IA
                    </button>
                    {segundaRepartoHint ? (
                      <button
                        type="button"
                        disabled={parsingId === selectedId}
                        onClick={() => void handleRadicar(selectedId, { segundaInstancia: true })}
                        className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-violet-700"
                      >
                        {parsingId === selectedId ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FolderInput className="h-4 w-4" />
                        )}
                        Ingresar 2ª instancia (SGDE)
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={parsingId === selectedId}
                      onClick={() => void handleRadicar(selectedId)}
                      className="inline-flex items-center gap-2 rounded-xl bg-accent/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-accent hover:bg-accent/15"
                    >
                      {parsingId === selectedId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileInput className="h-4 w-4" />
                      )}
                      Radicar tutela
                    </button>
                  </motion.div>

                  {classifying ? (
                    <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      Analizando correo judicial…
                    </p>
                  ) : null}

                  {classification ? (
                    <motion.div className="mt-4 space-y-3 rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                      <p className="text-xs text-violet-800">
                        En cola de revisión.{' '}
                        <Link to="/correo/pendientes" className="font-bold underline">
                          Abrir pendientes
                        </Link>
                      </p>
                      {classification.tipo === 'reparto_nuevo' ? (
                        <>
                          <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-blue-800">
                            Reparto nuevo
                          </span>
                          {classification.descripcion_breve ? (
                            <p className="text-xs text-slate-600">{classification.descripcion_breve}</p>
                          ) : null}
                          {segundaRepartoHint ? (
                            <button
                              type="button"
                              disabled={parsingId === selectedId}
                              onClick={() => void handleRadicar(selectedId, { segundaInstancia: true })}
                              className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-3 py-2 text-xs font-bold text-white hover:bg-violet-800"
                            >
                              <FolderInput className="h-3.5 w-3.5" />
                              Ingresar 2ª instancia (SGDE)
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={parsingId === selectedId}
                            onClick={() => void handleRadicar(selectedId)}
                            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white hover:bg-accent/90"
                          >
                            <FileInput className="h-3.5 w-3.5" />
                            Radicar tutela
                          </button>
                        </>
                      ) : null}

                      {classification.tipo === 'respuesta_tramite' || classification.tipo === 'impugnacion' ? (
                        <>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                              classification.tipo === 'impugnacion'
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-orange-100 text-orange-900'
                            }`}
                          >
                            {classification.tipo === 'impugnacion' ? 'Impugnación' : 'Respuesta'}
                          </span>
                          {classification.tipo === 'respuesta_tramite' ? (
                            <p className="text-xs text-orange-900/90">
                              Cola del escribiente:{' '}
                              <Link to="/correo/contestaciones" className="font-bold underline">
                                Contestaciones pendientes
                              </Link>
                            </p>
                          ) : null}
                          {classification.descripcion_breve ? (
                            <p className="text-xs text-slate-600">{classification.descripcion_breve}</p>
                          ) : null}
                          {(() => {
                            const v = vinculoFromClassification(classification);
                            if (v === 'no_aplica') return null;
                            const boxClass =
                              v === 'encontrado'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                                : v === 'no_encontrado'
                                  ? 'border-red-200 bg-red-50 text-red-950'
                                  : 'border-amber-200 bg-amber-50 text-amber-950';
                            return (
                              <div className={`rounded-lg border px-3 py-2 text-xs ${boxClass}`}>
                                <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">
                                  {etiquetaVinculo(v)}
                                </p>
                                <p className="mt-1">{mensajeVinculo(classification)}</p>
                                {classification.referencia_proceso || classification.radicado_referencia ? (
                                  <p className="mt-1.5 font-mono text-[11px] opacity-90">
                                    Ref. proceso:{' '}
                                    {classification.referencia_proceso || classification.radicado_referencia}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })()}
                          {classification.casos_candidatos.length > 0 ? (
                            <ul className="space-y-2">
                              {classification.casos_candidatos.map((c) => (
                                <li
                                  key={c.id}
                                  className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                                >
                                  <div className="min-w-0 text-xs text-slate-700">
                                    <p className="font-bold text-slate-900">{formatRadicado(c.radicado)}</p>
                                    <p className="truncate">
                                      {c.claimant} <span className="text-slate-400">vs</span> {c.defendant}
                                    </p>
                                    <p className="text-[10px] uppercase tracking-wider text-slate-400">
                                      Etapa: {c.etapa_actual}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleCargarExpediente(c.id)}
                                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-accent/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-accent hover:bg-accent/15"
                                  >
                                    <FolderInput className="h-3.5 w-3.5" />
                                    Cargar al expediente →
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-red-800">
                              {vinculoFromClassification(classification) === 'no_encontrado'
                                ? mensajeVinculo(classification)
                                : 'No encontré expediente relacionado.'}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            {classification.casos_candidatos.length > 0 ? (
                              <Link
                                to="/cases"
                                className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-accent"
                              >
                                <Search className="h-3.5 w-3.5" />
                                Ninguno — buscar expediente
                              </Link>
                            ) : (
                              <Link
                                to="/cases"
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-50"
                              >
                                <Search className="h-3.5 w-3.5" />
                                Buscar expediente
                              </Link>
                            )}
                          </div>
                        </>
                      ) : null}

                      {classification.tipo === 'otro' ? (
                        <>
                          <span className="inline-flex rounded-full bg-slate-200 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-700">
                            Sin acción judicial detectada
                          </span>
                          {classification.descripcion_breve ? (
                            <p className="text-xs text-slate-600">{classification.descripcion_breve}</p>
                          ) : null}
                          <button
                            type="button"
                            disabled={parsingId === selectedId}
                            onClick={() => void handleRadicar(selectedId)}
                            className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-accent"
                          >
                            Radicar como tutela nueva
                          </button>
                        </>
                      ) : null}
                    </motion.div>
                  ) : null}
                </div>
                <div className="flex-1 overflow-y-auto p-5">
                  {bodyType.toLowerCase() === 'html' ? (
                    <motion.div
                      className="prose prose-sm max-w-none text-slate-700"
                      dangerouslySetInnerHTML={{ __html: sanitizeOutlookBodyHtml(bodyContent) }}
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{bodyContent}</pre>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
        </>
      ) : null}

      {previewAtt && selectedId ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="outlook-att-preview-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={closeAttachmentPreview}
        >
          <motion.div
            className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <motion.header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <p
                  id="outlook-att-preview-title"
                  className="truncate text-sm font-bold text-slate-900"
                  title={previewAtt.name}
                >
                  {previewAtt.name}
                </p>
                <p className="text-[10px] text-slate-500">{formatAttachmentSize(previewAtt.size)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={previewLoading}
                  onClick={() =>
                    void openOutlookAttachmentInNewTab(selectedId, previewAtt).catch((e) =>
                      setPreviewError(e instanceof Error ? e.message : String(e))
                    )
                  }
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  title="Abrir en pestaña nueva"
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={previewLoading}
                  onClick={() =>
                    void downloadOutlookAttachment(selectedId, previewAtt).catch((e) =>
                      setPreviewError(e instanceof Error ? e.message : String(e))
                    )
                  }
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  title="Descargar"
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={closeAttachmentPreview}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  title="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </motion.header>
            <div className="relative min-h-[50vh] flex-1 bg-slate-100">
              {previewLoading ? (
                <p className="flex h-full min-h-[50vh] items-center justify-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                  Cargando PDF…
                </p>
              ) : previewError ? (
                <p className="flex h-full min-h-[50vh] items-center justify-center px-6 text-center text-sm text-red-700">
                  {previewError}
                </p>
              ) : previewUrl ? (
                <iframe
                  title={previewAtt.name}
                  src={previewUrl}
                  className="h-full min-h-[70vh] w-full border-0"
                />
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </motion.div>
  );
}
