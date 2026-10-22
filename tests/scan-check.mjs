// node tests/scan-check.mjs
import assert from 'node:assert/strict'

import { aggregate, headroomDays, localDay, sessionModels } from '../hooks/scan.mjs'

const ts = localDay('2026-10-22T12:00:00Z') === '2026-10-22' ? '2026-10-22T12:00:00Z' : '2026-10-22T16:00:00Z'
const days = aggregate([
  ['msg1:req1', ts, 'claude-opus-5-5', 1, 10, 100, 1000],
  ['msg1:req1', ts, 'claude-opus-5-5', 1, 10, 100, 1000], // same response, another content block
  ['msg2:req2', ts, 'claude-sonnet-5-5', 2, 20, 200, 2000],
  ['old:req', '2026-10-01T12:00:00Z', 'claude-opus-5-5', 9, 9, 9, 9],
], '2026-10-16')
assert.equal(days.length, 1)
assert.deepEqual(days[0].models['claude-opus-5-5'], { input: 1, output: 10, cacheWrite: 100, cacheRead: 1000, requests: 1 })
assert.equal(days[0].models['claude-sonnet-5-5'].requests, 1)

const hr = headroomDays([
  { timestamp: '2026-10-20T12:00:00Z', total_tokens_saved: 100, compression_savings_usd: 1 },
  { timestamp: '2026-10-20T20:00:00Z', total_tokens_saved: 150, compression_savings_usd: 1.5 },
  { timestamp: '2026-10-21T12:00:00Z', total_tokens_saved: 400, compression_savings_usd: 4 },
], '2026-10-16')
assert.deepEqual(hr, { '2026-10-21': { tokensSaved: 250, usdSaved: 2.5 } })

const sess = sessionModels([
  ['a:1', '2026-10-01T12:00:00Z', 'claude-opus-5-5', 1, 1, 1, 1],
  ['a:1', '2026-10-01T12:00:00Z', 'claude-opus-5-5', 1, 1, 1, 1],
  ['b:2', '2026-10-22T12:00:00Z', 'claude-opus-5-5', 2, 2, 2, 2],
])
assert.deepEqual(sess['claude-opus-5-5'], { input: 3, output: 3, cacheWrite: 3, cacheRead: 3, requests: 2 })

console.log('scan-check ok')
