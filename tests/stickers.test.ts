import { expect, mock, test } from 'claude-code/testing'
import {
  MAX_SHOWN_CHARS,
  age,
  absolutePath,
  displayPath,
  formatStickers,
  isStickerFile,
  parseSticker,
} from '../hooks/stickers'

// ------------------------------------------------------------------ pure logic

test('a sticker header names the files it is stuck on', async () => {
  expect(parseSticker('---\non: src/a.py, src/b.py\n---\nTried X.\nIt broke Y.')).toEqual({
    on: ['src/a.py', 'src/b.py'],
    body: 'Tried X.\nIt broke Y.',
  })
  expect(parseSticker('---\r\ntitle: x\r\non: "src/a.py"\r\n---\r\nbody')?.on).toEqual(['src/a.py'])
  expect(parseSticker('no header, just text')).toBe(null)
  expect(parseSticker('---\ntitle: no on line\n---\nbody')).toBe(null)
  expect(parseSticker('---\non:\n---\nbody')).toBe(null)
})

test('paths resolve to one absolute spelling however the tools spell them', async () => {
  const home = 'D:\\Users\\me'
  const root = 'D:\\Users\\me\\proj'
  expect(absolutePath('D:\\Users\\me\\proj\\src\\a.py', root, home)).toBe('D:/Users/me/proj/src/a.py')
  expect(absolutePath('./src//a.py', root, home)).toBe('D:/Users/me/proj/src/a.py')
  expect(absolutePath('src/x/../a.py', root, home)).toBe('D:/Users/me/proj/src/a.py')
  expect(absolutePath('~/.bashrc', root, home)).toBe('D:/Users/me/.bashrc')
  expect(absolutePath('~/.bashrc', root, null)).toBe(null)
  expect(absolutePath('src/a.py', null, home)).toBe(null)
  expect(absolutePath('/home/me/proj/src/a.py', '/home/me/proj', '/home/me')).toBe('/home/me/proj/src/a.py')
})

test('files are named relative to the project, ~/ in the home folder, absolute elsewhere', async () => {
  const places = { root: 'D:\\Users\\me\\proj', home: 'D:\\Users\\me', windows: true }
  expect(displayPath('d:/users/me/PROJ/src/a.py', places)).toBe('src/a.py')
  expect(displayPath('D:/Users/me/.bashrc', places)).toBe('~/.bashrc')
  expect(displayPath('E:/shared/lib.py', places)).toBe('E:/shared/lib.py')
  expect(isStickerFile('D:/Users/me/proj/.stickers/x.md', places)).toBe(true)
  expect(isStickerFile('D:/Users/me/.claude/stickers/x.md', places)).toBe(true)
  expect(isStickerFile('D:/Users/me/proj/src/a.py', places)).toBe(false)
})

test('ages read naturally', async () => {
  const now = 10 * 86400_000
  expect(age(now - 5_000, now)).toBe('just now')
  expect(age(now - 5 * 60_000, now)).toBe('5 min ago')
  expect(age(now - 2 * 3600_000, now)).toBe('2 h ago')
  expect(age(now - 86400_000, now)).toBe('1 day ago')
  expect(age(now - 3 * 86400_000, now)).toBe('3 days ago')
})

test('a very long display lists only the sticker paths', async () => {
  const big = { path: '.stickers/big.md', on: ['src/a.py'], targets: ['/p/src/a.py'], body: 'x'.repeat(MAX_SHOWN_CHARS), mtimeMs: 0 }
  const text = formatStickers('src/a.py', '/p/src/a.py', [big], 0, false)
  expect(text).toContain('.stickers/big.md')
  expect(text).not.toContain('xxxx')
  expect(text).toContain('Read a sticker to see it')
})

// ------------------------------------------------------------------ in the engine

const ROOT = 'D:\\proj'
const HOME = 'D:\\Users\\me'

// Each test's clock starts far past the last one's, so the mod's folder cache (which lives as
// long as the loaded mod) is always stale for a new test.
let clockStart = 0

/**
 * A fake project: `files` maps the project root's sticker names to their text, `userFiles` the
 * user's (in ~/.claude/stickers/), `more` other `.stickers/` folders by absolute path, `mtimes`
 * any sticker's modification time. Returns the test's clock and every folder the mod listed.
 */
