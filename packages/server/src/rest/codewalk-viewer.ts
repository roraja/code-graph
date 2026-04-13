/**
 * CodeWalk Viewer Router — serves an interactive HTML viewer for code walks.
 *
 * Routes:
 * - GET /codewalks       → Walk list page (fetches from /api/codewalks)
 * - GET /codewalks/:id   → Walk viewer page (fetches from /api/codewalks/:id)
 *
 * The viewer is a self-contained HTML page served inline (no external deps).
 * It uses the REST API endpoints to fetch walk data, so it works with both
 * v1 and v2 codewalk formats transparently.
 *
 * @module server/rest/codewalk-viewer
 */

import { Router, type Request, type Response } from 'express';

/**
 * Create the Express router for the CodeWalk viewer pages.
 */
export function createCodeWalkViewerRouter(): Router {
  const router = Router();

  /**
   * GET /codewalks — List all code walks with links to the viewer.
   */
  router.get('/codewalks', (_req: Request, res: Response) => {
    res.type('html').send(getListPageHtml());
  });

  /**
   * GET /codewalks/:id — Interactive viewer for a single code walk.
   * Loads the walk data from /api/codewalks/:id and renders it inline.
   */
  router.get('/codewalks/:id', (req: Request, res: Response) => {
    res.type('html').send(getViewerPageHtml(req.params.id));
  });

  return router;
}

// ---------------------------------------------------------------------------
// HTML Generators
// ---------------------------------------------------------------------------

/**
 * Generate the walk list page HTML.
 * Fetches /api/codewalks on load and renders a card grid.
 */
function getListPageHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CodeWalks</title>
<style>
:root {
  --bg: #ffffff; --bg2: #f8f9fa; --bg3: #f1f3f5;
  --fg: #1a1a1a; --fg2: #555; --fg3: #999;
  --accent: #2563eb; --green: #16a34a; --yellow: #d97706;
  --border: #e5e7eb;
  --mono: 'SF Mono','Cascadia Code','Fira Code','Consolas',monospace;
  --sans: -apple-system,'Segoe UI','Helvetica Neue',system-ui,sans-serif;
  --shadow: 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04);
  --shadow-hover: 0 4px 12px rgba(0,0,0,.08);
}
* { margin:0; padding:0; box-sizing:border-box; }
body { background:var(--bg2); color:var(--fg); font-family:var(--sans); font-size:15px; line-height:1.6; -webkit-font-smoothing:antialiased; }
.topbar {
  background:var(--bg); padding:20px 32px; border-bottom:1px solid var(--border);
  display:flex; align-items:baseline; gap:12px;
  box-shadow:0 1px 2px rgba(0,0,0,.04);
}
.topbar h1 { font-size:22px; font-weight:700; color:var(--fg); letter-spacing:-.02em; }
.topbar .count { font-size:13px; color:var(--fg3); font-weight:400; }
.container { max-width:960px; margin:40px auto; padding:0 32px; }
.loading { text-align:center; padding:80px 0; color:var(--fg2); font-size:15px; }
.empty { text-align:center; padding:80px 0; color:var(--fg3); }
.empty p { margin-bottom:8px; }
.empty code { background:var(--bg3); padding:3px 8px; border-radius:4px; font-family:var(--mono); font-size:13px; color:var(--fg2); }
.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(400px, 1fr)); gap:20px; }
.card {
  background:var(--bg); border:1px solid var(--border); border-radius:12px;
  padding:24px 28px; cursor:pointer; transition:box-shadow .2s, border-color .2s;
  text-decoration:none; color:inherit; display:block; box-shadow:var(--shadow);
}
.card:hover { box-shadow:var(--shadow-hover); border-color:#c7d2fe; }
.card .name { font-size:16px; font-weight:600; color:var(--fg); margin-bottom:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.card .desc { font-size:13px; color:var(--fg2); line-height:1.6; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; margin-bottom:16px; min-height:42px; }
.card .meta { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
.card .badge { font-size:11px; padding:3px 10px; border-radius:20px; font-weight:600; }
.card .cells-badge { background:#dcfce7; color:var(--green); }
.card .entry-badge { background:#dbeafe; color:var(--accent); font-family:var(--mono); font-size:11px; }
.card .date { font-size:12px; color:var(--fg3); margin-left:auto; }
.tags { display:flex; gap:6px; flex-wrap:wrap; margin-top:12px; }
.tag { font-size:11px; padding:2px 10px; border-radius:20px; background:#eff6ff; color:var(--accent); font-weight:500; }
@media (max-width:500px) { .grid { grid-template-columns:1fr; } .container { padding:0 16px; } }
</style>
</head>
<body>
<div class="topbar">
  <h1>CodeWalks</h1>
  <span class="count" id="count"></span>
</div>
<div class="container">
  <div class="loading" id="loading">Loading code walks\u2026</div>
  <div class="grid" id="grid" style="display:none"></div>
  <div class="empty" id="empty" style="display:none">
    <p>No code walks found.</p>
    <p>Code walks are stored in <code>.vscode/code-graph/codewalks/</code></p>
  </div>
</div>
<script>
(async () => {
  const res = await fetch('/api/codewalks');
  const walks = await res.json();
  document.getElementById('loading').style.display = 'none';

  if (!walks || walks.length === 0) {
    document.getElementById('empty').style.display = '';
    return;
  }

  document.getElementById('count').textContent = walks.length + ' walk' + (walks.length === 1 ? '' : 's');
  const grid = document.getElementById('grid');
  grid.style.display = '';

  for (const w of walks) {
    const entry = w.entryPoint ? w.entryPoint.functionName || '' : '';
    const date = w.updatedAt ? new Date(w.updatedAt).toLocaleDateString() : '';
    const tags = (w.tags || []).map(t => '<span class="tag">' + esc(t) + '</span>').join('');

    const card = document.createElement('a');
    card.href = '/codewalks/' + encodeURIComponent(w.id);
    card.className = 'card';
    card.innerHTML =
      '<div class="name">' + esc(w.name) + '</div>' +
      '<div class="desc">' + esc(w.description || '') + '</div>' +
      '<div class="meta">' +
        '<span class="badge cells-badge">' + w.cellCount + ' cells</span>' +
        (entry ? '<span class="badge entry-badge">' + esc(entry) + '</span>' : '') +
        '<span class="date">' + esc(date) + '</span>' +
      '</div>' +
      (tags ? '<div class="tags">' + tags + '</div>' : '');
    grid.appendChild(card);
  }
})();

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
</script>
</body>
</html>`;
}

/**
 * Generate the walk viewer page HTML for a specific walk ID.
 * Fetches /api/codewalks/:id on load and renders the full interactive viewer.
 */
function getViewerPageHtml(walkId: string): string {
  const safeId = walkId.replace(/[^a-zA-Z0-9_-]/g, '');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CodeWalk Viewer</title>
<style>
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f8f9fa;
  --bg-tertiary: #f1f3f5;
  --bg-input: #ffffff;
  --bg-hover: #f0f1f3;
  --bg-active: rgba(37, 99, 235, 0.06);
  --fg-primary: #1a1a1a;
  --fg-secondary: #555;
  --fg-muted: #999;
  --fg-bright: #111;
  --border: #e5e7eb;
  --border-light: #f0f0f0;
  --accent: #2563eb;
  --accent3: #854d0e;
  --accent4: #9a3412;
  --blue: #2563eb;
  --green: #16a34a;
  --yellow: #d97706;
  --red: #dc2626;
  --orange: #ea580c;
  --teal: #0d9488;
  --purple: #7c3aed;
  --mono: 'SF Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  --sans: -apple-system, 'Segoe UI', 'Helvetica Neue', system-ui, sans-serif;
  --radius: 6px;
  --transition: 0.15s ease;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.04);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; overflow: hidden; background: var(--bg-primary); color: var(--fg-primary); font-family: var(--sans); font-size: 14px; -webkit-font-smoothing: antialiased; }

/* Loading state */
#loading { display:flex; align-items:center; justify-content:center; height:100%; color:var(--fg-secondary); font-size:15px; }
#loading.hidden { display: none; }

/* Top bar */
.topbar {
  display:flex; align-items:center; padding:0 20px; height:48px;
  background:var(--bg-primary); border-bottom:1px solid var(--border);
  flex-shrink:0; gap:14px; box-shadow:var(--shadow-sm);
}
.topbar .back-link { color:var(--accent); text-decoration:none; font-size:13px; cursor:pointer; font-weight:500; }
.topbar .back-link:hover { text-decoration:underline; }
.topbar .walk-name { font-size:14px; font-weight:600; color:var(--fg-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:400px; }
.topbar .separator { color:var(--fg-muted); font-size:12px; }
.topbar .cell-badge { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.3px; white-space:nowrap; }
.topbar .cell-counter { margin-left:auto; font-family:var(--mono); font-size:12px; color:var(--fg-muted); white-space:nowrap; }
.topbar .nav-group { display:flex; align-items:center; gap:6px; }
.topbar .nav-btn {
  padding:5px 14px; border-radius:var(--radius); border:1px solid var(--border);
  background:var(--bg-primary); color:var(--fg-primary); font-size:12px;
  font-family:var(--sans); cursor:pointer; transition:all var(--transition);
  white-space:nowrap; font-weight:500;
}
.topbar .nav-btn:hover:not(:disabled) { background:var(--bg-hover); border-color:var(--accent); color:var(--accent); }
.topbar .nav-btn:disabled { opacity:.3; cursor:default; }
.topbar .jump-input {
  width:48px; padding:4px 8px; border-radius:var(--radius); border:1px solid var(--border);
  background:var(--bg-input); color:var(--fg-primary); font-size:12px;
  font-family:var(--mono); text-align:center; outline:none;
}
.topbar .jump-input:focus { border-color:var(--accent); box-shadow:0 0 0 2px rgba(37,99,235,.1); }

/* Main layout */
.main-content { display:flex; flex:1; overflow:hidden; }
.viewer-layout { display:none; flex-direction:column; height:100vh; }
.viewer-layout.active { display:flex; }

/* Cell nav sidebar */
.cell-nav {
  width:260px; background:var(--bg-secondary); border-right:1px solid var(--border);
  display:flex; flex-direction:column; flex-shrink:0; overflow:hidden;
}
.cell-nav .nav-header {
  padding:14px 16px 10px; font-size:11px; font-weight:600; text-transform:uppercase;
  letter-spacing:.8px; color:var(--fg-muted); border-bottom:1px solid var(--border); flex-shrink:0;
}
.cell-nav .nav-list { flex:1; overflow-y:auto; padding:6px 0; }
.cell-nav .nav-item {
  display:flex; align-items:center; gap:6px; padding:7px 12px; cursor:pointer;
  font-size:12px; font-family:var(--mono); transition:background var(--transition);
  border-left:3px solid transparent; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  color:var(--fg-secondary);
}
.cell-nav .nav-item:hover { background:var(--bg-hover); }
.cell-nav .nav-item.active { background:var(--bg-active); border-left-color:var(--accent); color:var(--fg-primary); font-weight:500; }
.cell-nav .nav-item .indent { flex-shrink:0; color:var(--border); font-size:10px; }
.cell-nav .nav-item .icon { flex-shrink:0; width:16px; text-align:center; font-size:11px; }
.cell-nav .nav-item .label { overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0; }
.cell-nav .nav-item .status-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; margin-left:auto; }
.status-dot.skeleton { background:#d1d5db; }
.status-dot.partial { background:var(--yellow); }
.status-dot.complete { background:var(--green); }
.status-dot.corrected { background:#ec4899; }

/* Code panel */
.code-panel { flex:1; display:flex; flex-direction:column; overflow:hidden; min-width:0; }
.file-tab-bar {
  display:flex; align-items:center; height:40px; background:var(--bg-secondary);
  border-bottom:1px solid var(--border); flex-shrink:0; padding:0 16px; gap:14px;
}
.file-tab-bar .file-path { font-family:var(--mono); font-size:12px; color:var(--fg-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.file-tab-bar .line-range { font-family:var(--mono); font-size:11px; color:var(--fg-muted); margin-left:auto; white-space:nowrap; }
.file-tab-bar .confidence { font-size:11px; padding:2px 8px; border-radius:20px; font-weight:600; white-space:nowrap; }
.confidence.high { background:#dcfce7; color:var(--green); }
.confidence.mid { background:#fef3c7; color:var(--yellow); }
.confidence.low { background:#fee2e2; color:var(--red); }

.code-area {
  flex:1; overflow:auto; padding:12px 0; font-family:var(--mono); font-size:13px;
  line-height:24px; background:var(--bg-primary);
}
.code-line { display:flex; min-height:24px; padding:0 20px 0 0; border-left:3px solid transparent; transition:background .1s; }
.code-line:hover { background:rgba(0,0,0,.015); }
.code-line.in-cell-range { background:rgba(37,99,235,.03); }
.line-gutter { width:56px; text-align:right; padding-right:20px; color:#c7c7c7; user-select:none; flex-shrink:0; font-size:12px; }
.line-gutter.in-range { color:#888; }
.line-content { flex:1; white-space:pre; padding-left:8px; min-width:0; }
.line-annotation { color:#6a9955; font-style:italic; margin-left:24px; font-size:11px; opacity:.85; white-space:nowrap; }

.code-line.hl-executed { background:rgba(37,99,235,.06); border-left-color:var(--blue); }
.code-line.hl-called { background:rgba(13,148,136,.06); border-left-color:var(--teal); }
.code-line.hl-branched { background:rgba(234,88,12,.06); border-left-color:var(--orange); }
.code-line.hl-assigned { background:rgba(133,77,14,.06); border-left-color:var(--accent3); }
.code-line.hl-returned { background:rgba(22,163,74,.06); border-left-color:var(--green); }
.code-line.hl-skipped { background:rgba(0,0,0,.02); border-left-color:#ccc; opacity:.45; }
.code-line.cell-range-start { border-top:1px solid rgba(37,99,235,.15); }
.code-line.cell-range-end { border-bottom:1px solid rgba(37,99,235,.15); }

/* Spotlight mode */
.code-area.has-spotlight .code-line { opacity:.2; transition:opacity .2s; }
.code-area.has-spotlight .code-line.spotlight { opacity:1; background:rgba(250,204,21,.12) !important; border-left-color:#eab308 !important; box-shadow:inset 0 0 0 1px rgba(234,179,8,.15); }
.code-area.has-spotlight .code-line.spotlight .line-gutter { color:#a16207; font-weight:600; }
.code-area.has-spotlight .code-line.spotlight .line-annotation { color:#a16207; opacity:1; }

/* Right panel */
.right-panel {
  width:380px; background:var(--bg-secondary); border-left:1px solid var(--border);
  display:flex; flex-direction:column; overflow:hidden; flex-shrink:0;
}
.panel-tabs { display:flex; background:var(--bg-primary); border-bottom:1px solid var(--border); flex-shrink:0; }
.panel-tab {
  flex:1; padding:10px 12px; font-size:11px; font-weight:600; color:var(--fg-muted);
  cursor:pointer; border-bottom:2px solid transparent; text-align:center;
  text-transform:uppercase; letter-spacing:.5px; transition:all var(--transition); white-space:nowrap;
}
.panel-tab:hover { color:var(--fg-secondary); }
.panel-tab.active { color:var(--accent); border-bottom-color:var(--accent); }
.panel-body { flex:1; overflow-y:auto; padding:20px; }

.narrative-text { font-size:14px; line-height:1.8; color:var(--fg-primary); white-space:pre-wrap; word-wrap:break-word; }
.narrative-text strong { color:var(--accent); font-weight:600; }
.narrative-text code { background:var(--bg-tertiary); padding:2px 6px; border-radius:4px; font-family:var(--mono); font-size:12px; color:var(--accent4); }

.scope-group { margin-bottom:18px; }
.scope-name { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.5px; color:var(--fg-muted); margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid var(--border); }
.var-row { display:flex; align-items:baseline; gap:8px; padding:5px 8px; font-family:var(--mono); font-size:12px; border-radius:var(--radius); margin-bottom:3px; flex-wrap:wrap; }
.var-row.changed { background:rgba(217,119,6,.06); border-left:2px solid var(--yellow); padding-left:6px; }
.var-action { font-size:11px; width:18px; flex-shrink:0; }
.var-name { color:var(--accent); font-weight:600; flex-shrink:0; }
.var-type { font-size:10px; color:var(--fg-muted); background:var(--bg-tertiary); padding:1px 5px; border-radius:4px; }
.var-value { color:var(--accent4); flex:1; min-width:0; word-break:break-all; }
.changes-summary { margin-top:14px; padding:10px 14px; background:rgba(217,119,6,.04); border-radius:var(--radius); border:1px solid rgba(217,119,6,.12); }
.changes-label { font-size:11px; font-weight:600; text-transform:uppercase; color:var(--fg-muted); margin-bottom:6px; }
.change-item { font-family:var(--mono); font-size:12px; color:var(--fg-primary); padding:2px 0; }

.stack-frames { display:flex; flex-direction:column; gap:2px; }
.stack-frame {
  display:flex; align-items:center; gap:8px; padding:8px 10px; font-size:12px;
  border-left:3px solid transparent; cursor:pointer;
  border-radius:0 var(--radius) var(--radius) 0; transition:background var(--transition);
}
.stack-frame:hover { background:var(--bg-hover); }
.stack-frame.current { border-left-color:var(--accent); background:var(--bg-active); font-weight:600; }
.stack-depth { font-family:var(--mono); font-size:11px; color:var(--fg-muted); min-width:20px; }
.stack-name { font-family:var(--mono); font-size:12px; color:var(--accent); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }
.stack-loc { font-size:11px; color:var(--fg-muted); white-space:nowrap; flex-shrink:0; }

.walk-description { margin-top:20px; padding-top:16px; border-top:1px solid var(--border); }
.walk-description .desc-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.5px; color:var(--fg-muted); margin-bottom:8px; }
.walk-description .desc-text { font-size:13px; color:var(--fg-secondary); line-height:1.7; }
.tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }
.tag { font-size:11px; padding:2px 10px; border-radius:20px; background:#eff6ff; color:var(--accent); font-weight:500; }

.statusbar {
  display:flex; align-items:center; height:28px; padding:0 16px;
  background:var(--bg-tertiary); color:var(--fg-muted); font-size:11px; flex-shrink:0;
  gap:16px; border-top:1px solid var(--border);
}
.statusbar .left { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--mono); font-size:11px; }
.statusbar .right { text-align:right; white-space:nowrap; }

::-webkit-scrollbar { width:8px; height:8px; }
::-webkit-scrollbar-track { background:transparent; }
::-webkit-scrollbar-thumb { background:rgba(0,0,0,.12); border-radius:4px; }
::-webkit-scrollbar-thumb:hover { background:rgba(0,0,0,.2); }

@media (max-width:900px) { .cell-nav { display:none; } .right-panel { width:260px; } }
@media (max-width:600px) { .right-panel { display:none; } }
</style>
</head>
<body>
<div id="loading">Loading code walk\u2026</div>
<div class="viewer-layout" id="viewer">
  <div class="topbar">
    <a class="back-link" href="/codewalks">\u2190 All Walks</a>
    <span class="separator">/</span>
    <span class="walk-name" id="walk-name"></span>
    <span class="separator">\u00b7</span>
    <span class="cell-badge" id="cell-badge"></span>
    <span class="cell-counter" id="cell-counter"></span>
    <div class="nav-group">
      <button class="nav-btn" id="btn-prev">\u2039 Prev</button>
      <input class="jump-input" id="jump-input" type="number" min="1">
      <button class="nav-btn" id="btn-next">Next \u203a</button>
    </div>
  </div>
  <div class="main-content">
    <div class="cell-nav">
      <div class="nav-header">Cells</div>
      <div class="nav-list" id="cell-nav-list"></div>
    </div>
    <div class="code-panel">
      <div class="file-tab-bar">
        <span class="file-path" id="file-path"></span>
        <span class="line-range" id="line-range"></span>
        <span class="confidence" id="confidence"></span>
      </div>
      <div class="code-area" id="code-area"></div>
    </div>
    <div class="right-panel">
      <div class="panel-tabs">
        <div class="panel-tab active" data-tab="narrative">Narrative</div>
        <div class="panel-tab" data-tab="variables">Variables</div>
        <div class="panel-tab" data-tab="callstack">Call Stack</div>
      </div>
      <div class="panel-body" id="panel-body"></div>
    </div>
  </div>
  <div class="statusbar">
    <span class="left" id="status-left"></span>
    <span class="right" id="status-right">Arrow keys to navigate \u00b7 1/2/3 for tabs</span>
  </div>
</div>

<script>
// Inline viewer — same logic as tools/codewalk-viewer.html but auto-loads from API
(() => {
  'use strict';
  const WALK_ID = ${JSON.stringify(safeId)};
  let walk = null, cells = [], activeIndex = 0, activeTab = 'narrative';
  const fileCache = new Map(); // path \u2192 {content, lines[]}

  const $ = id => document.getElementById(id);
  const esc = s => s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';
  const renderMd = t => { if(!t)return''; let h=esc(t); h=h.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>'); h=h.replace(/\`([^\`]+)\`/g,'<code>$1</code>'); return h; };

  const TYPES = {
    entry:{icon:'\\u25B6',label:'Entry',color:'#2563eb',bg:'rgba(37,99,235,.08)'},
    call:{icon:'\\u2192',label:'Call',color:'#0d9488',bg:'rgba(13,148,136,.08)'},
    branch:{icon:'?',label:'Branch',color:'#ea580c',bg:'rgba(234,88,12,.08)'},
    assignment:{icon:'=',label:'Assignment',color:'#854d0e',bg:'rgba(133,77,14,.08)'},
    return:{icon:'\\u2190',label:'Return',color:'#16a34a',bg:'rgba(22,163,74,.08)'},
    dispatch:{icon:'\\u27BF',label:'Dispatch',color:'#7c3aed',bg:'rgba(124,58,237,.08)'},
    block:{icon:'\\u25AA',label:'Block',color:'#555',bg:'rgba(0,0,0,.04)'},
    note:{icon:'\\u270E',label:'Note',color:'#64748b',bg:'rgba(100,116,139,.08)'},
  };
  const ACTIONS = { created:'\\uD83C\\uDD95', modified:'\\u270F\\uFE0F', read:'\\uD83D\\uDC41', unchanged:'' };

  const KW = new Set(['void','int','bool','char','unsigned','const','static','virtual','override','class','struct','return','if','else','for','while','switch','case','break','continue','default','new','delete','nullptr','true','false','this','auto','HRESULT','DWORD','BOOL','S_OK','std','base','gfx','ui','aura','blink','content']);
  function colorize(t) {
    let h=esc(t);
    h=h.replace(/(\\/\\/.*?)$/gm,'<span style="color:#6a9955">$1</span>');
    h=h.replace(/(&quot;.*?&quot;)/g,'<span style="color:#a31515">$1</span>');
    h=h.replace(/\\b(\\d+)\\b/g,'<span style="color:#098658">$1</span>');
    h=h.replace(/\\b([A-Z]\\w+)(::)/g,'<span style="color:#267f99">$1</span>$2');
    for(const kw of KW) h=h.replace(new RegExp('\\\\b('+kw+')\\\\b','g'),'<span style="color:#0000ff">$1</span>');
    return h;
  }

  function getCellLabel(c) {
    const s=c.callStack, fn=s&&s.length?s[s.length-1].functionName:'', sf=fn?fn.split('::').pop():'';
    switch(c.type){case'entry':return sf||'Entry';case'call':return'\\u2192 '+(sf||'Call');case'branch':return'? Branch';case'dispatch':return'\\u27BF '+(sf||'Dispatch');case'note':return'\\u270E Note';default:return c.type;}
  }

  function buildNav() {
    let h='';
    for(let i=0;i<cells.length;i++){
      const c=cells[i],cfg=TYPES[c.type]||TYPES.block,indent='\\u00A0\\u00A0'.repeat(c.stackDepth||0);
      h+='<div class="nav-item'+(i===activeIndex?' active':'')+'" data-index="'+i+'"><span class="indent">'+indent+'</span><span class="icon" style="color:'+cfg.color+'">'+cfg.icon+'</span><span class="label">'+esc(getCellLabel(c))+'</span><span class="status-dot '+(c.status||'skeleton')+'"></span></div>';
    }
    $('cell-nav-list').innerHTML=h;
    $('cell-nav-list').querySelectorAll('.nav-item').forEach(el=>el.addEventListener('click',()=>goTo(+el.dataset.index)));
  }

  function render() {
    const c=cells[activeIndex]; if(!c)return;
    const cfg=TYPES[c.type]||TYPES.block;
    $('cell-badge').textContent=cfg.label; $('cell-badge').style.color=cfg.color; $('cell-badge').style.background=cfg.bg;
    $('cell-counter').textContent=(activeIndex+1)+' / '+cells.length;
    $('btn-prev').disabled=activeIndex===0; $('btn-next').disabled=activeIndex===cells.length-1;
    $('file-path').textContent=c.code.filePath||'';
    $('line-range').textContent=c.code.startLine&&c.code.endLine?'L'+c.code.startLine+'\\u2013'+c.code.endLine:'';
    if(c.confidence!==undefined){const p=(c.confidence*100).toFixed(0),cls=c.confidence>=.8?'high':c.confidence>=.5?'mid':'low';$('confidence').textContent=p+'%';$('confidence').className='confidence '+cls;$('confidence').style.display='';}else{$('confidence').style.display='none';}

    // Fetch full file and render
    renderFullFile(c);

    // Panel
    renderPanel(c);
    // Nav highlight
    $('cell-nav-list').querySelectorAll('.nav-item').forEach((el,i)=>el.classList.toggle('active',i===activeIndex));
    const ae=$('cell-nav-list').querySelectorAll('.nav-item')[activeIndex];
    if(ae)ae.scrollIntoView({block:'nearest',behavior:'smooth'});
    $('status-left').textContent=(c.code.filePath||'')+' : '+(c.code.startLine||'');
  }

  // Fetch full source file from server and render with cell highlights
  async function renderFullFile(c) {
    const code = c.code;
    const filePath = code.filePath;

    // Build highlight map from the cell
    const hlMap = new Map();
    if (code.highlights) for (const hl of code.highlights) hlMap.set(hl.line, hl);
    const startLine = code.startLine || 1;
    const endLine = code.endLine || startLine;

    // Try to fetch the full file
    let fullLines = null;
    if (filePath && !fileCache.has('__failed_'+filePath)) {
      if (fileCache.has(filePath)) {
        fullLines = fileCache.get(filePath);
      } else {
        try {
          const res = await fetch('/api/file?path='+encodeURIComponent(filePath));
          if (res.ok) {
            const data = await res.json();
            fullLines = data.content.split('\\n');
            fileCache.set(filePath, fullLines);
          } else {
            fileCache.set('__failed_'+filePath, true);
          }
        } catch(e) {
          fileCache.set('__failed_'+filePath, true);
        }
      }
    }

    let ch = '';
    if (fullLines) {
      // Render the FULL file with the cell range highlighted
      for (let i = 0; i < fullLines.length; i++) {
        const ln = i + 1;
        const inRange = ln >= startLine && ln <= endLine;
        const hl = hlMap.get(ln);
        const hlClass = hl ? 'hl-' + hl.type : '';
        const rangeClass = inRange ? ' in-cell-range' : '';
        const borderClass = (ln === startLine ? ' cell-range-start' : '') + (ln === endLine ? ' cell-range-end' : '');
        const gutterClass = inRange ? ' in-range' : '';
        const ann = hl && hl.annotation ? '<span class="line-annotation">// ' + esc(hl.annotation) + '</span>' : '';
        const lineId = ln === startLine ? ' id="cell-start-line"' : '';

        ch += '<div class="code-line ' + hlClass + rangeClass + borderClass + '" data-line="' + ln + '"' + lineId + '>' +
          '<span class="line-gutter' + gutterClass + '">' + ln + '</span>' +
          '<span class="line-content">' + colorize(fullLines[i]) + ann + '</span></div>\\n';
      }
      $('status-right').textContent = fullLines.length + ' lines \\u00b7 Full file \\u00b7 Arrow keys to navigate';
    } else if (code.text) {
      // Fallback: render only the cell's snippet
      const lines = code.text.split('\\n');
      for (let i = 0; i < lines.length; i++) {
        const ln = startLine + i;
        const hl = hlMap.get(ln);
        const hc = hl ? 'hl-' + hl.type : '';
        const ann = hl && hl.annotation ? '<span class="line-annotation">// ' + esc(hl.annotation) + '</span>' : '';
        const lineId = i === 0 ? ' id="cell-start-line"' : '';
        ch += '<div class="code-line ' + hc + '" data-line="' + ln + '"' + lineId + '><span class="line-gutter">' + ln + '</span><span class="line-content">' + colorize(lines[i]) + ann + '</span></div>\\n';
      }
      $('status-right').textContent = 'Snippet only (file not found on disk)';
    } else {
      ch = '<div style="padding:32px;color:#999">No source code.</div>';
    }

    $('code-area').innerHTML = ch;

    // Scroll the cell start line into view
    requestAnimationFrame(() => {
      const el = document.getElementById('cell-start-line');
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  function renderPanel(c) {
    let h='';
    if(activeTab==='narrative'){
      h=c.narrative?'<div class="narrative-text">'+renderMd(c.narrative)+'</div>':'<div style="color:#999">No narrative.</div>';
      if(walk.description&&(activeIndex===0||c.type==='note'))h+='<div class="walk-description"><div class="desc-label">Walk Description</div><div class="desc-text">'+esc(walk.description)+'</div></div>';
      if(walk.meta&&walk.meta.tags&&walk.meta.tags.length>0&&activeIndex===0){h+='<div class="tags">';for(const t of walk.meta.tags)h+='<span class="tag">'+esc(t)+'</span>';h+='</div>';}
    } else if(activeTab==='variables'){
      if(!c.state||!c.state.scopes||!c.state.scopes.length){h='<div style="color:#999;text-align:center;padding:32px">No variables.</div>';}
      else{for(const sc of c.state.scopes){h+='<div class="scope-group"><div class="scope-name">'+esc(sc.name)+'</div>';for(const[n,v]of Object.entries(sc.variables)){const ai=ACTIONS[v.action]||'',cc=v.changed?'changed':'',ty=v.type?'<span class="var-type">'+esc(v.type)+'</span>':'';h+='<div class="var-row '+cc+'"><span class="var-action">'+ai+'</span><span class="var-name">'+esc(n)+'</span>'+ty+'<span class="var-value">'+esc(v.value)+'</span></div>';}h+='</div>';}
      if(c.state.changes&&c.state.changes.length){h+='<div class="changes-summary"><div class="changes-label">Changes</div>';for(const ch2 of c.state.changes)h+='<div class="change-item">'+esc(ch2)+'</div>';h+='</div>';}}
    } else if(activeTab==='callstack'){
      if(!c.callStack||!c.callStack.length){h='<div style="color:#999;text-align:center;padding:32px">No call stack.</div>';}
      else{const fr=[...c.callStack].reverse();h='<div class="stack-frames">';for(let i=0;i<fr.length;i++){const f=fr[i],top=i===0,fn=f.filePath.split('/').pop()||f.filePath,cid=f.cellId||'',da=cid?'data-cell-id="'+esc(cid)+'"':'';h+='<div class="stack-frame'+(top?' current':'')+'" '+da+'><span class="stack-depth">'+(top?'\\u2192':'\\u00A0')+'#'+f.depth+'</span><span class="stack-name">'+esc(f.functionName)+'</span><span class="stack-loc">'+esc(fn)+':'+f.line+'</span></div>';}h+='</div>';}
    }
    $('panel-body').innerHTML=h;
    if(activeTab==='callstack')$('panel-body').querySelectorAll('.stack-frame[data-cell-id]').forEach(el=>el.addEventListener('click',()=>{const idx=cells.findIndex(c2=>c2.id===el.dataset.cellId);if(idx>=0)goTo(idx);}));
  }

  function goTo(i){if(i<0||i>=cells.length)return;activeIndex=i;render();}
  function switchTab(t){activeTab=t;document.querySelectorAll('.panel-tab').forEach(el=>el.classList.toggle('active',el.dataset.tab===t));if(cells[activeIndex])renderPanel(cells[activeIndex]);}

  // Events
  $('btn-prev').addEventListener('click',()=>goTo(activeIndex-1));
  $('btn-next').addEventListener('click',()=>goTo(activeIndex+1));
  $('jump-input').addEventListener('keydown',e=>{if(e.key==='Enter'){const v=parseInt($('jump-input').value,10);if(!isNaN(v)&&v>=1&&v<=cells.length)goTo(v-1);$('jump-input').value='';$('jump-input').blur();}});
  document.querySelectorAll('.panel-tab').forEach(t=>t.addEventListener('click',()=>switchTab(t.dataset.tab)));
  document.addEventListener('keydown',e=>{
    if(e.target.tagName==='INPUT')return;
    if(!walk)return;
    switch(e.key){case'ArrowRight':case'j':goTo(activeIndex+1);e.preventDefault();break;case'ArrowLeft':case'k':goTo(activeIndex-1);e.preventDefault();break;case'Home':goTo(0);e.preventDefault();break;case'End':goTo(cells.length-1);e.preventDefault();break;case'1':switchTab('narrative');break;case'2':switchTab('variables');break;case'3':switchTab('callstack');break;case'g':$('jump-input').focus();$('jump-input').value='';e.preventDefault();break;}
  });

  // ---- Public API for Playwright / video generation ----
  // Exposed on window so Playwright can call: await page.evaluate(() => codewalkAPI.goToCell(3))
  const _el = id => document.getElementById(id); // alias to avoid template literal clash
  window.codewalkAPI = {
    goToCell: (i) => { goTo(i); return new Promise(r => setTimeout(r, 800)); },
    switchTab: (t) => switchTab(t),
    getCellCount: () => cells.length,
    getActiveIndex: () => activeIndex,
    getCell: (i) => cells[i] || null,
    getHighlightLines: (i) => {
      const c = cells[i ?? activeIndex];
      if (!c || !c.code.highlights) return [];
      return c.code.highlights.map(h => ({ line: h.line, type: h.type, annotation: h.annotation || '' }));
    },
    // Spotlight a single line: dims everything else, scrolls to it
    spotlightLine: (lineNum) => {
      const area = _el('code-area');
      // Remove previous spotlight
      area.querySelectorAll('.spotlight').forEach(el => el.classList.remove('spotlight'));
      if (lineNum == null) {
        area.classList.remove('has-spotlight');
        return;
      }
      area.classList.add('has-spotlight');
      const target = area.querySelector('[data-line="' + lineNum + '"]');
      if (target) {
        target.classList.add('spotlight');
        target.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    },
    // Clear spotlight (show all lines normally)
    clearSpotlight: () => {
      const area = _el('code-area');
      area.classList.remove('has-spotlight');
      area.querySelectorAll('.spotlight').forEach(el => el.classList.remove('spotlight'));
    },
    // Spotlight a range of lines (e.g. a function body)
    spotlightRange: (startLine, endLine) => {
      const area = _el('code-area');
      area.querySelectorAll('.spotlight').forEach(el => el.classList.remove('spotlight'));
      area.classList.add('has-spotlight');
      for (let ln = startLine; ln <= endLine; ln++) {
        const el = area.querySelector('[data-line="' + ln + '"]');
        if (el) el.classList.add('spotlight');
      }
      const first = area.querySelector('[data-line="' + startLine + '"]');
      if (first) first.scrollIntoView({ block: 'center', behavior: 'instant' });
    },
  };

  // Load walk from API
  (async()=>{
    try{
      const res=await fetch('/api/codewalks/'+encodeURIComponent(WALK_ID));
      if(!res.ok){$('loading').textContent='Walk not found: '+WALK_ID;return;}
      const data=await res.json();
      walk=data.walk||data;cells=walk.cells||[];
      if(!cells.length){$('loading').textContent='Walk has no cells.';return;}
      $('loading').classList.add('hidden');
      $('viewer').classList.add('active');
      $('walk-name').textContent=walk.name||walk.id;
      $('jump-input').max=cells.length;
      buildNav();render();
    }catch(err){$('loading').textContent='Error: '+err.message;}
  })();
})();
</script>
</body>
</html>`;
}
