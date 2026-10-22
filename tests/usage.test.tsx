import { expect, mock, test } from 'claude-code/testing'

import type { Report } from '../types'

const REPORT: Report = {
  generatedAt: '2026-10-22T12:00:00.000Z',
  fromDay: '2026-10-16',
  days: [
    {
      date: '2026-10-22',
      models: {
        'claude-opus-5-5': { input: 1000, output: 200_000, cacheWrite: 1_000_000, cacheRead: 50_000_000, requests: 300 },
        'claude-sonnet-5-5': { input: 500, output: 50_000, cacheWrite: 200_000, cacheRead: 9_000_000, requests: 120 },
      },
    },
  ],
  session: {
    'claude-opus-5-5': { input: 100, output: 20_000, cacheWrite: 80_000, cacheRead: 3_000_000, requests: 40 },
  },
  headroom: { days: { '2026-10-22': { tokensSaved: 2_500_000, usdSaved: 7.5 } }, lifetime: { tokensSaved: 9e7, usdSaved: 533 } },
}

const PANE = {
  plugin: 'token-usage-tracker',
  component: 'Pane',
  requestId: 'usage',
  props: {
    title: 'Token usage',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('the pane shows the day per model, headroom and a limit past 80%', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-22T12:00:00Z') })
  mock.store(on)
  const toasts: string[] = []
  on('command.register', () => ({ value: { command: 'token-usage' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: {} }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: {} }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(REPORT), stderr: '' } }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { contextWindow: 300_000 },
      cost: { usd: 3.21 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 85, resetsAt: '2026-10-22T15:10:00Z' },
        { kind: 'seven_day', percentUsed: 44, resetsAt: '2026-10-27T20:00:00Z' },
      ],
    },
  }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // Another plugin's band, beneath this one.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>other band</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(toasts.length).toBe(1)
  expect(toasts[0]).toMatch(/5h limit at 85%/)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /opus-5-5/ }))?.text).toMatch(/opus-5-5\s+1\.2M/)
    expect(await ui.find({ type: 'Text', text: /85%/ })).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /headroom: / }))?.text).toMatch(/2\.5M tok · \$7\.50/)
    await ui.unmount()
  }

  // The band shows this session, starts folded, opens on a press, and keeps another plugin's band below it.
  const band = await $.ui.mount({
    plugin: 'token-usage-tracker',
    component: 'AbovePrompt',
    requestId: 'band',
    surface: 'desktop',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 19 }, view: {} },
  })
  expect((await band.find({ type: 'Text', text: /session/ }))?.text).toMatch(/session 100\.1K tok · \$3\.21/)
  expect(await band.find({ type: 'Text', text: /other band/ })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: /opus-5-5/ })).toBeUndefined()
  await band.press({ key: 'usage-toggle' })
  expect((await band.find({ type: 'Text', text: /opus-5-5/ }))?.text).toMatch(/opus-5-5\s+100\.1K tok · 40 req · \+3\.0M cache read/)
  await band.unmount()
})
