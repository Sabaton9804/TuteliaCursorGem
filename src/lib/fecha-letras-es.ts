/** Día del mes 1–31 en español (minúsculas; el llamador puede capitalizar). */
export function diaDelMesEnLetras(n: number): string {
  const m: Record<number, string> = {
    1: 'uno',
    2: 'dos',
    3: 'tres',
    4: 'cuatro',
    5: 'cinco',
    6: 'seis',
    7: 'siete',
    8: 'ocho',
    9: 'nueve',
    10: 'diez',
    11: 'once',
    12: 'doce',
    13: 'trece',
    14: 'catorce',
    15: 'quince',
    16: 'dieciséis',
    17: 'diecisiete',
    18: 'dieciocho',
    19: 'diecinueve',
    20: 'veinte',
    21: 'veintiuno',
    22: 'veintidós',
    23: 'veintitrés',
    24: 'veinticuatro',
    25: 'veinticinco',
    26: 'veintiséis',
    27: 'veintisiete',
    28: 'veintiocho',
    29: 'veintinueve',
    30: 'treinta',
    31: 'treinta y uno',
  };
  return m[n] ?? String(n);
}

const ANIO_2000_2099: Record<number, string> = (() => {
  const out: Record<number, string> = {};
  const veinti = [
    '',
    'veintiuno',
    'veintidós',
    'veintitrés',
    'veinticuatro',
    'veinticinco',
    'veintiséis',
    'veintisiete',
    'veintiocho',
    'veintinueve',
  ];
  for (let y = 2000; y <= 2099; y++) {
    const low = y % 100;
    if (low === 0) {
      out[y] = 'dos mil';
      continue;
    }
    if (low < 10) {
      const u = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'][low];
      out[y] = `dos mil ${u}`;
      continue;
    }
    if (low < 16) {
      const m15 = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince'];
      out[y] = `dos mil ${m15[low - 10]}`;
      continue;
    }
    if (low < 20) {
      const u = ['dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'][low - 16];
      out[y] = `dos mil ${u}`;
      continue;
    }
    if (low === 20) {
      out[y] = 'dos mil veinte';
      continue;
    }
    if (low < 30) {
      out[y] = `dos mil ${veinti[low - 20]}`;
      continue;
    }
    const d = Math.floor(low / 10);
    const u = low % 10;
    const dec = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'][d];
    const uni = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'][u];
    out[y] = u ? `dos mil ${dec} y ${uni}` : `dos mil ${dec}`;
  }
  return out;
})();

/** Año 2000–2099 en letras. Fuera de rango devuelve dígitos. */
export function anioEnLetras2000(y: number): string {
  return ANIO_2000_2099[y] ?? String(y);
}
