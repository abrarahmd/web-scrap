# Scrollable Website OCR Extractor

This project visits a long web page, scrolls through it in viewport-sized slices, takes a screenshot for each slice, runs OCR on every screenshot, and writes the extracted content to disk.

## What it saves

- `output/<slug>/screenshots/section-XXX.png`: each viewport screenshot
- `output/<slug>/ocr.json`: OCR text and metadata per screenshot
- `output/<slug>/ocr.txt`: combined cleaned OCR text
- `output/<slug>/meta.json`: run configuration and page metrics

## Setup

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
npm run extract -- --url="https://example.com/very-long-page"
```

Optional flags:

```bash
--output=output
--width=1440
--height=1400
--overlap=160
--wait=1200
--goto-wait-until=domcontentloaded
--goto-timeout=120000
--lang=eng
--max-sections=0
--capture-mode=document
--profile-dir=./profiles/default
--max-scrolls=20
--start-at=0
--headless=false
--browser-channel=chrome
--pause-before-capture=5000
--preload-scroll=false
```

Notes:

- `overlap` helps avoid cutting text between screenshots.
- `max-sections=0` means no limit.
- `goto-wait-until` controls Playwright's page load condition. `domcontentloaded` is the safest default for modern sites.
- `goto-timeout` controls how long the initial page navigation can take.
- `capture-mode=feed` is better for infinite-scroll or dynamically loaded feeds.
- `profile-dir` lets you reuse a browser profile for sites that require login.
- Without `profile-dir`, Playwright uses a fresh isolated browser context, which behaves like an incognito session.
- `headless=false` opens a visible browser window.
- `browser-channel=chrome` uses your installed Google Chrome instead of Playwright's bundled Chromium.
- `pause-before-capture` gives you a short visible delay after navigation before screenshots begin.
- `preload-scroll=true` scrolls through the planned document range before screenshots, which can help lazy-loaded pages but is slower.
- `max-scrolls` limits how many feed positions will be captured.
- OCR quality depends on the page design, font size, and image sharpness.

## Visible incognito-style capture

For a visible fresh session in Chrome, use:

```bash
npm run extract -- --url="https://example.com" --headless=false --browser-channel=chrome --pause-before-capture=5000
```

Notes:

- This opens a new automated Chrome window in an isolated context.
- If you also pass `profile-dir`, the run will use that saved profile instead of an incognito-style fresh session.
- A true incognito session cannot reuse your logged-in profile at the same time.

## Feed-style pages

For Facebook-like pages, use:

```bash
npm run extract -- --url="https://www.facebook.com/" --capture-mode=feed --profile-dir=./profiles/facebook --max-scrolls=15 --wait=2000
```

Important:

- This only captures content that is visible in your logged-in browser session.
- It does not bypass login, privacy controls, or platform restrictions.
- Feed pages are noisier than articles, so OCR text will include UI labels and repeated chrome.

## Modern public sites

For sites that keep background network requests alive, prefer:

```bash
npm run extract -- --url="https://openai.com/research/index/" --capture-mode=document --goto-wait-until=domcontentloaded --wait=2000
```
