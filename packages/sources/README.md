# @thetokentown/sources

Reads local AI coding usage — Claude Code, Codex CLI and Grok CLI — and emits
`DailyUsage` rows for [The Token Town](https://thetokentown.dev). One reader
interface, two adapters: Node's filesystem, and files a browser handed you.

```ts
import { createFsReader, scanClaude } from "@thetokentown/sources";

const { daily } = await scanClaude(createFsReader(), [root], { since });
```

Nothing here reads prompts, responses, code, paths or project names — only
per-day, per-model token counts. Cursor is present but `detect()` is false;
see `NOTES.md`. MIT.
