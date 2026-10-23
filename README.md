# Stickers

Add sticky notes to files, for Claude Code. 
When Claude reads, edits or writes a file, the stickers on that file are shown to it automatically, so that the agent does not miss important gotchas or lessons related to that file.
The agent does not need to remember manually looking up related knowledge stored separately.

## How it works

A sticker is a markdown file (any name) in a `.stickers/` folder, starting with a header that names the file or files it is stuck on:

```markdown
---
on: src/auth/session.py, src/auth/tokens.py
---
Do NOT reorder the imports. tokens.py monkey-patches time.time() on import; if session.py loads first, every token is issued in 1970 and expires instantly, but only in production, because tests mock the clock.
```

- **Writing:** Claude (or you) creates, edits and deletes stickers like any other file.
  There is no special tool. A short section in Claude's system prompt says what stickers
  are and how to write one; subagents get the same text appended to their task.
- **Recall:** The first time Claude reads, edits or writes a noted file like `src/auth/session.py`, it automatically sees:

  ```
  Stickers on src/auth/session.py (1):
  - .stickers/import-order.md (edited 2 h ago; also on src/auth/tokens.py)
    Do NOT reorder the imports. tokens.py monkey-patches time.time() on import; if session.py loads first, every token is issued in 1970 and expires instantly, but only in production, because tests mock the clock.
  ```

  Later reads do not see the same note repeated, instead: `Stickers on src/auth/session.py: 1, unchanged
  since shown.` Past 4,000 characters only the sticker paths are listed.
- **Each agent separately:** the main conversation and every subagent each sees a file's stickers in full the first time it opens it. Touching the files after a `/compact` or `/clear` will show the stickers again.

## Where stickers live

| Folder | What it's for | `on:` paths are |
|---|---|---|
| `.stickers/` in project root or any folder | Notes that belong with the project or folder | Relative to the folder holding that `.stickers/` |
| `~/.claude/stickers/` | Personal notes, kept out of every project, or notes on files outside any project | Absolute, or starting with `~/`; relative paths are ignored |

- **Lookup:** a file's stickers come from the `.stickers/` in its own folder and in every folder above it, plus `~/.claude/stickers/`.

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

Type-checking (`npx tsc -p .`) works once Claude Code has loaded the mod from this folder at
least once; loading it generates the type files in `.claude-plugin/types/`.
