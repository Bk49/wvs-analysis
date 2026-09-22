// Generates ../index.html from ../data/wvs-synthetic.csv.
// Pure Node.js, no dependencies. Fixed seed => byte-identical output on every run.
// Run with: node scripts/generate-index.js

const fs = require('fs');
const path = require('path');

const SEED = 42;
const SAMPLE_PER_COUNTRY = 300;
const CSV_PATH = path.join(__dirname, '..', 'data', 'wvs-synthetic.csv');
const OUT_PATH = path.join(__dirname, '..', 'index.html');

const PALETTE = {
  China: { color: '#E69F00', marker: 'circle', subregion: 'East Asia' },
  Singapore: { color: '#D55E00', marker: 'square', subregion: 'Southeast Asia' },
  Turkey: { color: '#CC79A7', marker: 'triangle', subregion: 'Middle East' },
  India: { color: '#0072B2', marker: 'diamond', subregion: 'South Asia' },
  Kazakhstan: { color: '#009E73', marker: 'cross', subregion: 'Central Asia' },
};
const COUNTRY_ORDER = ['China', 'India', 'Singapore', 'Turkey', 'Kazakhstan'];

// ---------- seeded PRNG (mulberry32) ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededSample(arr, n, rng) {
  const pool = arr.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
}

// ---------- CSV parsing ----------
const rawCsv = fs.readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, '');
const lines = rawCsv.split(/\r?\n/).filter((l) => l.length > 0);
const header = lines[0].split(',');
const rows = lines.slice(1).map((line) => {
  const cells = line.split(',');
  const obj = {};
  header.forEach((h, i) => { obj[h] = cells[i] === undefined ? '' : cells[i]; });
  return obj;
});

const TOTAL_ROWS = rows.length;

// ---------- column overview (raw data, respondent_id excluded) ----------
const COLUMN_TYPES = {
  country: 'Categorical',
  age: 'Numeric (years)',
  urban_rural: 'Categorical',
  income_level: 'Categorical (ordinal)',
  sex: 'Categorical',
  marital_status: 'Categorical',
  education: 'Categorical (ordinal)',
  life_satisfaction: 'Numeric (1-10 scale)',
  freedom_of_choice: 'Numeric (1-10 scale)',
  emancipative_values: 'Numeric (0-1 index)',
  trust_people: 'Categorical (binary)',
  importance_of_god: 'Numeric (1-10 scale)',
  financial_satisfaction: 'Numeric (1-10 scale)',
  secular_values: 'Numeric (0-1 index)',
};

const columns = header
  .filter((h) => h !== 'respondent_id')
  .map((h) => ({
    name: h,
    type: COLUMN_TYPES[h] || 'Unknown',
    nonEmpty: rows.reduce((acc, r) => acc + (r[h] !== '' ? 1 : 0), 0),
  }));

// ---------- duplicate checks (raw data) ----------
const fullRowCounts = new Map();
rows.forEach((r) => {
  const key = header.map((h) => r[h]).join('');
  fullRowCounts.set(key, (fullRowCounts.get(key) || 0) + 1);
});
let duplicateRowExtras = 0;
fullRowCounts.forEach((c) => { if (c > 1) duplicateRowExtras += c - 1; });

const idCounts = new Map();
rows.forEach((r) => {
  const id = r.respondent_id;
  idCounts.set(id, (idCounts.get(id) || 0) + 1);
});
let duplicateIds = 0;
idCounts.forEach((c) => { if (c > 1) duplicateIds += 1; });

// ---------- missing-value cleaning ----------
function hasMissing(r) {
  return header.some((h) => r[h] === '' || r[h] === undefined);
}
const cleanRows = rows.filter((r) => !hasMissing(r));
const droppedRows = TOTAL_ROWS - cleanRows.length;

const beforeByCountry = {};
const afterByCountry = {};
rows.forEach((r) => { beforeByCountry[r.country] = (beforeByCountry[r.country] || 0) + 1; });
cleanRows.forEach((r) => { afterByCountry[r.country] = (afterByCountry[r.country] || 0) + 1; });

// ---------- numeric helpers on clean rows ----------
function num(v) { return parseFloat(v); }
function avg(values) { return values.reduce((a, b) => a + b, 0) / values.length; }

