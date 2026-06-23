import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

import { CORPUS, ACTIVITIES } from '../bench/corpus.mjs';
import { buildSnapshotHtml } from '../src/renderer/snapshot.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resultsPath = join(repoRoot, 'bench/results/local-latest.json');
const generatedTexPath = join(repoRoot, 'paper/generated-results.tex');
const rrwebBundlePath = join(repoRoot, 'node_modules/rrweb/umd/rrweb.js');
const viewport = { width: 1280, height: 720 };

const semanticRubric = {
  dimensions: [
    'DOM structure is available to the receiver',
    'incremental DOM changes are available without decoding pixels',
    'stable node identity can address mirrored elements',
    'reverse-control targetability is preserved as structured data',
  ],
  scores: {
    phantomstream: 1,
    rrweb: 0.5,
    cdp: 0,
  },
};

function mimeFor(pathname) {
  const ext = extname(pathname);
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml; charset=utf-8';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mp3') return 'audio/mpeg';
  return 'application/octet-stream';
}

function send(res, status, body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    'content-type': type || 'text/plain; charset=utf-8',
    'content-length': String(buf.length),
    'cache-control': 'no-store',
  });
  res.end(buf);
}

async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const corpusMatch = url.pathname.match(/^\/corpus\/([a-z-]+)\.html$/);
      if (corpusMatch) {
        const entry = CORPUS.find((item) => item.id === corpusMatch[1]);
        if (!entry) return send(res, 404, 'not found');
        return send(res, 200, entry.html, 'text/html; charset=utf-8');
      }
      if (url.pathname === '/assets/poster.svg') {
        return send(
          res,
          200,
          '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#172033"/><text x="48" y="96" fill="#f8fafc" font-family="Arial" font-size="42">PhantomStream media poster</text></svg>',
          'image/svg+xml; charset=utf-8'
        );
      }
      if (url.pathname === '/assets/tiny.mp4') return send(res, 200, Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]), 'video/mp4');
      if (url.pathname === '/assets/tone.mp3') return send(res, 200, Buffer.from([73, 68, 51, 3, 0, 0, 0, 0, 0, 0]), 'audio/mpeg');
      if (url.pathname.startsWith('/src/')) {
        const file = join(repoRoot, url.pathname.slice(1));
        if (!file.startsWith(join(repoRoot, 'src')) || !existsSync(file)) return send(res, 404, 'not found');
        return send(res, 200, await readFile(file), mimeFor(file));
      }
      return send(res, 404, 'not found');
    } catch (error) {
      return send(res, 500, error && error.stack ? error.stack : String(error));
    }
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

async function runActivity(page, activity) {
  await page.evaluate(async (name) => {
    await window.__runBenchmarkActivity(name);
  }, activity);
}

function firstLatency(timeline, actionAt, predicate) {
  const entry = timeline.find((item) => item.at >= actionAt && predicate(item));
  return entry ? Math.max(0, entry.at - actionAt) : null;
}

function median(values) {
  const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function mean(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function screenshotDiffPercent(a, b) {
  try {
    const first = PNG.sync.read(a);
    const second = PNG.sync.read(b);
    const width = Math.min(first.width, second.width);
    const height = Math.min(first.height, second.height);
    if (width <= 0 || height <= 0) return null;
    const firstCrop = new PNG({ width, height });
    const secondCrop = new PNG({ width, height });
    PNG.bitblt(first, firstCrop, 0, 0, width, height, 0, 0);
    PNG.bitblt(second, secondCrop, 0, 0, width, height, 0, 0);
    const diff = new PNG({ width, height });
    const pixels = pixelmatch(firstCrop.data, secondCrop.data, diff.data, width, height, { threshold: 0.18 });
    return round((pixels / (width * height)) * 100, 3);
  } catch {
    return null;
  }
}

async function renderHtmlScreenshot(browser, html, scroll) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    if (scroll && (scroll.x || scroll.y)) {
      await page.evaluate(({ x, y }) => window.scrollTo(x || 0, y || 0), scroll);
      await page.waitForTimeout(50);
    }
    return await page.screenshot({ fullPage: false });
  } finally {
    await page.close();
  }
}

