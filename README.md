# Stickers

Notes stuck on files, for Claude Code. When Claude reads, edits or writes a file, the
stickers on that file are shown to it automatically, so it doesn't re-try what already
failed or re-learn what it already found out. It never has to remember to look them up.

## How it works

A sticker is a markdown file in `.stickers/` at the project root (any name), starting with
a header that names the file or files it is stuck on, relative to the project root:

```markdown
---
on: src/auth/session.py, src/auth/tokens.py
---
Tried caching the token in session.py; broke test_refresh because tokens.py re-reads it.
```

- **Writing:** Claude (or you) creates, edits and deletes stickers like any other file.
  There is no special tool. A short section in Claude's system prompt says what stickers
  are and how to write one.
- **Recall:** after Claude reads, edits or writes `src/auth/session.py`, it sees (you don't):

  ```
  Stickers on src/auth/session.py (1):
  - .stickers/cache-attempt.md (edited 2 h ago; also on src/auth/tokens.py)
    Tried caching the token in session.py; broke test_refresh because tokens.py re-reads it.
  ```

  The first time in a session, and whenever a sticker changed, the stickers are shown in
  full. After that, a short line: `Stickers on src/auth/session.py: 1, unchanged since shown.`
  Past 4,000 characters only the sticker paths are listed.
- **Matching:** paths are matched however the tools spell them (absolute or relative,
  backslashes, `./`), ignoring case on Windows. Files inside `.stickers/` themselves never
  show stickers.

Whether `.stickers/` is committed is up to each project.

## Install

From a clone of this repository (Git Bash):

```bash
claude plugin marketplace add "/path/to/claude-stickers"
claude plugin install stickers@claude-stickers
```

Because the marketplace is a local folder, edits to it reach a session with
`/reload-plugins`, with no reinstall.

## Develop

Stickers is a Claude Code mod: a TypeScript hooks module (`hooks/register.ts`) with its
logic in `hooks/stickers.ts`.

```bash
npm install                  # TypeScript, for type-checking
claude plugin validate .     # what the engine will load, and what it would refuse
claude plugin test .         # tests/*.test.ts, run in the engine's own test kit
```

Type-checking (`npx tsc -p .`) needs the engine's type files in `.claude-plugin/types/`,
which Claude Code writes there the first time it loads the mod from this folder.
