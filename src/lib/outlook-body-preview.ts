import DOMPurify from 'dompurify';

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** HTML del cuerpo de correo seguro para render en panel o ventana nueva. */
export function sanitizeOutlookBodyHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

function buildStandaloneBodyDocument(subject: string, innerBody: string): string {
  const safeTitle = escapeHtmlText(subject.trim() || '(Sin asunto)');
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 1.25rem 1.5rem; color: #334155; line-height: 1.5; }
    pre { white-space: pre-wrap; word-break: break-word; }
    img { max-width: 100%; height: auto; }
    table { border-collapse: collapse; max-width: 100%; }
  </style>
</head>
<body>
  <h1 style="font-size:1.125rem;font-weight:600;margin:0 0 1rem;color:#0f172a">${safeTitle}</h1>
  ${innerBody}
</body>
</html>`;
}

/** Abre el cuerpo del mensaje en una pestaña nueva (HTML sanitizado o texto plano). */
export function openOutlookMessageBodyInNewTab(opts: {
  subject: string;
  bodyContent: string;
  bodyType: string;
}): void {
  const { bodyContent, bodyType } = opts;
  const trimmed = bodyContent.trim();
  if (!trimmed) {
    throw new Error('Este mensaje no tiene cuerpo para mostrar.');
  }

  const isHtml = bodyType.toLowerCase() === 'html';
  const inner = isHtml
    ? sanitizeOutlookBodyHtml(trimmed)
    : `<pre>${escapeHtmlText(trimmed)}</pre>`;

  const html = buildStandaloneBodyDocument(opts.subject, inner);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    URL.revokeObjectURL(url);
    throw new Error(
      'El navegador bloqueó la ventana emergente. Permita ventanas emergentes para este sitio e intente de nuevo.'
    );
  }
  opened.addEventListener(
    'load',
    () => {
      URL.revokeObjectURL(url);
    },
    { once: true }
  );
}
