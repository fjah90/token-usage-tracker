# token-usage-tracker

Un mod de Claude Code que muestra el consumo en una banda plegable encima del prompt y, si lo pides, en un panel lateral:

- **Tokens por día y por modelo** de los últimos 7 días. Los lee de los transcripts locales (`~/.claude/projects/**/*.jsonl`) y cuenta cada respuesta una sola vez.
- **Límites del plan** (5 h y semanal) con barra de progreso. Un aviso emergente salta una vez por ventana al llegar al 80 %.
- **Ahorro de headroom** (opcional): tokens y USD ahorrados por día, sacados de `~/.headroom/proxy_savings.json`. Si no usas headroom, esa sección no aparece.

`tok` = entrada + salida + escritura de caché. La lectura de caché se muestra aparte porque es barata, pero su volumen es enorme.

## Requisitos

- Claude Code 2.1.304 o posterior
- Node.js 20 o posterior en el `PATH` (el escáner `hooks/scan.mjs` corre con `node`)

## Uso

- **Banda** encima del prompt (terminal y Desktop): `▸ consumo  5 h 42%  Semana 46%  hoy 3.7M tok`. Al pulsarla se despliega el detalle por día, con los botones **Actualizar** y **Panel**. Recuerda si la dejaste plegada o abierta.
- **Panel lateral** con el detalle completo: `/consumo` o el botón **Panel**. Ya no se abre solo.
- La línea de estado muestra `5 h 42% · Semana 46%`.
- El consumo se actualiza al abrir la sesión, cada 5 minutos y con el botón **Actualizar**.

La caché del escáner está en `~/.claude/token-usage-tracker/cache.json` y se puede borrar sin problema.

## Desarrollo

```bash
claude plugin validate .
claude plugin test .
node tests/scan-check.mjs
claude --plugin-dir .
```

Desktop ejecuta una copia del mod instalado. Después de un cambio:

```bash
claude plugin marketplace update aponte-mods
claude plugin update token-usage-tracker@aponte-mods
```

Antes hay que subir `version` en `.claude-plugin/plugin.json`, y después reiniciar la sesión.