function project(
  on: any,
  files: Record<string, string>,
  mtimes: Record<string, number> = {},
  userFiles: Record<string, string> = {},
  home: string | null = HOME, // null: no home folder variable is set
  more: Record<string, Record<string, string>> = {},
) {
  const key = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const folders = new Map<string, Record<string, string>>([[key(`${ROOT}/.stickers`), files]])
  if (home) folders.set(key(`${home}/.claude/stickers`), userFiles)
  for (const [folder, stickers] of Object.entries(more)) folders.set(key(folder), stickers)
  const lists: string[] = []
  const clock = mock.clock(on, { now: (clockStart += 1e9) })

  on('session.root', () => ({ value: ROOT }))
  on('env.get', ($: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? (home ?? undefined) : undefined }))
  on('fs.list', ($: unknown, e: { path: string }) => {
    lists.push(e.path)
    const folder = folders.get(key(e.path))
    if (!folder || Object.keys(folder).length === 0) throw new Error(`no such folder: ${e.path}`)
    return {
      value: Object.keys(folder).map(name => ({
        name, kind: 'file', size: folder[name]!.length, mtimeMs: mtimes[name] ?? 1, isLink: false,
      })),
    }
  })
  on('fs.read', ($: unknown, e: { path: string }) => {
    const slash = e.path.replace(/\\/g, '/').lastIndexOf('/')
    const folder = folders.get(key(e.path.slice(0, slash)))
    const name = e.path.slice(slash + 1)
    if (!folder || !(name in folder)) throw new Error(`no such file: ${e.path}`)
    return { value: folder[name] }
  })
  // Stands for the file tools themselves: they succeed and return nothing of interest.
  on('tool.call', () => ({ result: {} }))
  return { clock, lists }
}

const SESSION = '---\non: src/auth/session.py, src/auth/tokens.py\n---\nTried caching the token here; broke test_refresh.'
const OTHER = '---\non: src/other.py\n---\nUnrelated.'

test('opening a file shows its stickers in full, with their path and the other files they are on', async ($, on) => {
  project(on, { 'cache-attempt.md': SESSION, 'other.md': OTHER })
  const ran = await $.tool.call({ tool: 'Read', file_path: 'D:\\proj\\src\\auth\\session.py' })
  const shown = (ran.context ?? []).join('\n')
  expect(shown).toContain('Stickers on src/auth/session.py (1):')
  expect(shown).toContain('.stickers/cache-attempt.md (edited ')
  expect(shown).toContain('also on src/auth/tokens.py')
  expect(shown).toContain('Tried caching the token here; broke test_refresh.')
  expect(shown).not.toContain('Unrelated.')
  expect(shown).not.toContain('on: src/auth') // the header is left out
})

test('later reads show a short line; later edits and writes show nothing, until a sticker changes', async ($, on) => {
  const mtimes = { 'cache-attempt.md': 1 }
  const { clock } = project(on, { 'cache-attempt.md': SESSION }, mtimes)
  const file = 'D:\\proj\\src\\auth\\session.py'
  await $.tool.call({ tool: 'Read', file_path: file })

  const reread = await $.tool.call({ tool: 'Read', file_path: file })
  expect(reread.context).toEqual(['Stickers on src/auth/session.py: 1, unchanged since shown.'])
  const edited = await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'a', new_string: 'b' })
  expect(edited.context ?? []).toEqual([])
  const written = await $.tool.call({ tool: 'Write', file_path: file, content: '' })
  expect(written.context ?? []).toEqual([])

  mtimes['cache-attempt.md'] = 2 // the sticker was edited (outside Claude): even an Edit shows it in full,
  await clock.advance(10_001) // once the folder listing is older than its cache time
  const changed = await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'b', new_string: 'c' })
  expect((changed.context ?? []).join('\n')).toContain('Tried caching the token here')
})

test('an Edit as the first touch shows stickers in full', async ($, on) => {
  project(on, { 'cache-attempt.md': SESSION })
  const edited = await $.tool.call({ tool: 'Edit', file_path: 'D:\\proj\\src\\auth\\session.py', old_string: 'a', new_string: 'b' })
  expect((edited.context ?? []).join('\n')).toContain('Tried caching the token here')
})

test('a sticker on two files shows on both, each in full the first time', async ($, on) => {
  project(on, { 'cache-attempt.md': SESSION })
  await $.tool.call({ tool: 'Read', file_path: 'D:\\proj\\src\\auth\\session.py' })
  const other = await $.tool.call({ tool: 'Read', file_path: 'D:\\proj\\src\\auth\\tokens.py' })
  const shown = (other.context ?? []).join('\n')
  expect(shown).toContain('Stickers on src/auth/tokens.py (1):')
  expect(shown).toContain('also on src/auth/session.py')
})

test('files without stickers, stickers themselves and files outside the project show nothing', async ($, on) => {
  project(on, { 'cache-attempt.md': SESSION })
  for (const file_path of [
    'D:\\proj\\src\\plain.py',
    'D:\\proj\\.stickers\\cache-attempt.md',
    'D:\\elsewhere\\src\\auth\\session.py',
  ]) {
    const ran = await $.tool.call({ tool: 'Read', file_path })
    expect(ran.context ?? []).toEqual([])
  }
})

