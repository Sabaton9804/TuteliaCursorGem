"""Extrae texto del PDF del protocolo en Descargas → UTF-8 en disco (evita cp1252 en consola Windows)."""
from pathlib import Path

from pypdf import PdfReader


def main() -> None:
    repo = Path(__file__).resolve().parents[1]
    out = repo / "docs" / "_protocolo_raw_extract.txt"
    downloads = Path.home() / "Downloads"
    candidates = sorted(downloads.glob("Protocolo*.pdf"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise SystemExit(f"No se encontró Protocolo*.pdf en {downloads}")
    path = candidates[0]
    r = PdfReader(str(path))
    parts: list[str] = [f"# Fuente: {path.name}\n"]
    for i, page in enumerate(r.pages):
        t = page.extract_text() or ""
        parts.append(f"\n--- Página {i + 1} ---\n{t}")
    text = "".join(parts)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print(f"OK {len(text)} chars -> {out}")


if __name__ == "__main__":
    main()
