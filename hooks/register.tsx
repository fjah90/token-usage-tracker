import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit, ModelUsage, Report } from '../types'

const PANE = 'usage'
const DAYS = 7
const ALERT_PERCENT = 80
const REFRESH_MS = 5 * 60_000
const MIN_GAP_MS = 30_000

const report = atom({ plugin: 'token-usage-tracker', key: 'report' } as const, null)
const limits = atom({ plugin: 'token-usage-tracker', key: 'limits' } as const, [])
const error = atom({ plugin: 'token-usage-tracker', key: 'error' } as const, null)
const isScanning = atom({ plugin: 'token-usage-tracker', key: 'isScanning' } as const, false)
const isExpanded = atom({ plugin: 'token-usage-tracker', key: 'isExpanded' } as const, false)
const cost = atom({ plugin: 'token-usage-tracker', key: 'cost' } as const, null)

const fmt = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n)

// Tokens the model processed fresh; cache reads are shown apart (cheap, but huge).
const fresh = (m: ModelUsage) => m.input + m.output + m.cacheWrite

const LIMIT_LABEL: Record<string, string> = { five_hour: '5h', seven_day: 'Week' }
const limitLabel = (l: Limit) => LIMIT_LABEL[l.kind] ?? l.kind

const bar = (pct: number) => {
  const full = Math.max(0, Math.min(10, Math.round(pct / 10)))
  return '█'.repeat(full) + '░'.repeat(10 - full)
}

const resetText = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  const hm = d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
  const isToday = d.toDateString() === new Date().toDateString()
  return isToday ? `resets ${hm}` : `resets ${d.toLocaleDateString('en', { weekday: 'short', day: 'numeric' })} ${hm}`
}

const statusText = (list: Limit[]) =>
  list.length === 0 ? undefined : list.map(l => `${limitLabel(l)} ${Math.round(l.percentUsed)}%`).join(' · ')

// Reset by a hot reload, which then scans again: harmless.
let lastScan = 0

async function scan($: EngineInterface) {
  const now = await $.clock.now()
  if (now - lastScan < MIN_GAP_MS) return
  lastScan = now
  await update($, isScanning, () => true)
  try {
    const run = await $.process.run([
      'node', `${$.plugin.root}/hooks/scan.mjs`, '--days', String(DAYS), '--session', await $.session.id(),
    ], {
      timeoutMs: 180_000,
    })
    if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n').pop() || `exit ${run.exitCode}`)
    await update($, report, () => JSON.parse(run.stdout) as Report)
    await update($, error, () => null)
  } catch (err) {
    await update($, error, () => `Couldn't read usage: ${String((err as Error)?.message ?? err)}`)
  } finally {
    await update($, isScanning, () => false)
  }
}

async function toggleBand($: EngineInterface) {
  const value = !(await read($, isExpanded))
  await update($, isExpanded, () => value)
  await $.store.set('isExpanded', value)
}

