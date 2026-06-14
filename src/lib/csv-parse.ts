/** Parser CSV mínimo (comillas dobles). Compartido CLI + consola plataforma. */

export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };

  const pushRow = () => {
    if (row.length > 0 || field.length > 0) {
      pushField();
      rows.push(row);
    }
    row = [];
    field = '';
  };

  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      continue;
    }
    if (ch === '\n') {
      pushRow();
      continue;
    }
    if (ch === '\r') {
      if (src[i + 1] === '\n') i++;
      pushRow();
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) pushRow();

  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function csvRowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j];
      if (!key) continue;
      obj[key] = (rows[i][j] ?? '').trim();
    }
    out.push(obj);
  }
  return out;
}

export function parseCsvToObjects(text: string): Record<string, string>[] {
  return csvRowsToObjects(parseCsv(text));
}