test('a project without a .stickers folder works as usual', async ($, on) => {
  on('session.root', () => ({ value: ROOT }))
  on('fs.list', () => { throw new Error('no such folder') })
  on('tool.call', () => ({ result: {} }))
  const ran = await $.tool.call({ tool: 'Read', file_path: 'D:\\proj\\src\\a.py' })
  expect(ran.context ?? []).toEqual([])
})
// ------------------------------------------------------------------ user stickers

const USER_SESSION = '---\non: D:/proj/src/auth/session.py\n---\nPersonal: I always forget this file has a gotcha.'
const USER_BASHRC = '---\non: ~/.bashrc\n---\nPATH order matters here.'
const USER_RELATIVE = '---\non: src/auth/session.py\n---\nNever shown: a relative path names no one project.'

test('user stickers show alongside project ones, with their ~/.claude/stickers path', async ($, on) => {
  project(on, { 'cache-attempt.md': SESSION }, {}, { 'mine.md': USER_SESSION, 'relative.md': USER_RELATIVE })
  const shown = ((await $.tool.call({ tool: 'Read', file_path: 'D:\\proj\\src\\auth\\session.py' })).context ?? []).join('\n')
  expect(shown).toContain('Stickers on src/auth/session.py (2):')
  expect(shown).toContain('.stickers/cache-attempt.md')
  expect(shown).toContain('~/.claude/stickers/mine.md')
  expect(shown).toContain('Personal: I always forget this file has a gotcha.')
  expect(shown).not.toContain('Never shown')
})

test('a user sticker can be stuck on a file outside the project', async ($, on) => {
  project(on, {}, {}, { 'bashrc.md': USER_BASHRC })
  const shown = ((await $.tool.call({ tool: 'Read', file_path: 'D:\\Users\\me\\.bashrc' })).context ?? []).join('\n')
  expect(shown).toContain('Stickers on ~/.bashrc (1):')
  expect(shown).toContain('PATH order matters here.')
})

test('without a home folder, user stickers are skipped and project ones still work', async ($, on) => {
  project(on, { 'cache-attempt.md': SESSION }, {}, { 'mine.md': USER_SESSION }, null)
  const shown = ((await $.tool.call({ tool: 'Read', file_path: 'D:\\proj\\src\\auth\\session.py' })).context ?? []).join('\n')
  expect(shown).toContain('Tried caching the token here')
  expect(shown).not.toContain('Personal')
})

test('the user sticker files themselves never show stickers', async ($, on) => {
  project(on, {}, {}, { 'mine.md': '---\non: ~/.claude/stickers/mine.md\n---\nA sticker on itself.' })
  const ran = await $.tool.call({ tool: 'Read', file_path: 'D:\\Users\\me\\.claude\\stickers\\mine.md' })
  expect(ran.context ?? []).toEqual([])
})

// ------------------------------------------------------------------ agents, compaction, /clear

const FILE = 'D:\\proj\\src\\auth\\session.py'
const isFull = (ran: { context?: readonly string[] }) => (ran.context ?? []).join('\n').includes('Tried caching')
const SUMMARY = [{ role: 'user' as const, text: 'Summary of the conversation so far.', toolUses: [] }]
const isShort = (ran: { context?: readonly string[] }) => (ran.context ?? []).join('\n').includes('unchanged since shown')

test('each subagent sees stickers in full the first time, even after the main agent did', async ($, on) => {
  project(on, { 'cache-attempt.md': SESSION })
  expect(isFull(await $.tool.call({ tool: 'Read', file_path: FILE }))).toBe(true)
  expect(isFull(await $.tool.call({ tool: 'Read', file_path: FILE, agentId: 'a1' }))).toBe(true)
  expect(isShort(await $.tool.call({ tool: 'Read', file_path: FILE, agentId: 'a1' }))).toBe(true)
  expect(isShort(await $.tool.call({ tool: 'Read', file_path: FILE }))).toBe(true)
})

test('after a compaction, that agent sees its stickers in full again; other agents do not', async ($, on) => {
  project(on, { 'cache-attempt.md': SESSION })
  // Stands for the engine: the compaction went through, leaving its summary.
  on('session.compact', () => ({ messages: SUMMARY }))
  await $.tool.call({ tool: 'Read', file_path: FILE })
  await $.tool.call({ tool: 'Read', file_path: FILE, agentId: 'a1' })

  await $.session.compact({ trigger: 'manual', messages: SUMMARY })
  expect(isFull(await $.tool.call({ tool: 'Read', file_path: FILE }))).toBe(true)
  expect(isShort(await $.tool.call({ tool: 'Read', file_path: FILE, agentId: 'a1' }))).toBe(true)

  await $.session.compact({ trigger: 'auto', agentId: 'a1', messages: SUMMARY })
  expect(isFull(await $.tool.call({ tool: 'Read', file_path: FILE, agentId: 'a1' }))).toBe(true)
  expect(isShort(await $.tool.call({ tool: 'Read', file_path: FILE }))).toBe(true)
})

