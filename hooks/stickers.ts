// Stickers: notes stuck on files. Pure logic, no engine calls: parsing a sticker's header,
// matching file paths, and the text the model reads when it opens a file.

export const STICKERS_DIR = '.stickers'
export const MAX_SHOWN_CHARS = 4000

export type Sticker = {
  /** The sticker's own path, relative to the project root, e.g. `.stickers/cache-attempt.md`. */
  path: string
  /** The files it is stuck on, as written in its `on:` header. */
  on: string[]
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
 *     Tried caching the token here; broke test_refresh because ...
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

/**
 * A path as the project sees it: relative to the root, forward slashes, no `./`.
 * Accepts absolute paths (Windows or POSIX) under the root and relative ones.
 * Returns null for a path outside the project.
 */
export function relativePath(path: string, root: string): string | null {
  const windows = isWindowsRoot(root)
  const clean = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/')
  let p = clean(path.trim())
  const r = clean(root).replace(/\/$/, '')
  const isAbsolute = /^[A-Za-z]:\//.test(p) || p.startsWith('/')
  if (isAbsolute) {
    const same = windows ? p.toLowerCase().startsWith(r.toLowerCase() + '/') : p.startsWith(r + '/')
    if (!same) return null
    p = p.slice(r.length + 1)
  }
  const parts: string[] = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return parts.length ? parts.join('/') : null
}

/** The key two paths are compared by: case is ignored on Windows, as the file system does. */
export function matchKey(relative: string, windows: boolean): string {
  return windows ? relative.toLowerCase() : relative
}

export function isInsideStickers(relative: string, windows: boolean): boolean {
  return matchKey(relative, windows).startsWith(matchKey(STICKERS_DIR + '/', windows))
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
 * The full display, shown the first time in a session (and again after any change): each
 * sticker's path to edit, when it was last edited, the other files it is on, and its text.
 * Past MAX_SHOWN_CHARS only the paths are listed, to be Read when needed.
 */
export function formatStickers(target: string, stickers: Sticker[], nowMs: number, windows: boolean): string {
  const others = (s: Sticker) =>
    s.on.filter(p => matchKey(relativePath(p, '') ?? p, windows) !== matchKey(target, windows))
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
  'When you Read, Edit or Write a file, its stickers are shown to you with their paths, so you',
  'can edit or delete them like any file.',
].join('\n')
