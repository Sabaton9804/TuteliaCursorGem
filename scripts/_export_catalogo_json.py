"""Exporta procesos, eventos y (si existe) reparto de catalogo.db a JSON (stdout)."""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path


def configure_stdout_utf8() -> None:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')


def row_to_dict(row: sqlite3.Row) -> dict:
    return {k: row[k] for k in row.keys()}


def table_exists(cur: sqlite3.Cursor, name: str) -> bool:
    cur.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
        (name,),
    )
    return cur.fetchone() is not None


def normalize_radicado_key(raw: object) -> str:
    digits = ''.join(ch for ch in str(raw or '') if ch.isdigit())
    if len(digits) >= 23:
        return digits[:23]
    return digits.zfill(23)[:23] if digits else ''


def merge_reparto_into_procesos(procesos: list[dict], reparto_rows: list[dict]) -> list[dict]:
    """Enriquece filas de procesos con datos de tabla reparto (mismo radicado/CUI)."""
    if not reparto_rows:
        return procesos

    by_rad: dict[str, dict] = {}
    for row in reparto_rows:
        key = normalize_radicado_key(
            row.get('radicado')
            or row.get('cui')
            or row.get('numero_radicado')
            or row.get('radicado_cui')
        )
        if key:
            by_rad[key] = row

    merged: list[dict] = []
    for p in procesos:
        key = normalize_radicado_key(p.get('radicado'))
        r = by_rad.get(key)
        if not r:
            merged.append(p)
            continue
        out = dict(p)
        for src, dst in (
            ('demandante', 'demandante'),
            ('accionante', 'demandante'),
            ('nombre_accionante', 'demandante'),
            ('demandante_id', 'demandante_id'),
            ('cedula_accionante', 'demandante_id'),
            ('cc_accionante', 'demandante_id'),
            ('documento_accionante', 'demandante_id'),
            ('cedula', 'demandante_id'),
            ('demandado', 'demandado'),
            ('accionado', 'demandado'),
            ('nombre_demandado', 'demandado'),
            ('demandado_id', 'demandado_id'),
            ('tipo_proceso', 'tipo_proceso'),
            ('clase_proceso', 'tipo_proceso'),
            ('clase', 'clase'),
            ('subclase', 'subclase'),
            ('instancia', 'instancia'),
            ('tipo_registro', 'tipo_registro'),
        ):
            if dst in out and out.get(dst):
                continue
            val = r.get(src)
            if val not in (None, ''):
                out[dst] = val
        merged.append(out)
    return merged


def main() -> None:
    configure_stdout_utf8()
    db_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / ".." / "PhytonJ51ccto" / "plataforma" / "data" / "catalogo.db"
    db_path = db_path.resolve()
    if not db_path.is_file():
        print(json.dumps({"error": f"No existe {db_path}"}), file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT * FROM procesos ORDER BY fecha_ingreso DESC, radicado DESC")
    procesos = [row_to_dict(r) for r in cur.fetchall()]
    cur.execute("SELECT * FROM eventos ORDER BY radicado, fecha_auto, id")
    eventos = [row_to_dict(r) for r in cur.fetchall()]

    reparto: list[dict] = []
    if table_exists(cur, 'reparto'):
        cur.execute("SELECT * FROM reparto ORDER BY radicado")
        reparto = [row_to_dict(r) for r in cur.fetchall()]
        procesos = merge_reparto_into_procesos(procesos, reparto)

    conn.close()

    json.dump(
        {
            "procesos": procesos,
            "eventos": eventos,
            "reparto": reparto,
            "tables": {"reparto": bool(reparto)},
        },
        sys.stdout,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
