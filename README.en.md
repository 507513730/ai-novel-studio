# AI-Novel-Studio · AI Novel Studio

**English** | [中文](README.md)

<!-- v0.24.3：English README（docs/ 文档为中文，见各文档内说明） -->
![Release](https://img.shields.io/github/v/release/507513730/ai-novel-studio?label=Release)
![CI](https://img.shields.io/github/actions/workflow/status/507513730/ai-novel-studio/release-readiness.yml?branch=main&label=CI)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows-8A2BE2)

An **AI director-style novel production system** (Electron desktop app): from a single spark of inspiration all the way to a complete long-form novel — planning, generation, review, fixing and state backfill in one pipeline.

<p align="center">
  <img src="docs/images/novel-list.png" alt="Book list (cards + sidebar navigation)" width="720" />
  <br />
  <em>Book library · Sidebar navigation · Themed dark UI</em>
  <br /><br />
  <img src="docs/images/chapter-workbench.png" alt="Chapter workbench (editor + full-text search + actions)" width="720" />
  <br />
  <em>Chapter execution · In-book full-text search · Reading mode · Solution pipelines · Review/backfill loop</em>
</p>

## Why use it?

The biggest enemy of long-form writing is **continuity**: over hundreds of thousands of characters, characters must stay in character, foreshadowing must be paid off, and style must stay consistent. AI-Novel-Studio turns "writing a book" into a manageable production chain — an AI director plans the whole book, chapter-level generate/review/fix loops run continuously, and state backfill keeps the whole manuscript consistent. You can also import Feelfish agent packs and turn them into your own writing pipelines.

## Core features

- **Auto director**: 11-stage whole-book chain (inspiration → direction → setup → macro → world → characters → volumes → beats → chapters → refine → ready), auto/supervised modes, checkpoint resume; watchdog and cancel awareness
- **Creative workshop**: one sentence → AI generates a production solution (agent pipeline); visual editing / trial runs / saving; supports importing Feelfish agent definitions and solutions; skill system + agent assetization
- **Chapter execution chain**: generate (SSE streaming + guidance box) → AI review → fix (patch-first) → state backfill; version history with view/restore/**diff**, 30-second autosave, anti-AI-tone rewriting
- **Reading & search (v0.24.2)**: clean reading/review mode (.prose typography, adjustable font size, prev/next chapter); in-book full-text search (chapters/characters/world/foreshadow/facts/knowledge base grouped); one-click whole-book production bound to a solution (job queue, per-chapter agent pipeline)
- **Solution production pipeline**: bind a solution at book level, then batch-produce every chapter through agent relay (outline → fragments → review → final merge); Feelfish mc-good2.0 (10 agents) verified end-to-end
- **Unified asset library**: knowledge base / world templates / story modes / style engine / genres / anti-AI rules / title workshop / base characters / book analysis — upload files (TXT/MD/EPUB auto-split) + paste text + AI extraction draft → human edit → save
- **Task center**: background jobs with progress; failed jobs can retry with a model override or resume from checkpoint
- **Model routing**: per-task model assignment + provider fallback + cost dashboard (cache hit rate + quality-debt tracking)
- **OpenCode Go gateway**: one-click import of subscription credentials, aggregating DeepSeek/GLM/GPT/Grok/Kimi and more
- **Themes & typography**: 7 UI themes (incl. sepia literary style); 3 bundled open-source fonts + 5 system fonts; first-line indent, line height, font size and reading width adjustable

## Getting started

[📖 Tutorial (4 steps, Chinese)](docs/getting-started.md) · [📦 Download latest](https://github.com/507513730/ai-novel-studio/releases/latest)

1. Install the app (Windows installer or portable)
2. Settings → import model credentials (OpenCode Go or DeepSeek etc.)
3. Create a novel, type one line of inspiration → the AI director plans the whole book
4. Generate chapter text in the chapter page, let AI review and fix, export TXT/MD/EPUB

## Tech stack

Electron 43 + React 19 + TypeScript + Vite 7 + Express 5 + node:sqlite (zero native deps) + CodeMirror 6

## Development

```powershell
pnpm install
pnpm dev            # dev (electron-vite, three processes)
pnpm typecheck      # type check
pnpm lint           # ESLint
pnpm test           # vitest unit tests (count = what pnpm test reports)
pnpm db:smoke       # database smoke test (7 checks)
pnpm release        # release flow (docs checks / verification / local build / push; --push semi-auto)
pnpm dist           # package NSIS installer + portable
```

## Data & uninstall

- Data lives in `%APPDATA%\ai-novel-studio` (separate from install dir; portable version keeps `data/` next to the executable)
- Settings → Appearance → Data & uninstall: open data dir / export backup / restore backup / wipe all data

## Releases

Pushing a version tag (e.g. `v0.24.2`) auto-builds and publishes a GitHub Release. Versioning rules: see [docs/versioning.md](docs/versioning.md) (SemVer + CI-enforced tag==version).

## Documentation

> Note: docs/ are maintained in Chinese (see each file).

- [📖 Getting started (Chinese)](docs/getting-started.md)
- [docs/README.md](docs/README.md): full doc index (architecture / changelog / decisions / versioning / audit / test reports)
- [docs/CHANGELOG.md](docs/CHANGELOG.md): release notes (Keep a Changelog)
- [PLAN.md](PLAN.md): current plan (positioning/progress/backlog); historical chronicle in [docs/archive/PLAN-history.md](docs/archive/PLAN-history.md)

## Project layout

```
client/src/    React renderer (pages/ workspace/ components/ editor/ utils/)
server/src/    service layer (routes/ services/ db/ prompts/)
electron/      main process (window/menu/utilityProcess/security)
shared/        shared front/back types
scripts/       release / calibration / e2e / docs checks
docs/          architecture / changelog / decisions / versioning / audit
```

## Testing

- `pnpm test`: vitest unit tests (patches/director/SSE abort/cost estimation/model override/world rendering/solution assets/guidance/constraints/memory/review regression/word counting/version diff/full-text search, 178+)
- `node scripts/e2e/round.mjs <n>`: full-feature e2e (T1 config / T2 creation chain / T3 assets / T4 director / T5 feature regression)
- `node scripts/check-docs.mjs`: docs health check (mojibake + broken relative links) — enforced by CI

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md): bug/feature issues (with templates), Conventional Commits + PR flow, full local verification commands. The open repo is maintained bilingually at the README level; issue templates and docs/ are currently Chinese-first.

## Help

- **Issues/Bugs/Requests**: [new issue](https://github.com/507513730/ai-novel-studio/issues/new/choose)
- **Security**: see [SECURITY.md](SECURITY.md) (private disclosure, do not open a public issue)
- **Community conduct**: see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## FAQ

**Is it paid?** The app itself is free and open source (MIT). AI generation consumes your own model provider quota (OpenCode Go subscription / DeepSeek pay-as-you-go etc.).

**Which models are supported?** Any OpenAI-compatible API: DeepSeek, GLM, GPT, Grok, Kimi, etc. (multi-provider + per-task routing + fallback).

**Where is my data stored?** Fully local SQLite, nothing uploaded; API keys are encrypted with the OS keyring.

**Can I import Feelfish solutions?** Yes — the creative workshop imports Feelfish agents (.md) and solutions (solution.json); bound to chapter production afterwards.

## License

[MIT](LICENSE) © 2026 ai-novel-studio
