export const ACTIVITIES = ['idle', 'reading', 'agent'];

function paragraph(i) {
  return `<p>Deterministic article paragraph ${i}. PhantomStream mirrors structured DOM state, stable node identity, style data, and small live diffs instead of repeated raster frames. The text is intentionally repetitive so every benchmark run has the same layout pressure.</p>`;
}

function feedItem(i) {
  return `<article class="feed-card" data-item="${i}"><h3>Queue item ${i}</h3><p>Status update ${i}: a browser agent changed a real page and the observer emitted a bounded mutation.</p><button>Inspect</button></article>`;
}

function metricCard(label, value) {
  return `<section class="metric"><span>${label}</span><strong>${value}</strong><div class="bar" style="--w:${value % 100}%"></div></section>`;
}

const baseStyle = `
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body { margin: 0; background: #f8fafc; color: #172033; }
  main { width: min(1040px, calc(100vw - 48px)); margin: 24px auto 96px; }
  h1 { font-size: 38px; line-height: 1.05; margin: 0 0 16px; }
  h2 { margin-top: 28px; }
  p { line-height: 1.55; }
  .hero, .panel, .feed-card, .metric, .media-shell { border: 1px solid #cfd8e3; background: #ffffff; border-radius: 8px; padding: 18px; box-shadow: 0 1px 2px rgba(15, 23, 42, .05); }
  .hero { display: grid; gap: 10px; background: linear-gradient(135deg, #e8f3ff, #fff8df); }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .feed { display: grid; gap: 12px; }
  .feed-card { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; }
  .feed-card p { grid-column: 1 / -1; margin: 0; }
  .metric strong { display: block; font-size: 30px; margin-top: 4px; }
  .bar { height: 8px; width: var(--w); background: #2563eb; border-radius: 999px; margin-top: 12px; }
  table { border-collapse: collapse; width: 100%; background: #fff; }
  th, td { border-bottom: 1px solid #d8e0ea; padding: 10px; text-align: left; }
  input, button { font: inherit; padding: 8px 10px; border: 1px solid #9fb0c3; border-radius: 6px; background: #fff; }
  button { background: #172033; color: #fff; cursor: pointer; }
  .shadow-host { display: block; margin-top: 16px; }
  .media-shell video, .media-shell audio { width: 100%; display: block; margin-top: 10px; }
`;

function page(title, body, extraScript = '') {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>${baseStyle}</style>
</head>
<body>
  <main>${body}</main>
  <script>
    window.__benchDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    window.__runBenchmarkActivity = async function(activity) {
      if (activity === 'idle') {
        await window.__benchDelay(160);
        return;
      }
      if (activity === 'reading') {
        window.scrollTo(0, Math.min(900, document.body.scrollHeight));
        document.documentElement.dataset.reading = 'true';
        const marker = document.querySelector('[data-benchmark-marker]');
        if (marker) marker.textContent = 'reading activity completed';
        await window.__benchDelay(90);
        return;
      }
      if (activity === 'agent') {
        const input = document.querySelector('input');
        if (input) {
          input.value = 'agent typed deterministic text';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const target = document.querySelector('[data-agent-target]');
        if (target) target.setAttribute('data-agent-state', 'complete');
        const list = document.querySelector('[data-dynamic-list]');
        if (list) {
          for (let i = 0; i < 6; i++) {
            const node = document.createElement('article');
            node.className = 'feed-card';
            node.innerHTML = '<h3>Agent-added item ' + i + '</h3><p>Inserted by deterministic benchmark action.</p><button>Open</button>';
            list.appendChild(node);
          }
        }
        window.scrollTo(0, Math.min(1400, document.body.scrollHeight));
        await window.__benchDelay(120);
      }
    };
    ${extraScript}
  </script>
</body>
</html>`;
}

export const CORPUS = [
  {
    id: 'article',
    title: 'Static Article',
    html: page(
      'PhantomStream Benchmark Article',
      `<section class="hero"><h1>Agent supervision as DOM data</h1><p data-benchmark-marker>ready</p><input aria-label="article note" value=""></section>${Array.from({ length: 28 }, (_, i) => paragraph(i + 1)).join('')}`
    ),
  },
  {
    id: 'feed',
    title: 'Infinite Feed',
    html: page(
      'PhantomStream Benchmark Feed',
      `<section class="hero"><h1>Deterministic activity feed</h1><p data-benchmark-marker>ready</p><input aria-label="feed filter"></section><section class="feed" data-dynamic-list>${Array.from({ length: 24 }, (_, i) => feedItem(i + 1)).join('')}</section>`
    ),
  },
  {
    id: 'dashboard',
    title: 'SPA Dashboard',
    html: page(
      'PhantomStream Benchmark Dashboard',
      `<section class="hero" data-agent-target><h1>Operations dashboard</h1><p data-benchmark-marker>ready</p><input aria-label="dashboard command"></section><section class="grid">${metricCard('Latency', 42)}${metricCard('Tasks', 68)}${metricCard('Warnings', 7)}${metricCard('Retries', 15)}${metricCard('Coverage', 91)}${metricCard('Budget', 73)}</section><h2>Runs</h2><table><thead><tr><th>Run</th><th>Status</th><th>Owner</th></tr></thead><tbody>${Array.from({ length: 18 }, (_, i) => `<tr><td>run-${i + 1}</td><td>${i % 3 === 0 ? 'blocked' : 'ok'}</td><td>agent-${(i % 4) + 1}</td></tr>`).join('')}</tbody></table>`
    ),
  },
  {
    id: 'fidelity',
    title: 'Modern DOM Fidelity',
    html: page(
      'PhantomStream Benchmark Fidelity',
      `<section class="hero"><h1>Shadow, iframe, and forms</h1><p data-benchmark-marker>ready</p><input aria-label="fidelity input"></section><div class="shadow-host" id="shadow-host"></div><iframe title="same origin frame" srcdoc="<section style='font-family:sans-serif;padding:12px'><h2>Frame content</h2><button>Frame action</button></section>"></iframe><section class="feed" data-dynamic-list>${Array.from({ length: 10 }, (_, i) => feedItem(i + 1)).join('')}</section>`,
      `const host = document.getElementById('shadow-host'); const root = host.attachShadow({ mode: 'open' }); root.innerHTML = '<style>:host{border:1px solid #64748b;border-radius:8px;padding:14px;background:#eef6ff}button{padding:8px}</style><h2>Open shadow root</h2><button>Shadow action</button>';`
    ),
  },
  {
    id: 'media',
    title: 'Media by Reference',
    html: page(
      'PhantomStream Benchmark Media',
      `<section class="hero"><h1>Referenced media</h1><p data-benchmark-marker>ready</p><input aria-label="media note"></section><section class="media-shell" data-agent-target><h2>Video and audio references</h2><video controls muted poster="/assets/poster.svg" src="/assets/tiny.mp4"></video><audio controls src="/assets/tone.mp3"></audio></section><section class="feed" data-dynamic-list>${Array.from({ length: 8 }, (_, i) => feedItem(i + 1)).join('')}</section>`
    ),
  },
];
