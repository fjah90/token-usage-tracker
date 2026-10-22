# token-usage-tracker

Un mod de Claude Code que añade un panel de consumo junto al chat:

- **Tokens por día y por modelo** de los últimos 7 días. Los lee de los transcripts locales (`~/.claude/projects/**/*.jsonl`) y cuenta cada respuesta una sola vez.
- **Límites del plan** (5 h y semanal) con barra de progreso. Un aviso emergente salta una vez por ventana al llegar al 80 %.
- **Ahorro de headroom** (opcional): tokens y USD ahorrados por día, sacados de `~/.headroom/proxy_savings.json`. Si no usas headroom, esa sección no aparece.

`tok` = entrada + salida + escritura de caché. La lectura de caché se muestra aparte porque es barata, pero su volumen es enorme.

## Requisitos

- Claude Code 2.1.304 o posterior
- Node.js 20 o posterior en el `PATH` (el escáner `hooks/scan.mjs` corre con `node`)

## Uso

- Claude Desktop (pestaña Code): el panel **Consumo** se abre al empezar la sesión.
- Terminal: `/consumo` abre el panel. La línea de estado muestra `5 h 18% · Semana 44%`.
- El consumo se actualiza al abrir la sesión, cada 5 minutos y con el botón **Actualizar**.

La caché del escáner está en `~/.claude/token-usage-tracker/cache.json` y se puede borrar sin problema.

## Desarrollo

```bash
claude plugin validate .
claude plugin test .
node tests/scan-check.mjs
claude --plugin-dir .
```