// One toast per window and reset: the key is kind@resetsAt.
async function takeLimits($: EngineInterface, list: Limit[]) {
  await update($, limits, () => list)
  $.ui.status(statusText(list))

  const alerted = ((await $.store.get('alerted')) as string[] | undefined) ?? []
  const due = list.filter(l => l.percentUsed >= ALERT_PERCENT && !alerted.includes(`${l.kind}@${l.resetsAt}`))
  for (const l of due) {
    $.ui.toast(`${limitLabel(l)} limit at ${Math.round(l.percentUsed)}% · ${resetText(l.resetsAt)}`)
  }
  if (due.length > 0) {
    await $.store.set('alerted', [...alerted, ...due.map(l => `${l.kind}@${l.resetsAt}`)].slice(-20))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'token-usage', description: 'Open the token usage and plan limits pane' })
    const wasExpanded = (await $.store.get('isExpanded')) === true
    await update($, isExpanded, () => wasExpanded)
    void scan($)
    $.clock.every(REFRESH_MS, () => void scan($))
    const usage = await $.session.usage()
    await update($, cost, () => usage.cost?.usd ?? null)
    await takeLimits($, usage.rateLimits)

    return started
  })

  on('command.run', { command: 'token-usage' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Token usage' })
    void scan($)

    return { text: 'Token usage pane opened.' }
  })

  // This session above the prompt, the general usage in the pane; the bands of other plugins stay below it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey) return rest

    const { Box, Text, Button } = $.ui.resolve(e)
    const r = await read($, report)
    const lim = await read($, limits)
    const open = await read($, isExpanded)
    const busy = await read($, isScanning)

    const usd = await read($, cost)
    const models = Object.entries(r?.session ?? {}).sort(([, a], [, b]) => fresh(b) - fresh(a))
    const sessionTok = models.reduce((a, [, m]) => a + fresh(m), 0)
    const hot = lim.some(l => l.percentUsed >= ALERT_PERCENT)

    const band = (
      <Box flexDirection="column">
        {/* Summary always in view; Desktop draws a Button by its label alone, so the toggle says what it does. */}
        <Box flexDirection="row" columnGap={1}>
          <Text bold color={hot ? 'error' : 'success'}>usage</Text>
          {lim.map(l => (
            <Text color={l.percentUsed >= ALERT_PERCENT ? 'error' : undefined}>
              {limitLabel(l)} {Math.round(l.percentUsed)}%
            </Text>
          ))}
          <Text dimColor>
            session {r ? fmt(sessionTok) : '…'} tok{usd != null ? ` · $${usd.toFixed(2)}` : ''}
          </Text>
          <Button
            key="usage-toggle"
            label={open ? '▾ Hide' : '▸ By model'}
            dimColor
            onPress={() => void toggleBand($)}
          />
        </Box>
        {open &&
          models.map(([model, m]) => (
            <Text dimColor>
              {'  '}
              {model.replace(/^claude-/, '').padEnd(13)}
              {fmt(fresh(m)).padStart(7)} tok · {m.requests} req · +{fmt(m.cacheRead)} cache read
            </Text>
          ))}
        {open && (
          <Box flexDirection="row" columnGap={2}>
            <Button key="usage-refresh" label={busy ? 'Refreshing…' : 'Refresh'} onPress={() => void scan($)} />
            <Button key="usage-pane" label="All usage" onPress={() => void $.ui.open({ id: PANE, title: 'Token usage' })} />
          </Box>
        )}
      </Box>
    )

    return rest ? (
      <Box flexDirection="column">
        {band}
        {rest}
      </Box>
    ) : (
      band
    )
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await takeLimits($, e.rateLimits)
    if (e.changed.includes('cost')) {
      await update($, cost, () => e.cost?.usd ?? null)
      void scan($)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const r = await read($, report)
    const lim = await read($, limits)
    const err = await read($, error)
    const busy = await read($, isScanning)

    const totals = { fresh: 0, cacheRead: 0, requests: 0 }
    for (const d of r?.days ?? []) {
      for (const m of Object.values(d.models)) {
        totals.fresh += fresh(m)
        totals.cacheRead += m.cacheRead
        totals.requests += m.requests
      }
    }
    const hr = r?.headroom
    const hrWindow = Object.values(hr?.days ?? {}).reduce(
      (a, d) => ({ tokens: a.tokens + d.tokensSaved, usd: a.usd + d.usdSaved }),
      { tokens: 0, usd: 0 },
    )

    return (
      <Box flexDirection="column">
        <Text weight="semibold">Plan limits</Text>
        {lim.length === 0 && <Text dimColor>No reading yet (it arrives with the next response).</Text>}
        {lim.map(l => (
          <Text color={l.percentUsed >= ALERT_PERCENT ? 'error' : undefined}>
            {limitLabel(l).padEnd(7)}
            {bar(l.percentUsed)} {String(Math.round(l.percentUsed)).padStart(3)}% <Text dimColor>{resetText(l.resetsAt)}</Text>
          </Text>
        ))}

        <Text> </Text>
        <Text weight="semibold">Last {DAYS} days</Text>
        {err && <Text color="error">{err}</Text>}
        {!r && !err && <Text dimColor>Calculating…</Text>}
        {r && (
          <Text>
            {fmt(totals.fresh)} tok · {fmt(totals.requests)} requests <Text dimColor>(+{fmt(totals.cacheRead)} cache read)</Text>
          </Text>
        )}
        {hr && (
          <Text>
            headroom: −{fmt(hrWindow.tokens)} tok · ${hrWindow.usd.toFixed(2)}{' '}
            <Text dimColor>(lifetime ${hr.lifetime.usdSaved.toFixed(0)})</Text>
          </Text>
        )}

        {r?.days.map(d => (
          <Box flexDirection="column">
            <Text> </Text>
            <Text weight="semibold">
              {d.date}{' '}
              <Text dimColor>
                · {fmt(Object.values(d.models).reduce((a, m) => a + m.requests, 0))} req
                {hr?.days[d.date] ? ` · headroom −${fmt(hr.days[d.date].tokensSaved)}` : ''}
              </Text>
            </Text>
            {Object.entries(d.models)
              .sort(([, a], [, b]) => fresh(b) - fresh(a))
              .map(([model, m]) => (
                <Text>
                  {'  '}
                  {model.replace(/^claude-/, '').padEnd(13)}
                  {fmt(fresh(m)).padStart(7)} <Text dimColor>+{fmt(m.cacheRead)} cache</Text>
                </Text>
              ))}
          </Box>
        ))}

        <Text> </Text>
        <Box>
          <Button key="refresh" label={busy ? 'Refreshing…' : 'Refresh'} onPress={() => void scan($)} />
          {r && <Text dimColor> {new Date(r.generatedAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</Text>}
        </Box>
        <Text dimColor>tok = input + output + cache write</Text>
      </Box>
    )
  })
}