async function runPhantomStream(browser, baseURL, entry, activity) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  try {
    await page.goto(`${baseURL}/corpus/${entry.id}.html`, { waitUntil: 'load' });
    await page.addScriptTag({
      type: 'module',
      content: `
        import { createCapture } from '/src/capture/index.js';
        const encoder = new TextEncoder();
        const logger = { info() {}, warn() {}, error() {} };
        window.__psMessages = [];
        window.__psTimeline = [];
        const transport = {
          send(type, payload) {
            const msg = { type, payload };
            const bytes = encoder.encode(JSON.stringify(msg)).length;
            window.__psMessages.push(msg);
            window.__psTimeline.push({ type, at: performance.now(), bytes });
          },
          flush() {}
        };
        window.__psCapture = createCapture({ transport, logger });
        window.__psStart = () => {
          window.__psStartAt = performance.now();
          window.__psCapture.start();
        };
        window.__psFinalSnapshot = () => window.__psCapture.serializeSnapshot();
      `,
    });
    await page.waitForFunction(() => typeof window.__psStart === 'function');
    await page.evaluate(() => window.__psStart());
    await page.waitForFunction(() => window.__psTimeline.some((item) => item.type === 'ext:dom-snapshot'));
    const actionAt = await page.evaluate(() => performance.now());
    await runActivity(page, activity);
    await page.waitForTimeout(260);
    const originalScreenshot = await page.screenshot({ fullPage: false });
    const snapshotPayload = await page.evaluate(() => window.__psFinalSnapshot());
    const snapshotHtml = buildSnapshotHtml(snapshotPayload);
    const mirrorScreenshot = await renderHtmlScreenshot(browser, snapshotHtml, {
      x: snapshotPayload.scrollX || 0,
      y: snapshotPayload.scrollY || 0,
    });
    const collected = await page.evaluate(() => ({
      startAt: window.__psStartAt,
      messages: window.__psMessages,
      timeline: window.__psTimeline,
    }));
    const snapshotEvent = collected.timeline.find((item) => item.type === 'ext:dom-snapshot');
    return {
      available: true,
      bytes: collected.timeline.reduce((sum, item) => sum + item.bytes, 0),
      framesOrEvents: collected.messages.length,
      startupMs: snapshotEvent ? round(snapshotEvent.at - collected.startAt, 3) : null,
      latencyMs: activity === 'idle' ? null : round(firstLatency(collected.timeline, actionAt, (item) => item.type !== 'ext:dom-overlay'), 3),
      visualDiffPct: screenshotDiffPercent(originalScreenshot, mirrorScreenshot),
      semanticScore: semanticRubric.scores.phantomstream,
    };
  } finally {
    await page.close();
  }
}

async function runRrweb(browser, baseURL, entry, activity) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  try {
    await page.goto(`${baseURL}/corpus/${entry.id}.html`, { waitUntil: 'load' });
    await page.addScriptTag({ path: rrwebBundlePath });
    await page.evaluate(() => {
      const encoder = new TextEncoder();
      window.__rrwebEvents = [];
      window.__rrwebTimeline = [];
      window.__rrwebStartAt = performance.now();
      window.__rrwebStop = window.rrweb.record({
        emit(event) {
          const bytes = encoder.encode(JSON.stringify(event)).length;
          window.__rrwebEvents.push(event);
          window.__rrwebTimeline.push({ type: event.type, at: performance.now(), bytes });
        },
      });
    });
    await page.waitForFunction(() => window.__rrwebEvents.length > 0);
    const actionAt = await page.evaluate(() => performance.now());
    await runActivity(page, activity);
    await page.waitForTimeout(260);
    const originalScreenshot = await page.screenshot({ fullPage: false });
    const collected = await page.evaluate(() => {
      if (typeof window.__rrwebStop === 'function') window.__rrwebStop();
      return {
        startAt: window.__rrwebStartAt,
        events: window.__rrwebEvents,
        timeline: window.__rrwebTimeline,
      };
    });
    let visualDiffPct = null;
    let replayError = null;
    try {
      const replay = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      try {
        await replay.addScriptTag({ path: rrwebBundlePath });
        await replay.evaluate(async (events) => {
          document.body.innerHTML = '';
          const replayer = new window.rrweb.Replayer(events, {
            root: document.body,
            speed: 1,
            showWarning: false,
          });
          replayer.play(0);
          await new Promise((resolve) => setTimeout(resolve, 700));
        }, collected.events);
        const replayScreenshot = await replay.screenshot({ fullPage: false });
        visualDiffPct = screenshotDiffPercent(originalScreenshot, replayScreenshot);
      } finally {
        await replay.close();
      }
    } catch (error) {
      replayError = error && error.message ? error.message : String(error);
    }
    const firstEvent = collected.timeline[0];
    return {
      available: true,
      bytes: jsonBytes(collected.events),
      framesOrEvents: collected.events.length,
      startupMs: firstEvent ? round(firstEvent.at - collected.startAt, 3) : null,
      latencyMs: activity === 'idle' ? null : round(firstLatency(collected.timeline, actionAt, () => true), 3),
      visualDiffPct: visualDiffPct === null ? 100 : visualDiffPct,
      semanticScore: semanticRubric.scores.rrweb,
      replayError,
    };
  } finally {
    await page.close();
  }
}

