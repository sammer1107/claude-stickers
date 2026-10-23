import { expect, test } from 'claude-code/testing'
import {
  MAX_SHOWN_CHARS,
  age,
  formatStickers,
  parseSticker,
  relativePath,
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

test('paths match however the tools spell them', async () => {
  const root = 'D:\\Users\\me\\proj'
  expect(relativePath('D:\\Users\\me\\proj\\src\\a.py', root)).toBe('src/a.py')
  expect(relativePath('d:/users/me/PROJ/src/a.py', root)).toBe('src/a.py')
  expect(relativePath('./src//a.py', root)).toBe('src/a.py')
  expect(relativePath('src/x/../a.py', root)).toBe('src/a.py')
  expect(relativePath('D:\\elsewhere\\a.py', root)).toBe(null)
  expect(relativePath('/home/me/proj/src/a.py', '/home/me/proj')).toBe('src/a.py')
  expect(relativePath('/home/me/other/a.py', '/home/me/proj')).toBe(null)
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
  const big = { path: '.stickers/big.md', on: ['src/a.py'], body: 'x'.repeat(MAX_SHOWN_CHARS), mtimeMs: 0 }
  const text = formatStickers('src/a.py', [big], 0, false)
  expect(text).toContain('.stickers/big.md')
  expect(text).not.toContain('xxxx')
  expect(text).toContain('Read a sticker to see it')
})

// ------------------------------------------------------------------ in the engine

const ROOT = 'D:\\proj'

/** A fake project: `files` maps sticker file names to their text, `mtimes` to their mtimes. */
function project(on: any, files: Record<string, string>, mtimes: Record<string, number> = {}) {
  on('session.root', () => ({ value: ROOT }))
  on('fs.list', ($: unknown, e: { path: string }) => {
    if (!/[\\/]\.stickers$/.test(e.path)) throw new Error(`no such folder: ${e.path}`)
    return {
      value: Object.keys(files).map(name => ({
        name, kind: 'file', size: files[name]!.length, mtimeMs: mtimes[name] ?? 1, isLink: false,
      })),
    }
  })
  on('fs.read', ($: unknown, e: { path: string }) => {
    const name = e.path.split(/[\\/]/).pop()!
    if (!(name in files)) throw new Error(`no such file: ${e.path}`)
    return { value: files[name] }
  })
  // Stands for the file tools themselves: they succeed and return nothing of interest.
  on('tool.call', () => ({ result: {} }))
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

test('later opens show a short line until a sticker changes', async ($, on) => {
  const mtimes = { 'cache-attempt.md': 1 }
  project(on, { 'cache-attempt.md': SESSION }, mtimes)
  const file = 'D:\\proj\\src\\auth\\session.py'
  await $.tool.call({ tool: 'Read', file_path: file })

  const again = await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'a', new_string: 'b' })
  expect(again.context).toEqual(['Stickers on src/auth/session.py: 1, unchanged since shown.'])

  mtimes['cache-attempt.md'] = 2 // the sticker was edited
  const changed = await $.tool.call({ tool: 'Write', file_path: file, content: '' })
  expect((changed.context ?? []).join('\n')).toContain('Tried caching the token here')
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

test('the system prompt says what stickers are and how to write one', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  const { sections } = await $.prompt.compose({
    model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: [], tools: [], outputStyle: null, traits: [],
  })
  const about = sections.find(s => s.id === 'stickers:about')
  expect(about?.text).toContain('.stickers/')
  expect(about?.text).toContain('on: ')
})

// ------------------------------------------------------------------ agents

const FILE = 'D:\\proj\\src\\auth\\session.py'
const isFull = (ran: { context?: readonly string[] }) => (ran.context ?? []).join('\n').includes('Tried caching')
const isShort = (ran: { context?: readonly string[] }) => (ran.context ?? []).join('\n').includes('unchanged since shown')

test('each subagent sees stickers in full the first time, even after the main agent did', async ($, on) => {
  project(on, { 'cache-attempt.md': SESSION })
  expect(isFull(await $.tool.call({ tool: 'Read', file_path: FILE }))).toBe(true)
  expect(isFull(await $.tool.call({ tool: 'Read', file_path: FILE, agentId: 'a1' }))).toBe(true)
  expect(isShort(await $.tool.call({ tool: 'Read', file_path: FILE, agentId: 'a1' }))).toBe(true)
  expect(isShort(await $.tool.call({ tool: 'Read', file_path: FILE }))).toBe(true)
})