test('a skipped compaction changes nothing', async ($, on) => {
  project(on, { 'cache-attempt.md': SESSION })
  on('session.compact', () => ({ skip: 'not now' }))
  await $.tool.call({ tool: 'Read', file_path: FILE })
  await $.session.compact({ trigger: 'manual', messages: SUMMARY })
  expect(isShort(await $.tool.call({ tool: 'Read', file_path: FILE }))).toBe(true)
})

test('/clear starts over: stickers are shown in full again', async ($, on) => {
  project(on, { 'cache-attempt.md': SESSION })
  on('session.end', (_: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  await $.tool.call({ tool: 'Read', file_path: FILE })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(isFull(await $.tool.call({ tool: 'Read', file_path: FILE }))).toBe(true)
})
// ------------------------------------------------------------------ .stickers/ in every ancestor folder

test('a file in another project gets that project\'s stickers', async ($, on) => {
  project(on, {}, {}, {}, HOME, {
    'D:/other/.stickers': { 'o.md': '---\non: lib/x.py\n---\nOther project note.' },
  })
  const shown = ((await $.tool.call({ tool: 'Read', file_path: 'D:\\other\\lib\\x.py' })).context ?? []).join('\n')
  expect(shown).toContain('Stickers on D:/other/lib/x.py (1):')
  expect(shown).toContain('- D:/other/.stickers/o.md (edited ')
  expect(shown).toContain('Other project note.')
})

test('stickers from every ancestor folder apply, each relative to its own folder', async ($, on) => {
  project(on, { 'root.md': '---\non: pkg/api/a.py\n---\nRoot note.' }, {}, {}, HOME, {
    'D:/proj/pkg/api/.stickers': { 'pkg.md': '---\non: a.py\n---\nPackage note.' },
    'D:/proj/pkg/.stickers': { 'mid.md': '---\non: api/a.py\n---\nMiddle note.' },
  })
  const shown = ((await $.tool.call({ tool: 'Read', file_path: 'D:\\proj\\pkg\\api\\a.py' })).context ?? []).join('\n')
  expect(shown).toContain('Stickers on pkg/api/a.py (3):')
  for (const text of ['pkg/api/.stickers/pkg.md', 'pkg/.stickers/mid.md', '.stickers/root.md', 'Package note.', 'Middle note.', 'Root note.']) {
    expect(shown).toContain(text)
  }
  // A file inside a nested .stickers/ is a sticker itself, never a target.
  const ran = await $.tool.call({ tool: 'Read', file_path: 'D:\\proj\\pkg\\api\\.stickers\\pkg.md' })
  expect(ran.context ?? []).toEqual([])
})

test('reading many files checks each folder once within the cache time', async ($, on) => {
  const { clock, lists } = project(on, {})
  for (let i = 0; i < 50; i++) {
    await $.tool.call({ tool: 'Read', file_path: `D:\\proj\\src\\deep\\file${i}.py` })
  }
  // D:/proj/src/deep, D:/proj/src, D:/proj, D: and the user's folder: one listing each.
  expect(lists.length).toBe(5)

  await clock.advance(10_001)
  await $.tool.call({ tool: 'Read', file_path: 'D:\\proj\\src\\deep\\file0.py' })
  expect(lists.length).toBe(10)
})

test('a sticker the agent writes shows at once; one changed elsewhere, within the cache time', async ($, on) => {
  const files: Record<string, string> = {}
  const { clock } = project(on, files)
  const target = 'D:\\proj\\src\\a.py'
  expect((await $.tool.call({ tool: 'Read', file_path: target })).context ?? []).toEqual([])

  // The agent writes a sticker: its folder's cached listing is dropped right away.
  files['new.md'] = '---\non: src/a.py\n---\nJust written.'
  await $.tool.call({ tool: 'Write', file_path: 'D:\\proj\\.stickers\\new.md', content: files['new.md'] })
  expect(((await $.tool.call({ tool: 'Read', file_path: target })).context ?? []).join('\n')).toContain('Just written.')

  // Someone else adds one (no tool call): it shows once the listing is older than the cache time.
  files['other.md'] = '---\non: src/a.py\n---\nAdded in an editor.'
  expect(((await $.tool.call({ tool: 'Read', file_path: target })).context ?? []).join('\n')).not.toContain('Added in an editor.')
  await clock.advance(10_001)
  expect(((await $.tool.call({ tool: 'Read', file_path: target })).context ?? []).join('\n')).toContain('Added in an editor.')
})
