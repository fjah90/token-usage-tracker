#!/usr/bin/env node
// Reads Claude Code transcripts (~/.claude/projects/**/*.jsonl) and prints the
// token usage per local day and model as JSON. Parsed rows are cached per file
// (mtime + size), so later runs only re-read the transcripts that changed.
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

const CACHE_VERSION = 1

export const localDay = ts => {
  const d = new Date(ts)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const walk = (dir, sinceMs, out = []) => {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name)
    if (ent.isDirectory()) walk(path, sinceMs, out)
    else if (ent.name.endsWith('.jsonl')) {
      const st = statSync(path)
      if (st.mtimeMs >= sinceMs) out.push({ path, mtimeMs: st.mtimeMs, size: st.size })
    }
  }
  return out
}

// One row per API response: [key, timestamp, model, input, output, cacheWrite, cacheRead]
export const parseFile = async path => {
  const rows = []
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.includes('"usage"')) continue
    let r
    try { r = JSON.parse(line) } catch { continue }
    const m = r.message
    const u = m?.usage
    if (!u || !r.timestamp || !m.model || m.model === '<synthetic>') continue
    rows.push([`${m.id}:${r.requestId ?? ''}`, r.timestamp, m.model,
      u.input_tokens ?? 0, u.output_tokens ?? 0,
      u.cache_creation_input_tokens ?? 0, u.cache_read_input_tokens ?? 0])
  }
  return rows
}

// Transcripts repeat one response per content block, and resumed or forked
// sessions copy earlier ones: each key counts once.
export const aggregate = (rows, fromDay) => {
  const seen = new Set()
  const days = {}
  for (const [key, ts, model, input, output, cacheWrite, cacheRead] of rows) {
    const day = localDay(ts)
    if (day < fromDay || seen.has(key)) continue
    seen.add(key)
    const m = ((days[day] ??= {})[model] ??= { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, requests: 0 })
    m.input += input; m.output += output; m.cacheWrite += cacheWrite; m.cacheRead += cacheRead; m.requests += 1
  }
  return Object.keys(days).sort().reverse().map(date => ({ date, models: days[date] }))
}

// proxy_savings.json keeps cumulative snapshots: a day's saving is its last
// snapshot minus the previous day's last one.
export const headroomDays = (history, fromDay) => {
  const last = {}
  for (const h of history) last[localDay(h.timestamp)] = h
  const keys = Object.keys(last).sort()
  const out = {}
  for (let i = 1; i < keys.length; i++) {
    const [a, b] = [last[keys[i - 1]], last[keys[i]]]
    const tokens = b.total_tokens_saved - a.total_tokens_saved
    if (keys[i] >= fromDay && tokens >= 0) {
      out[keys[i]] = { tokensSaved: tokens, usdSaved: +(b.compression_savings_usd - a.compression_savings_usd).toFixed(2) }
    }
  }
  return out
}

// One session's rows summed per model, all days: its transcript and its subagents' carry its id.
export const sessionModels = rows => {
  const out = {}
  for (const d of aggregate(rows, '')) {
    for (const [model, m] of Object.entries(d.models)) {
      const t = (out[model] ??= { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, requests: 0 })
      for (const k of Object.keys(t)) t[k] += m[k]
    }
  }
  return out
}

const readHeadroom = (path, fromDay) => {
  if (!existsSync(path)) return null
  try {
    const d = JSON.parse(readFileSync(path, 'utf8'))
    return {
      days: headroomDays(d.history ?? [], fromDay),
      lifetime: { tokensSaved: d.lifetime?.tokens_saved ?? 0, usdSaved: d.lifetime?.compression_savings_usd ?? 0 },
    }
  } catch { return null }
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}

const main = async () => {
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  const days = Number(arg('days', 7))
  const projects = arg('projects', join(configDir, 'projects'))
  const cachePath = arg('cache', join(configDir, 'token-usage-tracker', 'cache.json'))
  const sessionId = arg('session')
  const headroomPath = arg('headroom', join(homedir(), '.headroom', 'proxy_savings.json'))

  const from = new Date()
  from.setHours(0, 0, 0, 0)
  from.setDate(from.getDate() - (days - 1))
  const fromDay = localDay(from)

  let cache = { version: CACHE_VERSION, files: {} }
  try {
    const c = JSON.parse(readFileSync(cachePath, 'utf8'))
    if (c.version === CACHE_VERSION) cache = c
  } catch {}

  const files = existsSync(projects) ? walk(projects, from.getTime()) : []
  const next = {}
  for (const f of files) {
    const hit = cache.files[f.path]
    next[f.path] = hit && hit.mtimeMs === f.mtimeMs && hit.size === f.size
      ? hit
      : { mtimeMs: f.mtimeMs, size: f.size, rows: await parseFile(f.path) }
  }
  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, JSON.stringify({ version: CACHE_VERSION, files: next }))

  process.stdout.write(JSON.stringify({
    generatedAt: new Date().toISOString(),
    fromDay,
    days: aggregate(Object.values(next).flatMap(f => f.rows), fromDay),
    headroom: readHeadroom(headroomPath, fromDay),
    session: sessionId
      ? sessionModels(Object.entries(next).filter(([path]) => path.includes(sessionId)).flatMap(([, f]) => f.rows))
      : null,
  }))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { process.stderr.write(String(err?.stack ?? err)); process.exit(1) })
}
