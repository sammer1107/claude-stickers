// Shows an agent the stickers on a file whenever it reads, edits or writes that file. How to
// write one is in the plugin's skill (skills/add-sticker), whose description every agent and
// subagent sees; a system prompt section would be dropped where an organization seats
// sec-default. No tool of its own: stickers are plain files written with the normal file tools.

import type { EngineInterface, Register } from 'claude-code'
import type { Shown } from '../types'
import {
  type Places,
  type Sticker,
  absolutePath,
  displayPath,
  formatStickers,
  formatUnchanged,
  isStickerFile,
  isWindowsRoot,
  matchKey,
  parseSticker,
  signature,
  stickerFolders,
} from './stickers'

const SHOWN = { plugin: 'stickers', key: 'shown' } as const
const MAIN = 'main' // the main conversation's loop, which carries no agentId

export const register: Register = on => {
  // After the tool has run, add the file's stickers to what the model reads (the user never sees it).
  // Each agent (main conversation, each subagent) has its own context, so its own "already shown".
  // Only a Read gets the short "unchanged" reminder: an Edit or Write always follows a Read of
  // the file, and the reminder would arrive after the change was already made.
  // If anything here fails, the tool's own result goes through unchanged.
  on('tool.call', { tool: 'Read' }, ($, e, next) => withStickers($, e.agentId ?? MAIN, e.file_path, true, next(e)))
    .catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Edit' }, ($, e, next) => withStickers($, e.agentId ?? MAIN, e.file_path, false, next(e)))
    .catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Write' }, ($, e, next) => withStickers($, e.agentId ?? MAIN, e.file_path, false, next(e)))
    .catch(($, e, next) => next(e))

  // Compaction summarises away what was shown, so that agent sees its stickers in full again.
  // (A precomputed compaction counts too: at worst one extra full display, never a missed note.)
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (result.messages) await forget($, e.agentId ?? MAIN)
    return result
  }).catch(($, e, next) => next(e)) // never get in the way of a compaction
  // /clear starts the conversation over: nothing has been shown to anyone.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await $.state.set(SHOWN, {})
    return next(e)
  })
}

/** Drops everything shown to one agent, so its next opens show stickers in full. */
async function forget($: EngineInterface, agent: string): Promise<void> {
  const shown: Shown = (await $.state.get(SHOWN)).value ?? {}
  const kept = Object.fromEntries(Object.entries(shown).filter(([key]) => !key.startsWith(`${agent}|`)))
  await $.state.set(SHOWN, kept)
}

async function withStickers<R extends { deny?: string; isError?: boolean; context?: readonly string[] }>(
  $: EngineInterface,
  agent: string,
  filePath: string,
  remind: boolean,
  running: Promise<R>,
): Promise<R> {
  const ran = await running
  if (ran.deny !== undefined || ran.isError) return ran
  let note: string | null = null
  try {
    note = await stickerNote($, agent, filePath, remind)
  } catch {
    return ran // stickers must never break a file tool
  }
  return note ? { ...ran, context: [...(ran.context ?? []), note] } : ran
}

/**
 * The text to show for the file at `filePath`, or null when there is nothing to show: no
 * stickers, or nothing new and no reminder wanted (`remind` is false).
 */
async function stickerNote(
  $: EngineInterface,
  agent: string,
  filePath: string,
  remind: boolean,
): Promise<string | null> {
  const root = await $.session.root()
  const places: Places = {
    root,
    home: (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? null,
    windows: isWindowsRoot(root),
  }
  const file = absolutePath(filePath, root, places.home)
  if (!file) return null
  if (isStickerFile(file, places)) {
    // A sticker was read or written: its folder's listing may be stale now.
    folderCache.delete(matchKey(file.slice(0, file.lastIndexOf('/')), places.windows))
    return null
  }
  const fileKey = matchKey(file, places.windows)

  const stickers = (await readAllStickers($, file, places)).filter(s =>
    s.targets.some(t => matchKey(t, places.windows) === fileKey),
  )
  if (stickers.length === 0) return null

  // Full text the first time this agent opens the file, and whenever a sticker changed;
  // otherwise a short reminder, or nothing.
  const target = displayPath(file, places)
  const shown: Shown = (await $.state.get(SHOWN)).value ?? {}
  const key = `${agent}|${fileKey}`
  const sig = signature(stickers)
  if (shown[key] === sig) return remind ? formatUnchanged(target, stickers.length) : null
  await $.state.set(SHOWN, { ...shown, [key]: sig })
  return formatStickers(target, fileKey, stickers, await $.clock.now(), places.windows)
}

/**
 * The stickers that may apply to `file`: from the `.stickers/` in its folder and every folder
 * above it (`on:` relative to the folder holding that `.stickers/`), and the user's (`on:`
 * absolute or `~/...`; a relative path there is ignored, as it names no one project).
 */
async function readAllStickers($: EngineInterface, file: string, places: Places): Promise<Sticker[]> {
  const stickers: Sticker[] = []
  for (const { folder, base } of stickerFolders(file, places)) {
    stickers.push(...(await readStickers($, folder, base, places)))
  }
  return stickers
}

// Folder listings, reused for FOLDER_TTL_MS: reading many files checks each ancestor folder
// about once, not once per file. A missing folder is cached too (as null). The agent's own
// changes to a sticker drop its folder's entry at once (see stickerNote); changes made
// elsewhere show within the TTL.
const FOLDER_TTL_MS = 10_000
type Listing = Awaited<ReturnType<EngineInterface['fs']['list']>>
const folderCache = new Map<string, { at: number; entries: Listing | null }>()

async function listFolder($: EngineInterface, folder: string, windows: boolean): Promise<Listing | null> {
  const key = matchKey(folder, windows)
  const now = await $.clock.now()
  const hit = folderCache.get(key)
  if (hit && now - hit.at < FOLDER_TTL_MS) return hit.entries
  let entries: Listing | null
  try {
    entries = await $.fs.list(folder)
  } catch {
    entries = null // no stickers folder here
  }
  folderCache.set(key, { at: now, entries })
  return entries
}

// Parsed stickers by path, reused while a file's modification time is unchanged.
const cache = new Map<string, { mtimeMs: number; parsed: { on: string[]; body: string } | null }>()

async function readStickers($: EngineInterface, folder: string, base: string | null, places: Places): Promise<Sticker[]> {
  const entries = await listFolder($, folder, places.windows)
  if (!entries) return []
  const stickers: Sticker[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.md')) continue
    const path = `${folder}/${entry.name}`
    let hit = cache.get(path)
    if (!hit || hit.mtimeMs !== entry.mtimeMs) {
      const text = await $.fs.read(path)
      hit = { mtimeMs: entry.mtimeMs, parsed: typeof text === 'string' ? parseSticker(text) : null }
      cache.set(path, hit)
    }
    if (!hit.parsed) continue
    stickers.push({
      path: displayPath(path, places),
      mtimeMs: entry.mtimeMs,
      on: hit.parsed.on,
      targets: hit.parsed.on.map(p => absolutePath(p, base, places.home) ?? ''),
      body: hit.parsed.body,
    })
  }
  return stickers
}
