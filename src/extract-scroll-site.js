import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createWorker } from "tesseract.js";

function parseArgs(argv) {
  const defaults = {
    output: "output",
    width: 1440,
    height: 1400,
    overlap: 160,
    wait: 1200,
    gotoWaitUntil: "domcontentloaded",
    gotoTimeout: 120000,
    lang: "eng",
    maxSections: 0,
    url: "",
    profileDir: "",
    maxScrolls: 20,
    captureMode: "document",
    startAt: 0,
    headless: "true",
    browserChannel: "chromium",
    pauseBeforeCapture: 0,
    preloadScroll: "false"
  };

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, ...rest] = arg.slice(2).split("=");
    const value = rest.join("=");
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

    if (key in defaults) {
      if (
        [
          "width",
          "height",
          "overlap",
          "wait",
          "gotoTimeout",
          "maxSections",
          "maxScrolls",
          "startAt",
          "pauseBeforeCapture"
        ].includes(key)
      ) {
        defaults[key] = Number(value);
      } else {
        defaults[key] = value;
      }
    }
  }

  if (!defaults.url) {
    throw new Error("Missing required flag: --url=https://example.com/page");
  }

  if (defaults.height <= 0 || defaults.width <= 0) {
    throw new Error("Viewport width and height must be positive numbers.");
  }

  if (defaults.overlap < 0 || defaults.overlap >= defaults.height) {
    throw new Error("Overlap must be >= 0 and smaller than viewport height.");
  }

  if (!["document", "feed"].includes(defaults.captureMode)) {
    throw new Error("captureMode must be either 'document' or 'feed'.");
  }

  if (!["domcontentloaded", "load", "networkidle", "commit"].includes(defaults.gotoWaitUntil)) {
    throw new Error(
      "gotoWaitUntil must be one of: domcontentloaded, load, networkidle, commit."
    );
  }

  if (defaults.maxScrolls < 1) {
    throw new Error("maxScrolls must be at least 1.");
  }

  if (!["true", "false"].includes(defaults.headless)) {
    throw new Error("headless must be either 'true' or 'false'.");
  }

  if (!["true", "false"].includes(defaults.preloadScroll)) {
    throw new Error("preloadScroll must be either 'true' or 'false'.");
  }

  if (!["chromium", "chrome"].includes(defaults.browserChannel)) {
    throw new Error("browserChannel must be either 'chromium' or 'chrome'.");
  }

  if (defaults.pauseBeforeCapture < 0) {
    throw new Error("pauseBeforeCapture must be >= 0.");
  }

  return defaults;
}

function isEnabled(value) {
  return value === "true";
}

function slugifyUrl(url) {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
}

function dedupeLines(text) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const deduped = [];

  for (const line of lines) {
    const prev = deduped[deduped.length - 1];
    if (line !== prev) {
      deduped.push(line);
    }
  }

  return deduped.join("\n");
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function getPageMetrics(page) {
  return page.evaluate(() => {
    const body = document.body;
    const doc = document.documentElement;
    const fullHeight = Math.max(
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0,
      doc?.clientHeight ?? 0,
      doc?.scrollHeight ?? 0,
      doc?.offsetHeight ?? 0
    );

    return {
      title: document.title,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      fullHeight
    };
  });
}

async function preloadDocumentScroll(page, options, positions) {
  const startY = positions[0] ?? Math.max(0, options.startAt);
  const endY = positions[positions.length - 1] ?? startY;
  const step = options.height - options.overlap;

  console.log(
    `Preloading scroll range ${startY}-${endY}px before screenshots.`
  );

  for (let y = startY; y <= endY; y += step) {
    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
    await page.waitForTimeout(options.wait);
  }

  await page.evaluate(() => window.scrollTo(0, 0));
}

function collectDocumentPositions(metrics, options) {
  const positions = [];
  const step = options.height - options.overlap;

  for (let y = Math.max(0, options.startAt); y < metrics.fullHeight; y += step) {
    positions.push(y);
    if (options.maxSections > 0 && positions.length >= options.maxSections) {
      break;
    }
  }

  return positions;
}