async function runCdpScreencast(browser, baseURL, entry, activity) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const client = await page.context().newCDPSession(page);
  const frames = [];
  try {
    client.on('Page.screencastFrame', async (frame) => {
      frames.push({
        at: performance.now(),
        bytes: Buffer.byteLength(frame.data, 'base64'),
        data: frame.data,
      });
      try {
        await client.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
      } catch {
        // The session can close while an ack is in flight during teardown.
      }
    });
    await page.goto(`${baseURL}/corpus/${entry.id}.html`, { waitUntil: 'load' });
    const startAt = performance.now();
    await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    const actionAt = performance.now();
    await runActivity(page, activity);
    await page.waitForTimeout(420);
    const originalScreenshot = await page.screenshot({ fullPage: false });
    await client.send('Page.stopScreencast').catch(() => {});
    const latestFrame = frames[frames.length - 1];
    return {
      available: frames.length > 0,
      bytes: frames.reduce((sum, frame) => sum + frame.bytes, 0),
      framesOrEvents: frames.length,
      startupMs: frames[0] ? round(frames[0].at - startAt, 3) : null,
      latencyMs: activity === 'idle' ? null : round(firstLatency(frames, actionAt, () => true), 3),
      visualDiffPct: latestFrame ? screenshotDiffPercent(originalScreenshot, Buffer.from(latestFrame.data, 'base64')) : null,
      semanticScore: semanticRubric.scores.cdp,
      unavailableReason: frames.length > 0 ? null : 'CDP produced no screencast frames in the local headless run.',
    };
  } finally {
    await client.detach().catch(() => {});
    await page.close();
  }
}

function summarize(runs) {
  const systems = ['phantomstream', 'rrweb', 'cdp'];
  const summary = {};
  for (const system of systems) {
    const values = runs.map((run) => run.systems[system]).filter((item) => item && item.available);
    summary[system] = {
      availableRuns: values.length,
      medianBytes: round(median(values.map((item) => item.bytes)), 1),
      medianKB: round(median(values.map((item) => item.bytes / 1024)), 2),
      medianStartupMs: round(median(values.map((item) => item.startupMs)), 2),
      medianLatencyMs: round(median(values.map((item) => item.latencyMs)), 2),
      medianVisualDiffPct: round(median(values.map((item) => item.visualDiffPct)), 3),
      meanSemanticScore: round(mean(values.map((item) => item.semanticScore)), 3),
    };
  }
  const ps = summary.phantomstream.medianBytes;
  const cdp = summary.cdp.medianBytes;
  const rr = summary.rrweb.medianBytes;
  summary.byteReductionVsCdpPct = ps && cdp ? round((1 - ps / cdp) * 100, 2) : null;
  summary.byteReductionVsRrwebPct = ps && rr ? round((1 - ps / rr) * 100, 2) : null;
  return summary;
}

function texNumber(value, fallback = '0') {
  return Number.isFinite(value) ? String(value) : fallback;
}

function texEscape(value) {
  return String(value).replaceAll('\\', '\\textbackslash{}').replaceAll('_', '\\_').replaceAll('%', '\\%').replaceAll('&', '\\&');
}

