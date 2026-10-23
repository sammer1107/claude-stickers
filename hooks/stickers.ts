// Stickers: notes stuck on files. Pure logic, no engine calls: parsing a sticker's header,
// resolving and matching file paths, and the text the model reads when it opens a file.
//
// Two places hold stickers: the project's `.stickers/` (its `on:` paths relative to the
// project root) and the user's `~/.claude/stickers/` (its `on:` paths absolute or `~/...`),
// for notes kept out of the project or about files outside it. Every path is compared in
// absolute form, so both kinds match the same file however a tool spells it.

export const STICKERS_DIR = '.stickers'
export const USER_STICKERS_DIR = '~/.claude/stickers'
export const MAX_SHOWN_CHARS = 4000

/** Where paths are resolved from. */
export type Places = {
  /** The session's project root, absolute. */
  root: string
  /** The user's home folder, absolute, or null when unknown (no user stickers then). */
  home: string | null
  /** Windows paths: case is ignored, as the file system does. */
  windows: boolean
}

export type Sticker = {
  /** The sticker's own path as shown: `.stickers/x.md` or `~/.claude/stickers/x.md`. */
  path: string
  /** The files it is stuck on, as written in its `on:` header. */
  on: string[]
  /** The same files, absolute and normalised (see `absolutePath`); unusable entries dropped. */
  targets: string[]
  /** Its text, without the header. */
  body: string
  mtimeMs: number
}

/**
 * Reads a sticker file: a front-matter header naming the files it is stuck on, then its text.
 *
 *     ---
 *     on: src/auth/session.py, src/auth/tokens.py
 *     ---
 *     Do NOT reorder the imports. tokens.py monkey-patches time.time() on import ...
 *
 * Returns null when there is no header or no `on:` line, so a stray file is ignored.
 */
export function parseSticker(text: string): { on: string[]; body: string } | null {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!match) return null
  const onLine = (match[1] ?? '').split(/\r?\n/).find(line => /^on\s*:/.test(line))
  if (!onLine) return null
  const on = onLine
    .replace(/^on\s*:/, '')
    .split(',')
    .map(p => p.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
  if (on.length === 0) return null
  return { on, body: text.slice(match[0].length).trim() }
}

/** True for a Windows project root like `D:\work\app` or `D:/work/app`. */
export function isWindowsRoot(root: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(root)
}

const clean = (p: string) => p.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
const isAbsolute = (p: string) => /^[A-Za-z]:\//.test(p) || p.startsWith('/')

/**
 * A path in one absolute, comparable spelling: forward slashes, no `.` or `..`, no trailing
 * slash. `~` means the home folder; a relative path is resolved against `base`, or rejected
 * when `base` is null. Returns null when it can't be resolved.
 */
export function absolutePath(path: string, base: string | null, home: string | null): string | null {
  let p = clean(path)
  if (p === '~' || p.startsWith('~/')) {
    if (!home) return null
    p = clean(home) + p.slice(1)
  } else if (!isAbsolute(p)) {
    if (!base) return null
    p = `${clean(base)}/${p}`
  }
  const drive = /^[A-Za-z]:/.exec(p)?.[0] ?? ''
  const parts: string[] = []
  for (const part of p.slice(drive.length).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return `${drive}/${parts.join('/')}`
}

/** The key two absolute paths are compared by: case is ignored on Windows. */
export function matchKey(absolute: string, windows: boolean): string {
  return windows ? absolute.toLowerCase() : absolute
}

/** True when `absolute` is `dir` itself or inside it. */
export function isUnder(absolute: string, dir: string, windows: boolean): boolean {
  const a = matchKey(absolute, windows)
  const d = matchKey(dir, windows).replace(/\/$/, '')
  return a === d || a.startsWith(d + '/')
}

/** How a file is named to the model: relative inside the project, `~/...` in the home folder. */
export function displayPath(absolute: string, places: Places): string {
  const root = absolutePath(places.root, null, null)
  if (root && isUnder(absolute, root, places.windows) && absolute.length > root.length) {
    return absolute.slice(root.length + 1)
  }
  const home = places.home && absolutePath(places.home, null, null)
  if (home && isUnder(absolute, home, places.windows) && absolute.length > home.length) {
    return `~/${absolute.slice(home.length + 1)}`
  }
  return absolute
}

/** True for the sticker files themselves, which never get stickers. */
export function isStickerFile(absolute: string, places: Places): boolean {
  const project = absolutePath(STICKERS_DIR, places.root, null)
  const user = absolutePath(USER_STICKERS_DIR, null, places.home)
  return [project, user].some(dir => dir !== null && isUnder(absolute, dir, places.windows))
}

/** How long ago, roughly: "just now", "5 min ago", "2 h ago", "3 days ago". */
export function age(mtimeMs: number, nowMs: number): string {
  const s = Math.max(0, (nowMs - mtimeMs) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  const days = Math.floor(s / 86400)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

/** Changes whenever a sticker on the file is added, removed or edited. */
export function signature(stickers: Sticker[]): string {
  return stickers.map(s => `${s.path}@${s.mtimeMs}`).sort().join('|')
}

/**
 * The full display, shown the first time (and again after any change): each sticker's path
 * to edit, when it was last edited, the other files it is on, and its text. Past
 * MAX_SHOWN_CHARS only the paths are listed, to be Read when needed.
 */
export function formatStickers(target: string, targetKey: string, stickers: Sticker[], nowMs: number, windows: boolean): string {
  const others = (s: Sticker) => s.on.filter((_, i) => s.targets[i] === undefined || matchKey(s.targets[i]!, windows) !== targetKey)
  const header = (s: Sticker) => {
    const also = others(s)
    return `- ${s.path} (edited ${age(s.mtimeMs, nowMs)}${also.length ? `; also on ${also.join(', ')}` : ''})`
  }
  const title = `Stickers on ${target} (${stickers.length}):`
  const full = [title, ...stickers.map(s => `${header(s)}\n${indent(s.body || '(empty)')}`)].join('\n')
  if (full.length <= MAX_SHOWN_CHARS) return full
  return [title, ...stickers.map(header), '(Too long to show here; Read a sticker to see it.)'].join('\n')
}

/** The short reminder for a later read when nothing changed since the full display. */
export function formatUnchanged(target: string, count: number): string {
  return `Stickers on ${target}: ${count}, unchanged since shown.`
}

function indent(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => `  ${line}`)
    .join('\n')
}

/** The system prompt section that says stickers exist and how to write one; not when to. */
export const ABOUT = [
  'Stickers: notes stuck on files in this project, kept across sessions.',
  `To leave one, write a markdown file in ${STICKERS_DIR}/ (any name) that starts with a header naming`,
  'the file or files it is stuck on, relative to the project root:',
  '---',
  'on: src/example.py, src/other.py',
  '---',
  'Your note.',
  `To keep a note out of the project (personal, or about a file outside it), write it in`,
  `${USER_STICKERS_DIR}/ instead, with absolute or ~/ paths in its on: line.`,
  'When you Read, Edit or Write a file, its stickers are shown to you with their paths, so you',
  'can edit or delete them like any file.',
].join('\n')
