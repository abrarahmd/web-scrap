# Repository Guidelines

## Project Overview

This is a Node.js ESM CLI for capturing long or scroll-loaded web pages and OCRing them. The main entrypoint is `src/extract-scroll-site.js`.

The CLI:

- launches Playwright Chromium or Chrome,
- captures viewport-sized screenshots while scrolling,
- runs OCR with `tesseract.js`,
- writes results under `output/<slug>/`.

Expected generated outputs are:

- `output/<slug>/screenshots/section-XXX.png`
- `output/<slug>/ocr.json`
- `output/<slug>/ocr.txt`
- `output/<slug>/meta.json`

## Commands

- Install dependencies: `npm install`
- Install the browser runtime: `npx playwright install chromium`
- Run extraction:
  `npm run extract -- --url="https://example.com/very-long-page"`

Useful flags are documented in `README.md`. Common modes:

- Long public document:
  `npm run extract -- --url="https://example.com" --capture-mode=document`
- Infinite/feed-like page:
  `npm run extract -- --url="https://example.com" --capture-mode=feed --max-scrolls=15`
- Visible Chrome session:
  `npm run extract -- --url="https://example.com" --headless=false --browser-channel=chrome --pause-before-capture=5000`

There is currently no dedicated test or lint script in `package.json`.

## Code Style

- Use ESM syntax (`import`/`export`) and Node built-ins with `node:` prefixes.
- Keep the CLI dependency-light and prefer Playwright/Tesseract APIs over ad hoc browser or OCR workarounds.
- Keep options in `parseArgs` explicit and validated. If adding a flag, update `README.md` too.
- Prefer small pure helpers for parsing, path handling, deduping, and scroll-position logic.
- Generated artifacts belong in `output/`, which is ignored.

## Git And Workspace Notes

- The worktree may show many deleted files under `profiles/facebook/Default/...`. Treat these as pre-existing user/workspace state unless the user asks to clean or restore them.
- Browser profile directories can contain cookies, local storage, and cache data. Do not inspect or expose sensitive profile contents unless the user explicitly asks and it is necessary.
- `node_modules/`, `output/`, and `playwright-report/` are ignored. Avoid committing generated OCR screenshots or browser/runtime outputs.

## Verification

For code changes, at minimum run a syntax check:

```bash
node --check src/extract-scroll-site.js
```

For behavior changes, run a small extraction against a simple public URL when network/browser access is available, using a bounded capture such as:

```bash
npm run extract -- --url="https://example.com" --max-sections=1
```
