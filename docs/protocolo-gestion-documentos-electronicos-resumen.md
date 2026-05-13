# Protocolo — gestión de documentos electrónicos (rama judicial)

**Fuente:** PDF *Protocolo para la gestión de documentos electronicos* (CENDOJ / Rama Judicial; versión registrada en documento: No. 02, 18-02-2021).  
**Extracción:** texto extraíble vía `scripts/extract-protocolo-pdf.py` desde `~/Downloads/Protocolo*.pdf`.

Este archivo resume lo **aplicable al software Tutelia** (nombres, formatos, expediente). No sustituye el PDF oficial.

---

## 1. Formatos estándar del expediente judicial electrónico

| Tipo de contenido | Formato estándar | Extensiones |
|-------------------|------------------|-------------|
| Texto | PDF | `.pdf` |
| Imagen | JPG, JPEG, JPEG2000, TIFF | `.jpeg`, `.jpg`, `.jpe`, `.jpg2`, `.tiff` |
| Audio | MP3, WAVE | `.mp3`, `.wav` |
| Video | MPEG-1, MPEG-2, MPEG-4 | `.mpg`, `.mp4`, `.mpeg`, … |

- Actuaciones de **texto** recibidas por medios habilitados deben **guardarse en PDF** (interoperabilidad y conservación). Ver anexo 2 del protocolo (correo → PDF).
- Para **archivo / conservación a largo plazo**, el protocolo **sugiere PDF/A** (ISO 19005): sin enlaces de fuentes ni cifrado que dificulten la preservación.

---

## 2. Identificación de carpetas y archivos (§ 7.3)

Reglas para **nombres** de archivos y carpetas (organización y compatibilidad con backup/migración):

| Criterio | Uso adecuado | Evitar |
|----------|--------------|--------|
| Longitud | **Máximo ~40 caracteres** por nombre de archivo | Nombres muy largos |
| Separadores | **Sin guiones ni espacios** | `Notificación-Tutela`, `Notificación Tutela` |
| Caracteres | **Alfanuméricos**; no usar `/#%&:<>().¿?` ni tildes | Caracteres especiales |
| Mayúsculas | **Mayúscula inicial** en cada palabra compuesta | `FALLOTUTELA`, `Fallotutela` |
| Palabras | Evitar **artículos, preposiciones y abreviaturas** cuando sea posible | `AutoDeApertura…` con “de” innecesarios |
| Números de un dígito | Anteponer **0** (`01`, `02`) | `1Demanda`, `2Anexos` |
| Fechas en el nombre | Formato **`AAAAMMDD`** | `25-06-2020` |

**Carpeta del proceso:** identificar con el **Código Único de Identificación (C.U.I.)** de **23 dígitos** (radicado completo sin separadores es el patrón habitual en sistemas).

**Anexos masivos** (p. ej. más de 10 archivos en una carpeta): nombre tipo **`AnexosMemorialAAAAMMDD`**.

**Índice electrónico** (cerrado en PDF): denominación tipo **`00IndiceElectronicoC01`** (y C02, C03… por cuaderno).

**Estructura de carpetas por instancia** (ejemplos del protocolo): `01PrimeraInstancia`, `02SegundaInstancia`, `03RecursosExtraordinarios`, `04Ejecucion`; cuadernos **C01** (principal), **C02**, **C03**…

---

## 3. Integridad y metadatos (§ 7.4)

- **Integridad:** expediente completo, sin alteraciones indebidas; vínculo archivístico entre documentos en secuencia lógica.
- **Foliado / índice:** asociar cada documento al índice con metadatos (páginas, inicio/fin, etc.); el índice refleja el orden cronológico.
- Los **metadatos** contextualizan el documento (p. ej. radicación, partes, fecha, formato).

---

## 4. Recepción y peso de archivos

- Si el material **excede el límite del correo**, es frecuente recibir **enlaces** a Drive/Dropbox/iCloud: el protocolo indica **descargar al momento de la recepción** e incorporar al repositorio de la Rama.
- **Carpetas comprimidas (.zip, etc.):** descomprimir e incorporar **archivos individuales** al expediente electrónico.

---

## 5. Alineación con Tutelia (implementación actual)

| Tema | Protocolo | Tutelia |
|------|-----------|---------|
| Texto judicial / correo | PDF | PDF en visor y Storage; generación Word → PDF en despacho |
| Nombres legibles | TitleCase, sin espacios/guiones, ~40 caracteres | PDF informe de ingreso al expediente: **`InformeIngresoDespacho.pdf`** (sin radicado de 23 dígitos en el nombre; el expediente ya identifica el proceso). Otros flujos: `sanitizeCaseDocumentLogicalName` |
| C.U.I. / radicado | 23 dígitos | `formatRadicado` / radicado en datos del caso |
| Cuadernos C01/C02 | Series/cuadernos | `notebook_code` y cuadernos en expediente digital |
| PDF/A | Recomendado para archivo | No obligatorio en app; **mejora futura** si se requiere cumplimiento estricto |

**Nombre fijo informe de ingreso (Tutelia):** `InformeIngresoDespacho.pdf` cumple longitud (~26 caracteres con extensión) y el protocolo de identificación por archivo.

---

## 6. Almacenamiento y “¿se comprimen los archivos?”

- **Supabase Storage** (y Tutelia al subir) guardan el **archivo tal cual** (bytes del PDF, DOCX, imagen, etc.). **No hay compresión automática** ni re-encode en el servidor que reduzca el tamaño de cada objeto.
- **Reducir peso** depende del **origen del PDF**: resolución al escanear, no incrustar imágenes enormes en Word, exportar PDF con compresión desde el programa de origen, o usar herramientas externas de optimización **antes** de subir (siempre sin alterar el contenido jurídico exigido).
- En la app, rutas como **PDF de texto plano** frente a **Mammoth + html2pdf** pueden dar **PDFs más ligeros** en algunos casos, pero eso es **efecto colateral** del método de generación, no un servicio de “optimización de almacenamiento” global.

---

## 7. Mantenimiento de este resumen

Si actualizan el PDF oficial, volver a ejecutar:

```bash
python scripts/extract-protocolo-pdf.py
```

(Revisa el extracto en `docs/_protocolo_raw_extract.txt` si lo generas de nuevo; ese archivo puede ignorarse en git — ver `.gitignore`.)