async function collectFeedPositions(page, options) {
  const step = options.height - options.overlap;
  const positions = [];
  let scrollY = Math.max(0, options.startAt);
  let previousHeight = -1;
  let stablePasses = 0;

  while (positions.length < options.maxScrolls && stablePasses < 3) {
    const metrics = await getPageMetrics(page);
    const boundedY = Math.min(scrollY, Math.max(0, metrics.fullHeight - 1));

    await page.evaluate((nextY) => window.scrollTo(0, nextY), boundedY);
    await page.waitForTimeout(options.wait);

    positions.push(boundedY);

    const nextMetrics = await getPageMetrics(page);
    stablePasses =
      nextMetrics.fullHeight === previousHeight ? stablePasses + 1 : 0;
    previousHeight = nextMetrics.fullHeight;
    scrollY += step;

    if (boundedY + options.height >= nextMetrics.fullHeight && stablePasses >= 1) {
      break;
    }
  }

  return [...new Set(positions)];
}

async function createPage(browser, options) {
  if (options.profileDir) {
    const context = await chromium.launchPersistentContext(
      path.resolve(options.profileDir),
      {
        headless: isEnabled(options.headless),
        channel: options.browserChannel === "chrome" ? "chrome" : undefined,
        viewport: { width: options.width, height: options.height },
        deviceScaleFactor: 2,
        args: ["--disable-setuid-sandbox", "--disable-gpu"]
      }
    );

    return {
      context,
      page: context.pages()[0] ?? (await context.newPage())
    };
  }

  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: 2
  });

  return {
    context,
    page: await context.newPage()
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const outputRoot = path.resolve(options.output, slugifyUrl(options.url));
  const screenshotsDir = path.join(outputRoot, "screenshots");
  const isHeadless = isEnabled(options.headless);

  await ensureDir(screenshotsDir);

  const browser = options.profileDir
    ? null
    : await chromium.launch({
        headless: isHeadless,
        channel: options.browserChannel === "chrome" ? "chrome" : undefined,
        args: ["--disable-setuid-sandbox", "--disable-gpu"]
      });
  const { context, page } = await createPage(browser, options);

  const worker = await createWorker(options.lang);
  const sections = [];

  try {
    await page.goto(options.url, {
      waitUntil: options.gotoWaitUntil,
      timeout: options.gotoTimeout
    });

    if (options.pauseBeforeCapture > 0) {
      console.log(
        `Page opened in a fresh ${options.browserChannel} session. Waiting ${options.pauseBeforeCapture}ms before capture.`
      );
      await page.waitForTimeout(options.pauseBeforeCapture);
    }

    let positions = [];

    if (options.captureMode === "feed") {
      positions = await collectFeedPositions(page, options);
    } else {
      const metrics = await getPageMetrics(page);
      positions = collectDocumentPositions(metrics, options);

      console.log(
        `Planned ${positions.length} document section(s) from ${metrics.fullHeight}px page height.`
      );

      if (isEnabled(options.preloadScroll)) {
        await preloadDocumentScroll(page, options, positions);
      }
    }

    const metrics = await getPageMetrics(page);

    for (let index = 0; index < positions.length; index += 1) {
      const y = positions[index];
      const screenshotPath = path.join(
        screenshotsDir,
        `section-${String(index + 1).padStart(3, "0")}.png`
      );

      await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
      await page.waitForTimeout(options.wait);
      await page.screenshot({
        path: screenshotPath,
        type: "png"
      });

      const {
        data: { text, confidence }
      } = await worker.recognize(screenshotPath);

      sections.push({
        index: index + 1,
        scrollY: y,
        screenshot: path.relative(outputRoot, screenshotPath),
        confidence,
        text: text.trim()
      });

      console.log(
        `Processed section ${index + 1}/${positions.length} at scrollY=${y}`
      );
    }

    const combinedText = dedupeLines(
      sections.map((section) => section.text).filter(Boolean).join("\n\n")
    );

    await fs.writeFile(
      path.join(outputRoot, "meta.json"),
      JSON.stringify(
        {
          url: options.url,
          title: metrics.title,
          pageHeight: metrics.fullHeight,
          viewport: {
            width: metrics.viewportWidth,
            height: metrics.viewportHeight
          },
          options,
          sections: sections.length
        },
        null,
        2
      )
    );

    await fs.writeFile(
      path.join(outputRoot, "ocr.json"),
      JSON.stringify(sections, null, 2)
    );
    await fs.writeFile(path.join(outputRoot, "ocr.txt"), combinedText);

    console.log(`Saved OCR results to ${outputRoot}`);
  } finally {
    await worker.terminate();
    await context.close();
    if (browser) {
      await browser.close();
    }
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