const byCountry = {};
COUNTRY_ORDER.forEach((c) => { byCountry[c] = cleanRows.filter((r) => r.country === c); });

// ---------- cultural map: country averages of secular vs emancipative ----------
const countryAverages = {};
COUNTRY_ORDER.forEach((c) => {
  const rs = byCountry[c];
  countryAverages[c] = {
    secular: avg(rs.map((r) => num(r.secular_values))),
    emancipative: avg(rs.map((r) => num(r.emancipative_values))),
    n: rs.length,
  };
});

// ---------- radar: 6 normalized measures per country ----------
const RADAR_MEASURES = [
  { key: 'life_satisfaction', label: 'Life satisfaction', norm: (r) => num(r.life_satisfaction) / 10 },
  { key: 'trust_people', label: 'Trust in others', norm: (r) => (r.trust_people === 'Trusted' ? 1 : 0) },
  { key: 'importance_of_god', label: 'Importance of god', norm: (r) => num(r.importance_of_god) / 10 },
  { key: 'emancipative_values', label: 'Emancipative values', norm: (r) => num(r.emancipative_values) },
  { key: 'secular_values', label: 'Secular values', norm: (r) => num(r.secular_values) },
  { key: 'financial_satisfaction', label: 'Financial satisfaction', norm: (r) => num(r.financial_satisfaction) / 10 },
];
const radar = {
  measures: RADAR_MEASURES.map((m) => m.label),
  values: {},
};
COUNTRY_ORDER.forEach((c) => {
  const rs = byCountry[c];
  radar.values[c] = RADAR_MEASURES.map((m) => avg(rs.map((r) => m.norm(r))));
});

// ---------- China vs India individual scatter (seeded sample) ----------
const rng = mulberry32(SEED);
const scatterSample = {};
['China', 'India'].forEach((c) => {
  const sampled = seededSample(byCountry[c], SAMPLE_PER_COUNTRY, rng);
  scatterSample[c] = sampled.map((r) => ({
    x: num(r.secular_values),
    y: num(r.emancipative_values),
  }));
});

// ---------- Singapore life x financial satisfaction heatmap ----------
const sgRows = byCountry.Singapore;
const heatmapMatrix = Array.from({ length: 10 }, () => Array(10).fill(0));
sgRows.forEach((r) => {
  const life = Math.round(num(r.life_satisfaction)); // 1-10
  const fin = Math.round(num(r.financial_satisfaction)); // 1-10
  heatmapMatrix[life - 1][fin - 1] += 1;
});

// ---------- assemble embedded data payload ----------
const DATA = {
  seed: SEED,
  samplePerCountry: SAMPLE_PER_COUNTRY,
  totalRows: TOTAL_ROWS,
  cleanRows: cleanRows.length,
  droppedRows,
  countryOrder: COUNTRY_ORDER,
  palette: PALETTE,
  columns,
  quality: {
    duplicateRowExtras,
    duplicateIds,
    droppedRows,
    droppedPct: (droppedRows / TOTAL_ROWS) * 100,
    beforeByCountry,
    afterByCountry,
  },
  countryAverages,
  radar,
  scatterSample,
  heatmap: {
    matrix: heatmapMatrix,
    n: sgRows.length,
    max: Math.max(...heatmapMatrix.flat()),
  },
};

// ---------- HTML/CSS/JS template ----------
const html = buildHtml(DATA);
fs.writeFileSync(OUT_PATH, html, 'utf8');
console.log(`Wrote ${OUT_PATH} (${(html.length / 1024).toFixed(1)} KB) from ${TOTAL_ROWS} raw rows / ${cleanRows.length} clean rows.`);

