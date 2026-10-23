---
name: add-sticker
description: Stickers are notes stuck on files. When you Read, Edit or Write a file, its stickers are shown to you automatically. Attach stickers to a file when there is important gotchas or easy-to-miss facts about the file that other agents should know. Use this skill for writing, editing or deleting a sticker.
---

# Writing a sticker

A sticker is a markdown file (any name, ending in `.md`) that starts with a header naming the
file or files it is stuck on:

```markdown
---
on: src/auth/session.py, src/auth/tokens.py
---
Do NOT reorder the imports, otherwise production server breaks for unknown reason.
```

Write, edit and delete stickers with your normal file tools. There is no special tool. Give
the file a name that says what the note is about (`import-order.md`), so it reads well in a
folder listing.

## Where to put it

| Folder | For | `on:` paths are |
|---|---|---|
| `.stickers/` at the project root | Notes that belong with the project | Relative to the project root |
| `.stickers/` in a subfolder (e.g. a package) | Notes that belong with that subfolder | Relative to that subfolder |
| `~/.claude/stickers/` | Personal notes kept out of every project, or notes on files outside any project | Absolute, or starting with `~/` |

`on:` can name several files, separated by commas; the sticker is shown on each of them.

## Editing and deleting

Stickers are shown to you with their own path, so you can work on them directly:

- To change a note, Edit the sticker file.
- To move a note to other files, change its `on:` line.
- To remove a note, delete the sticker file.
