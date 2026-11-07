# Evidencia de Norai

Fuente: `/Users/jeronimo.deli/Desktop/other/Vs/norai/docs/{design,evidence}.md`, plan `docs/plans/norai-backend.md`. Repos hermanos `norai-*-x`, `norai-mcp`, `norai-link`. Lab: rama `lab-archive`, tag `lab-archive-2026-11-03`.

## Corpus probados

- **Bank of Anthos** (`GoogleCloudPlatform/bank-of-anthos`, commit `db35fea9`), recortado a 1000 archivos / 20 MB: `norai/.norai/breadth-round3/`.
- **Bank86** (147 aserciones de referencia) + un bucket ficticio de docs y sheets.
- Corpus grande del experimento ABC: 626 archivos, 21 MB, 38 sheets.

## Herramienta ganadora por capa

| Capa                    | Herramienta                              | Resultado                                                                   |
| ----------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| Código                  | Tree-sitter (14 lenguajes) + reglas      | rutas 31/31, campo-columna 28/28; no detecta llamadas HTTP/DB               |
| Llamadas HTTP/DB        | Joern (Docker, 6 GB)                     | HTTP 11/11, DB 6/6, repositorios 10/10; precisión general de llamadas 0.017 |
| SQL / lineage           | SQLGlot                                  | 13/13 en 7 ms                                                               |
| Documentos              | MarkItDown; Docling para tablas PDF      | 0.989 del texto retenido                                                    |
| Sheets                  | openpyxl + valores cacheados de fórmulas | dlt colapsaba encabezados: preservar original y normalizado                 |
| Prosa                   | LangExtract con offsets verificados      | 175/176 offsets exactos; recall .568, precisión .702                        |
| Identidad entre fuentes | No fusionar por string                   | tokens normalizados P .990 / R .363                                         |

## El resultado que importa

| Variante        | Puntaje /30 | Tokens procesados |
| --------------- | ----------- | ----------------- |
| Repo crudo      | **28.75**   | **1.83 M**        |
| MCP superficial | 25.75       | 5.28 M            |
| MCP profundo    | 25.25       | 4.94 M            |

El repo crudo ganó en calidad y costo. Las "deep cards" generadas no mejoraron. Por eso Norai v1 es **repo + mapa**, nunca solo mapa: seis tools gruesas (overview, investigate, trace, sql read-only, evidence, note).

**Implicación para el enterprise harness:** el knowledge general no debe ser un resumen de la empresa; debe apuntar a la fuente y guardar lo que no está en ningún repo.