// ===================================================================
function buildHtml(data) {
  const countryListText = COUNTRY_ORDER
    .map((c) => `${c} (${PALETTE[c].subregion})`)
    .join(', ');

  const columnRows = data.columns
    .map((c) => `<tr><td><code>${escapeHtml(c.name)}</code></td><td>${escapeHtml(c.type)}</td><td>${c.nonEmpty.toLocaleString('en-US')}</td></tr>`)
    .join('\n            ');

  const legendItems = COUNTRY_ORDER
    .map((c) => `<span class="legend-item"><span class="legend-swatch" style="--c:${PALETTE[c].color}"><svg width="16" height="16" viewBox="0 0 16 16">${markerSvg(PALETTE[c].marker, 8, 8, 7, PALETTE[c].color)}</svg></span>${c}</span>`)
    .join('\n          ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Synthetic World Values Survey — Exploratory Analysis</title>
<style>
${css()}
</style>
</head>
<body>
<div class="page">

  <header>
    <h1>Synthetic World Values Survey — Exploratory Analysis</h1>
    <p class="intro">
      The data analysed on this page is <strong>entirely synthetic (simulated)</strong>: every row was
      fabricated to mirror the distributions and relationships reported in the real
      <strong>World Values Survey, Wave 7</strong> (Haerpfer, C., Inglehart, R., Moreno, A., Welzel, C., Kizilova, K.,
      Diez-Medrano J., M. Lagos, P. Norris, E. Ponarin &amp; B. Puranen (eds.). 2022. <em>World Values Survey: Round Seven
      - Country-Pooled Datafile Version 5.0.</em> Madrid, Spain &amp; Vienna, Austria: JD Systems Institute &amp; WVSA
      Secretariat. <a href="https://www.worldvaluessurvey.org/" target="_blank" rel="noopener">worldvaluessurvey.org</a>),
      which this dataset is modelled on. <strong>No real respondent data is used anywhere here, and every finding
      below is illustrative only</strong> — it describes patterns in the simulation, not real-world results.
    </p>
    <p class="intro">
      Respondents are simulated from five countries across Asia: <strong>${countryListText}</strong>.
    </p>
  </header>

  <section class="card">
    <h2>Data overview</h2>
    <p>Column names, inferred type, and number of non-empty observations in the raw file
      (<code>respondent_id</code> is an identifier only, so it is excluded here and from every chart).</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Column</th><th>Type</th><th>Non-empty observations</th></tr></thead>
        <tbody>
            ${columnRows}
        </tbody>
      </table>
    </div>
    <p class="note">Raw rows: <strong>${data.totalRows.toLocaleString('en-US')}</strong></p>
  </section>

  <section class="card">
    <h2>Data quality checks</h2>
    <ul class="quality-list">
      <li><strong>Duplicate rows:</strong> ${data.quality.duplicateRowExtras === 0
        ? 'none found — every row is unique.'
        : `${data.quality.duplicateRowExtras.toLocaleString('en-US')} duplicate row(s) found.`}</li>
      <li><strong>Duplicate <code>respondent_id</code> values:</strong> ${data.quality.duplicateIds === 0
        ? 'none found — every respondent ID is unique.'
        : `${data.quality.duplicateIds.toLocaleString('en-US')} duplicate ID(s) found.`}</li>
      <li><strong>Rows with at least one empty cell:</strong>
        ${data.quality.droppedRows.toLocaleString('en-US')} of ${data.totalRows.toLocaleString('en-US')}
        (${round(data.quality.droppedPct, 1)}%) — these rows were removed from every analysis below,
        leaving <strong>${data.cleanRows.toLocaleString('en-US')}</strong> clean rows.</li>
    </ul>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Country</th><th>Raw rows</th><th>Clean rows used below</th></tr></thead>
        <tbody>
          ${COUNTRY_ORDER.map((c) => `<tr><td>${c}</td><td>${(data.quality.beforeByCountry[c] || 0).toLocaleString('en-US')}</td><td>${(data.quality.afterByCountry[c] || 0).toLocaleString('en-US')}</td></tr>`).join('\n          ')}
        </tbody>
      </table>
    </div>
  </section>

  <section class="card">
    <h2>1. Cultural map — emancipative vs. secular values</h2>
    <p class="chart-sub">Each point is one country's average (Inglehart–Welzel style map), not an individual respondent.</p>
    <div id="chart-cultural-map" class="chart"></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Country</th><th>Secular values (avg)</th><th>Emancipative values (avg)</th></tr></thead>
        <tbody>
          ${COUNTRY_ORDER.map((c) => `<tr><td>${c}</td><td>${round(data.countryAverages[c].secular, 2)}</td><td>${round(data.countryAverages[c].emancipative, 2)}</td></tr>`).join('\n          ')}
        </tbody>
      </table>
    </div>
    <p class="takeaway" id="takeaway-cultural-map"></p>
  </section>

  <section class="card">
    <h2>2. Value fingerprints — radar chart</h2>
    <p class="chart-sub">Six measures per country, each normalised to a 0–1 scale.</p>
    <div id="chart-radar" class="chart"></div>
    <div class="legend">
          ${legendItems}
    </div>
    <p class="takeaway" id="takeaway-radar"></p>
  </section>

  <section class="card">
    <h2>3. Individual values, China vs. India</h2>
    <p class="chart-sub">A seeded random sample of ~${data.samplePerCountry} respondents per country (seed = ${data.seed}); large outlined markers show each country's average.</p>
    <div id="chart-scatter" class="chart"></div>
    <p class="takeaway" id="takeaway-scatter"></p>
  </section>

  <section class="card">
    <h2>4. Life vs. financial satisfaction — Singapore</h2>
    <p class="chart-sub">10×10 heatmap of respondent counts, Singapore only (n = ${data.heatmap.n.toLocaleString('en-US')}).</p>
    <div id="chart-heatmap" class="chart"></div>
    <p class="takeaway" id="takeaway-heatmap"></p>
  </section>

  <footer>
    <p>Generated reproducibly by <code>scripts/generate-index.js</code> (Node.js, fixed seed = ${data.seed}) from
      <code>data/wvs-synthetic.csv</code>. This page embeds only pre-computed results — it does not read the CSV
      at runtime, so it works offline and on static hosting alike.</p>
  </footer>

</div>
<script>
const DATA = ${JSON.stringify(data)};
${clientJs()}
</script>
</body>
</html>
`;
}

function css() {
  return `
:root {
  --bg: #f7f7f5;
  --card-bg: #ffffff;
  --text: #1f2328;
  --muted: #57606a;
  --border: #e2e2df;
  --accent: #333;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); line-height: 1.5; }
.page { max-width: 920px; margin: 0 auto; padding: 24px 16px 48px; }
header h1 { font-size: 1.6rem; margin-bottom: 12px; }
.intro { color: var(--muted); margin: 0 0 12px; }
.intro a { color: #0072B2; }
.card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 20px; }
.card h2 { margin-top: 0; font-size: 1.2rem; }
.chart-sub { color: var(--muted); margin-top: -6px; font-size: 0.92rem; }
.note { color: var(--muted); font-size: 0.9rem; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
th { color: var(--muted); font-weight: 600; }
code { background: #f0f0ee; padding: 1px 5px; border-radius: 4px; font-size: 0.88em; }
.quality-list { padding-left: 20px; margin: 0 0 16px; }
.quality-list li { margin-bottom: 6px; }
.chart { width: 100%; overflow-x: auto; }
.chart svg { width: 100%; height: auto; display: block; }
.takeaway { margin: 10px 0 0; font-size: 0.95rem; }
.legend { display: flex; flex-wrap: wrap; gap: 12px 18px; margin-top: 10px; font-size: 0.9rem; }
.legend-item { display: inline-flex; align-items: center; gap: 6px; }
.legend-swatch { display: inline-flex; }
footer { color: var(--muted); font-size: 0.85rem; text-align: center; margin-top: 8px; }
.hm-table { border-collapse: collapse; margin: 0 auto; }
.hm-table th, .hm-table td { border: 1px solid var(--border); text-align: center; padding: 0; }
.hm-cell { width: 32px; height: 28px; font-size: 0.7rem; cursor: default; }
.hm-axis-label { font-size: 0.78rem; color: var(--muted); font-weight: 600; }
.hm-wrap { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.hm-x-title, .hm-y-title { font-size: 0.85rem; color: var(--muted); text-align: center; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#15171a; --card-bg:#1c1f23; --text:#e6e6e6; --muted:#9aa2ab; --border:#2c3036; }
  code { background:#262a2f; }
}
@media (max-width: 480px) {
  .page { padding: 16px 10px 32px; }
  header h1 { font-size: 1.35rem; }
  .card { padding: 14px; }
}
`;
}

function markerSvg(type, cx, cy, r, color, strokeOnly) {
  const fill = strokeOnly ? 'white' : color;
  const stroke = color;
  const sw = strokeOnly ? 2.5 : 1.2;
  switch (type) {
    case 'circle':
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
    case 'square': {
      const s = r * 1.7;
      return `<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
    }
    case 'triangle': {
      const h = r * 1.9;
      const p1 = `${cx},${cy - h * 0.62}`;
      const p2 = `${cx - h * 0.58},${cy + h * 0.42}`;
      const p3 = `${cx + h * 0.58},${cy + h * 0.42}`;
      return `<polygon points="${p1} ${p2} ${p3}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
    }
    case 'diamond': {
      const d = r * 1.35;
      return `<polygon points="${cx},${cy - d} ${cx + d},${cy} ${cx},${cy + d} ${cx - d},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
    }
    case 'cross': {
      const s = r * 1.1;
      return `<g stroke="${color}" stroke-width="${sw + 1.5}" stroke-linecap="round">
        <line x1="${cx - s}" y1="${cy - s}" x2="${cx + s}" y2="${cy + s}" />
        <line x1="${cx - s}" y1="${cy + s}" x2="${cx + s}" y2="${cy - s}" />
      </g>`;
    }
    default:
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
  }
}

function round(v, dp) {
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function clientJs() {
  // NOTE: this string is embedded verbatim into index.html's <script>.
  // It only ever reads the already-embedded DATA object — no network/file access.
  return `
function fmt(v, dp) { return Number(v).toFixed(dp); }
function markerSvg(type, cx, cy, r, color, strokeOnly) {
  const fill = strokeOnly ? 'white' : color;
  const stroke = color;
  const sw = strokeOnly ? 2.5 : 1.2;
  switch (type) {
    case 'circle':
      return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '" />';
    case 'square': {
      const s = r * 1.7;
      return '<rect x="' + (cx - s / 2) + '" y="' + (cy - s / 2) + '" width="' + s + '" height="' + s + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '" />';
    }
    case 'triangle': {
      const h = r * 1.9;
      const p1 = cx + ',' + (cy - h * 0.62);
      const p2 = (cx - h * 0.58) + ',' + (cy + h * 0.42);
      const p3 = (cx + h * 0.58) + ',' + (cy + h * 0.42);
      return '<polygon points="' + p1 + ' ' + p2 + ' ' + p3 + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '" />';
    }
    case 'diamond': {
      const d = r * 1.35;
      return '<polygon points="' + cx + ',' + (cy - d) + ' ' + (cx + d) + ',' + cy + ' ' + cx + ',' + (cy + d) + ' ' + (cx - d) + ',' + cy + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '" />';
    }
    case 'cross': {
      const s = r * 1.1;
      return '<g stroke="' + color + '" stroke-width="' + (sw + 1.5) + '" stroke-linecap="round">' +
        '<line x1="' + (cx - s) + '" y1="' + (cy - s) + '" x2="' + (cx + s) + '" y2="' + (cy + s) + '" />' +
        '<line x1="' + (cx - s) + '" y1="' + (cy + s) + '" x2="' + (cx + s) + '" y2="' + (cy - s) + '" />' +
        '</g>';
    }
    default:
      return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '" />';
  }
}

// ---------- 1. Cultural map ----------
function renderCulturalMap() {
  const W = 640, H = 440, pad = { l: 60, r: 30, t: 20, b: 50 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;

  // Zoom the axes to the spread of the 5 country averages (with padding),
  // rather than the full 0-1 scale, so the points aren't squeezed into one corner.
  const secVals = DATA.countryOrder.map((c) => DATA.countryAverages[c].secular);
  const emVals = DATA.countryOrder.map((c) => DATA.countryAverages[c].emancipative);
  function niceDomain(vals) {
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const padAmt = Math.max((hi - lo) * 0.35, 0.05);
    return [Math.max(0, lo - padAmt), Math.min(1, hi + padAmt)];
  }
  const xDomain = niceDomain(secVals), yDomain = niceDomain(emVals);
  const x = (v) => pad.l + ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotW;
  const y = (v) => pad.t + plotH - ((v - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotH;

  function niceStep(domain) {
    const span = domain[1] - domain[0];
    if (span <= 0.15) return 0.02;
    if (span <= 0.3) return 0.05;
    return 0.1;
  }
  const xStep = niceStep(xDomain), yStep = niceStep(yDomain);

  let axesSvg = '';
  for (let g = Math.ceil(xDomain[0] / xStep) * xStep; g <= xDomain[1] + 1e-9; g += xStep) {
    const gx = x(g);
    axesSvg += '<line x1="' + gx + '" y1="' + pad.t + '" x2="' + gx + '" y2="' + (pad.t + plotH) + '" stroke="#e2e2df" stroke-width="1" />';
    axesSvg += '<text x="' + gx + '" y="' + (pad.t + plotH + 18) + '" font-size="11" fill="#57606a" text-anchor="middle">' + fmt(g, 2) + '</text>';
  }
  for (let g = Math.ceil(yDomain[0] / yStep) * yStep; g <= yDomain[1] + 1e-9; g += yStep) {
    const gy = y(g);
    axesSvg += '<line x1="' + pad.l + '" y1="' + gy + '" x2="' + (pad.l + plotW) + '" y2="' + gy + '" stroke="#e2e2df" stroke-width="1" />';
    axesSvg += '<text x="' + (pad.l - 10) + '" y="' + (gy + 4) + '" font-size="11" fill="#57606a" text-anchor="end">' + fmt(g, 2) + '</text>';
  }
  axesSvg += '<line x1="' + pad.l + '" y1="' + (pad.t + plotH) + '" x2="' + (pad.l + plotW) + '" y2="' + (pad.t + plotH) + '" stroke="#888" />';
  axesSvg += '<line x1="' + pad.l + '" y1="' + pad.t + '" x2="' + pad.l + '" y2="' + (pad.t + plotH) + '" stroke="#888" />';
  axesSvg += '<text x="' + (pad.l + plotW / 2) + '" y="' + (H - 8) + '" font-size="12" fill="#333" text-anchor="middle">Secular values (0-1)</text>';
  axesSvg += '<text x="14" y="' + (pad.t + plotH / 2) + '" font-size="12" fill="#333" text-anchor="middle" transform="rotate(-90 14 ' + (pad.t + plotH / 2) + ')">Emancipative values (0-1)</text>';

  // Place each label radially outward from the cluster centroid so 5 nearby
  // points don't stack their text on top of each other.
  const pts = DATA.countryOrder.map((c) => {
    const a = DATA.countryAverages[c];
    return { c, cx: x(a.secular), cy: y(a.emancipative), a };
  });
  const centroidX = pts.reduce((s, p) => s + p.cx, 0) / pts.length;
  const centroidY = pts.reduce((s, p) => s + p.cy, 0) / pts.length;

  let pointsSvg = '';
  pts.forEach(({ c, cx, cy, a }) => {
    const p = DATA.palette[c];
    let dx = cx - centroidX, dy = cy - centroidY;
    const dist = Math.hypot(dx, dy) || 1;
    dx /= dist; dy /= dist;
    const labelR = 24;
    const lx = cx + dx * labelR, ly = cy + dy * labelR;
    const anchor = dx > 0.25 ? 'start' : (dx < -0.25 ? 'end' : 'middle');
    pointsSvg += markerSvg(p.marker, cx, cy, 7, p.color);
    pointsSvg += '<text x="' + lx + '" y="' + ly + '" font-size="12" fill="' + p.color + '" font-weight="600" text-anchor="' + anchor + '">' + c + '</text>';
  });

  document.getElementById('chart-cultural-map').innerHTML =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cultural map scatter of country averages">' + axesSvg + pointsSvg + '</svg>';

  const sortedBySecular = DATA.countryOrder.slice().sort((a, b) => DATA.countryAverages[a].secular - DATA.countryAverages[b].secular);
  const lo = sortedBySecular[0], hi = sortedBySecular[sortedBySecular.length - 1];
  document.getElementById('takeaway-cultural-map').textContent =
    hi + ' shows the highest average secular values (' + fmt(DATA.countryAverages[hi].secular, 2) + ') while ' +
    lo + ' shows the lowest (' + fmt(DATA.countryAverages[lo].secular, 2) + '); emancipative values are more similar ' +
    'across countries, roughly ' + fmt(Math.min(...DATA.countryOrder.map(c => DATA.countryAverages[c].emancipative)), 2) +
    '-' + fmt(Math.max(...DATA.countryOrder.map(c => DATA.countryAverages[c].emancipative)), 2) + '.';
}

// ---------- 2. Radar chart ----------
function renderRadar() {
  const W = 520, H = 520;
  const cx = W / 2, cy = H / 2, maxR = 190;
  const n = DATA.radar.measures.length;
  const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, v) => {
    const a = angle(i), r = v * maxR;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };

  let gridSvg = '';
  [0.2, 0.4, 0.6, 0.8, 1.0].forEach((g) => {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(pt(i, g).join(','));
    gridSvg += '<polygon points="' + pts.join(' ') + '" fill="none" stroke="#e2e2df" stroke-width="1" />';
  });
  for (let i = 0; i < n; i++) {
    const [ex, ey] = pt(i, 1.05);
    gridSvg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + pt(i, 1)[0] + '" y2="' + pt(i, 1)[1] + '" stroke="#e2e2df" stroke-width="1" />';
    const anchor = Math.cos(angle(i)) > 0.3 ? 'start' : (Math.cos(angle(i)) < -0.3 ? 'end' : 'middle');
    gridSvg += '<text x="' + ex + '" y="' + ey + '" font-size="11" fill="#333" text-anchor="' + anchor + '">' + DATA.radar.measures[i] + '</text>';
  }

  let linesSvg = '';
  DATA.countryOrder.forEach((c) => {
    const p = DATA.palette[c];
    const vals = DATA.radar.values[c];
    const pts = vals.map((v, i) => pt(i, v));
    linesSvg += '<polygon points="' + pts.map((pp) => pp.join(',')).join(' ') + '" fill="' + p.color + '" fill-opacity="0.07" stroke="' + p.color + '" stroke-width="2.2" />';
    pts.forEach((pp) => { linesSvg += markerSvg(p.marker, pp[0], pp[1], 5, p.color); });
  });

  document.getElementById('chart-radar').innerHTML =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Radar chart of normalised value measures by country">' + gridSvg + linesSvg + '</svg>';

  const chinaTrust = DATA.radar.values.China[1], othersTrust = DATA.countryOrder.filter(c => c !== 'China').map(c => DATA.radar.values[c][1]);
  document.getElementById('takeaway-radar').textContent =
    'China stands out with much higher trust in others (' + fmt(chinaTrust, 2) + ' vs. ' + fmt(Math.max(...othersTrust), 2) +
    ' at most elsewhere), while importance of god shows the widest spread of any measure across the five countries.';
}

// ---------- 3. China vs India scatter ----------
function renderScatter() {
  const W = 640, H = 440, pad = { l: 60, r: 30, t: 20, b: 50 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const domain = [0, 1];
  const x = (v) => pad.l + ((v - domain[0]) / (domain[1] - domain[0])) * plotW;
  const y = (v) => pad.t + plotH - ((v - domain[0]) / (domain[1] - domain[0])) * plotH;

  let axesSvg = '';
  for (let g = 0; g <= 1.0001; g += 0.2) {
    const gx = x(g), gy = y(g);
    axesSvg += '<line x1="' + gx + '" y1="' + pad.t + '" x2="' + gx + '" y2="' + (pad.t + plotH) + '" stroke="#e2e2df" stroke-width="1" />';
    axesSvg += '<line x1="' + pad.l + '" y1="' + gy + '" x2="' + (pad.l + plotW) + '" y2="' + gy + '" stroke="#e2e2df" stroke-width="1" />';
    axesSvg += '<text x="' + gx + '" y="' + (pad.t + plotH + 18) + '" font-size="11" fill="#57606a" text-anchor="middle">' + fmt(g, 1) + '</text>';
    axesSvg += '<text x="' + (pad.l - 10) + '" y="' + (gy + 4) + '" font-size="11" fill="#57606a" text-anchor="end">' + fmt(g, 1) + '</text>';
  }
  axesSvg += '<line x1="' + pad.l + '" y1="' + (pad.t + plotH) + '" x2="' + (pad.l + plotW) + '" y2="' + (pad.t + plotH) + '" stroke="#888" />';
  axesSvg += '<line x1="' + pad.l + '" y1="' + pad.t + '" x2="' + pad.l + '" y2="' + (pad.t + plotH) + '" stroke="#888" />';
  axesSvg += '<text x="' + (pad.l + plotW / 2) + '" y="' + (H - 8) + '" font-size="12" fill="#333" text-anchor="middle">Secular values (0-1)</text>';
  axesSvg += '<text x="14" y="' + (pad.t + plotH / 2) + '" font-size="12" fill="#333" text-anchor="middle" transform="rotate(-90 14 ' + (pad.t + plotH / 2) + ')">Emancipative values (0-1)</text>';

  let ptsSvg = '';
  ['China', 'India'].forEach((c) => {
    const p = DATA.palette[c];
    DATA.scatterSample[c].forEach((d) => {
      ptsSvg += markerSvg(p.marker, x(d.x), y(d.y), 3.2, p.color).replace('stroke-width="1.2"', 'stroke-width="0.6"').replace(/fill="[^"]*"/, 'fill="' + p.color + '" fill-opacity="0.55"');
    });
  });
  ['China', 'India'].forEach((c) => {
    const p = DATA.palette[c];
    const a = DATA.countryAverages[c];
    ptsSvg += markerSvg(p.marker, x(a.secular), y(a.emancipative), 11, p.color, true);
  });

  document.getElementById('chart-scatter').innerHTML =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scatter of individual secular vs emancipative values, China and India">' + axesSvg + ptsSvg + '</svg>';

  document.getElementById('takeaway-scatter').textContent =
    'China\\'s average sits higher on secular values (' + fmt(DATA.countryAverages.China.secular, 2) + ' vs. ' + fmt(DATA.countryAverages.India.secular, 2) +
    ' for India), but the two countries\\' individual clouds overlap heavily — an individual respondent\\'s country is a weak predictor of their personal values.';
}

// ---------- 4. Singapore heatmap ----------
function shadeFor(count, max) {
  if (count === 0) return '#f4f4f2';
  const t = Math.sqrt(count / max); // sqrt for perceptual spread
  const l = 88 - t * 58; // lightness 88% -> 30%
  return 'hsl(24, 75%, ' + l.toFixed(0) + '%)';
}
function renderHeatmap() {
  const m = DATA.heatmap.matrix, max = DATA.heatmap.max;
  let html = '<div class="hm-wrap"><table class="hm-table"><tbody>';
  html += '<tr><td></td><td></td><td colspan="10" class="hm-axis-label">Financial satisfaction &rarr;</td></tr>';
  html += '<tr><td></td><td></td>' + Array.from({length:10},(_,j)=>'<td class="hm-axis-label">'+(j+1)+'</td>').join('') + '</tr>';
  for (let i = 9; i >= 0; i--) {
    html += '<tr>';
    if (i === 9) html += '<td rowspan="10" class="hm-axis-label" style="writing-mode: vertical-rl; transform: rotate(180deg);">Life satisfaction &uarr;</td>';
    html += '<td class="hm-axis-label">' + (i + 1) + '</td>';
    for (let j = 0; j < 10; j++) {
      const count = m[i][j];
      const title = 'Life satisfaction ' + (i + 1) + ', financial satisfaction ' + (j + 1) + ': ' + count + ' respondent' + (count === 1 ? '' : 's');
      html += '<td class="hm-cell" title="' + title + '" style="background:' + shadeFor(count, max) + '">' + (count > 0 ? count : '') + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  document.getElementById('chart-heatmap').innerHTML = html;

  let peak = { i: 0, j: 0, v: -1 };
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) if (m[i][j] > peak.v) peak = { i, j, v: m[i][j] };
  document.getElementById('takeaway-heatmap').textContent =
    'The most common combination is life satisfaction ' + (peak.i + 1) + ' with financial satisfaction ' + (peak.j + 1) +
    ' (' + peak.v + ' respondents), and counts cluster along the diagonal — respondents who report higher financial satisfaction tend to also report higher life satisfaction.';
}

renderCulturalMap();
renderRadar();
renderScatter();
renderHeatmap();
`;
}