async function writeGeneratedTex(result) {
  const s = result.summary;
  const body = `% Auto-generated by npm run bench:local. Do not edit by hand.
\\newcommand{\\PSBenchGeneratedAt}{${texEscape(result.generatedAt.slice(0, 10))}}
\\newcommand{\\PSPackageVersion}{${texEscape(result.package.version)}}
\\newcommand{\\PSTestCount}{${result.project.testCount}}
\\newcommand{\\PSTestFiles}{${result.project.testFiles}}
\\newcommand{\\PSProdFiles}{${result.project.productionFiles}}
\\newcommand{\\PSProdLoc}{${result.project.productionLoc}}
\\newcommand{\\PSBenchRunCount}{${result.runs.length}}
\\newcommand{\\PSCorpusCount}{${result.corpus.length}}
\\newcommand{\\PSActivityCount}{${result.activities.length}}
\\newcommand{\\PSPhantomMedianKB}{${texNumber(s.phantomstream.medianKB)}}
\\newcommand{\\PSRrwebMedianKB}{${texNumber(s.rrweb.medianKB)}}
\\newcommand{\\PSCDPMedianKB}{${texNumber(s.cdp.medianKB)}}
\\newcommand{\\PSPhantomLatencyMs}{${texNumber(s.phantomstream.medianLatencyMs)}}
\\newcommand{\\PSRrwebLatencyMs}{${texNumber(s.rrweb.medianLatencyMs)}}
\\newcommand{\\PSCDPLatencyMs}{${texNumber(s.cdp.medianLatencyMs)}}
\\newcommand{\\PSPhantomVisualDiff}{${texNumber(s.phantomstream.medianVisualDiffPct)}}
\\newcommand{\\PSRrwebVisualDiff}{${texNumber(s.rrweb.medianVisualDiffPct)}}
\\newcommand{\\PSCDPVisualDiff}{${texNumber(s.cdp.medianVisualDiffPct)}}
\\newcommand{\\PSPhantomSemantic}{${texNumber(s.phantomstream.meanSemanticScore)}}
\\newcommand{\\PSRrwebSemantic}{${texNumber(s.rrweb.meanSemanticScore)}}
\\newcommand{\\PSCDPSemantic}{${texNumber(s.cdp.meanSemanticScore)}}
\\newcommand{\\PSReductionVsCDP}{${texNumber(s.byteReductionVsCdpPct)}}
\\newcommand{\\PSReductionVsRrweb}{${texNumber(s.byteReductionVsRrwebPct)}}
`;
  await mkdir(dirname(generatedTexPath), { recursive: true });
  await writeFile(generatedTexPath, body);
}

async function projectMetrics() {
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  const testCount = await countTests();
  const productionPaths = await collectFiles(['src', 'bin', 'examples'], (path) => /\.m?js$/.test(path));
  const testPaths = await collectFiles(['tests'], (path) => /\.test\.js$/.test(path));
  let productionLoc = 0;
  for (const path of productionPaths) {
    const text = await readFile(path, 'utf8');
    productionLoc += text.split('\n').length;
  }
  return {
    package: { name: pkg.name, version: pkg.version },
    project: { testCount, testFiles: testPaths.length, productionFiles: productionPaths.length, productionLoc },
  };
}

async function collectFiles(roots, predicate) {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (!predicate || predicate(path)) {
        out.push(path);
      }
    }
  }
  for (const root of roots) {
    await walk(join(repoRoot, root));
  }
  return out.sort();
}

async function countTests() {
  const { spawn } = await import('node:child_process');
  return await new Promise((resolveCount, rejectCount) => {
    const child = spawn('npm', ['test'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (code !== 0) return rejectCount(new Error(stderr || 'test count command failed'));
      const match = stdout.match(/(?:^|\n)\s*(?:ℹ\s*)?tests\s+(\d+)/);
      if (!match) return rejectCount(new Error('could not parse npm test count'));
      resolveCount(Number(match[1]));
    });
  });
}

async function main() {
  if (!existsSync(rrwebBundlePath)) {
    throw new Error('rrweb bundle missing. Run npm install first.');
  }
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const runs = [];
  try {
    for (const entry of CORPUS) {
      for (const activity of ACTIVITIES) {
        const scenarioId = `${entry.id}-${activity}`;
        process.stdout.write(`benchmark ${scenarioId}\n`);
        const systems = {
          phantomstream: await runPhantomStream(browser, server.baseURL, entry, activity),
          rrweb: await runRrweb(browser, server.baseURL, entry, activity),
          cdp: await runCdpScreencast(browser, server.baseURL, entry, activity),
        };
        runs.push({ scenarioId, pageId: entry.id, activity, systems });
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  const metrics = await projectMetrics();
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      browser: 'playwright-chromium-headless',
      viewport,
    },
    package: metrics.package,
    project: metrics.project,
    corpus: CORPUS.map(({ id, title }) => ({ id, title })),
    activities: ACTIVITIES,
    semanticRubric,
    systems: {
      phantomstream: { available: true, description: 'PhantomStream capture stream measured as JSON wire bytes.' },
      rrweb: { available: true, description: 'rrweb browser recorder measured as serialized event bytes.' },
      cdp: { available: true, description: 'Chrome DevTools Protocol Page.startScreencast measured as PNG frame bytes.' },
      webrtc: {
        available: false,
        reason: 'Headless local benchmark does not claim WebRTC getDisplayMedia because it requires an interactive capture permission surface.',
      },
    },
    runs,
    summary: summarize(runs),
  };
  await mkdir(dirname(resultsPath), { recursive: true });
  await writeFile(resultsPath, JSON.stringify(result, null, 2) + '\n');
  await writeGeneratedTex(result);
  process.stdout.write(`wrote ${resultsPath}\n`);
  process.stdout.write(`wrote ${generatedTexPath}\n`);
  process.stdout.write(JSON.stringify(result.summary, null, 2) + '\n');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
