#!/usr/bin/env python3
"""
codewalk-video: Generate a video walkthrough from a .codewalk.json code walk.

Renders each cell as a VS Code-like editor frame with syntax highlighting,
line numbers, gutter highlights, narrative overlay, and call stack panel.
Composites with podcast audio into an MP4 video.

Usage:
    python3 codewalk_video.py <walk-path> [--output video.mp4]

    walk-path: directory (v2) or .codewalk.json file (v1)
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import html as html_mod

# ---------------------------------------------------------------------------
# CSS: VS Code Dark+ inspired theme
# ---------------------------------------------------------------------------
VS_CODE_CSS = """
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: 'Segoe UI', 'Helvetica Neue', sans-serif;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Top bar */
.topbar {
  background: #2d2d30;
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  border-bottom: 1px solid #3e3e42;
  flex-shrink: 0;
}
.topbar .phase {
  color: #569cd6;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.topbar .separator {
  color: #555;
  margin: 0 12px;
}
.topbar .cell-title {
  color: #9cdcfe;
  font-size: 13px;
  font-weight: 500;
}
.topbar .cell-index {
  margin-left: auto;
  color: #666;
  font-size: 12px;
}

/* Main content area */
.main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Code panel */
.code-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* File tab bar */
.tab-bar {
  background: #252526;
  height: 36px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid #3e3e42;
  flex-shrink: 0;
}
.tab {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 0 16px;
  height: 36px;
  display: flex;
  align-items: center;
  font-size: 13px;
  border-right: 1px solid #252526;
  border-top: 2px solid #569cd6;
}
.tab .icon { color: #519aba; margin-right: 6px; }

/* Code area */
.code-area {
  flex: 1;
  overflow: hidden;
  padding: 8px 0;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace;
  font-size: 14px;
  line-height: 22px;
}

.code-line {
  display: flex;
  min-height: 22px;
  padding: 0 16px 0 0;
}

.line-gutter {
  width: 60px;
  text-align: right;
  padding-right: 16px;
  color: #858585;
  user-select: none;
  flex-shrink: 0;
}

.line-content {
  flex: 1;
  white-space: pre;
  padding-left: 8px;
}

/* Highlight types — default (dimmed when focus is active) */
.hl-executed {
  background: rgba(86, 156, 214, 0.15);
  border-left: 3px solid #569cd6;
}
.hl-called {
  background: rgba(78, 201, 176, 0.15);
  border-left: 3px solid #4ec9b0;
}
.hl-branched {
  background: rgba(206, 145, 120, 0.15);
  border-left: 3px solid #ce9178;
}
.hl-assigned {
  background: rgba(220, 220, 170, 0.15);
  border-left: 3px solid #dcdcaa;
}
.hl-returned {
  background: rgba(181, 206, 168, 0.15);
  border-left: 3px solid #b5cea8;
}
.hl-skipped {
  background: rgba(128, 128, 128, 0.1);
  border-left: 3px solid #666;
}
.no-highlight {
  border-left: 3px solid transparent;
}

/* When focus mode is active, dim all non-focused lines */
.has-focus .code-line {
  opacity: 0.4;
  transition: opacity 0.2s;
}
.has-focus .code-line.focused {
  opacity: 1.0;
  background: rgba(255, 213, 79, 0.18) !important;
  border-left: 3px solid #ffd54f !important;
  box-shadow: inset 0 0 0 1px rgba(255, 213, 79, 0.25);
}

/* Annotation tooltip */
.annotation {
  color: #6a9955;
  font-style: italic;
  margin-left: 24px;
  font-size: 12px;
  opacity: 0.9;
}

/* Right side panel */
.side-panel {
  width: 480px;
  background: #252526;
  border-left: 1px solid #3e3e42;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
}

.panel-section {
  padding: 16px;
  border-bottom: 1px solid #3e3e42;
}

.panel-title {
  color: #569cd6;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 10px;
}

/* Narrative */
.narrative {
  flex: 1;
  padding: 16px;
  overflow: hidden;
}
.narrative-text {
  color: #cccccc;
  font-size: 13.5px;
  line-height: 1.6;
}

/* Call stack */
.callstack {
  flex-shrink: 0;
}
.stack-frame {
  display: flex;
  align-items: center;
  padding: 4px 0;
  font-size: 12px;
}
.stack-frame .depth-indicator {
  color: #569cd6;
  margin-right: 6px;
  width: 16px;
  text-align: center;
}
.stack-frame .func-name {
  color: #dcdcaa;
}
.stack-frame .file-ref {
  color: #666;
  margin-left: 8px;
  font-size: 11px;
}
.stack-frame.active {
  background: rgba(86, 156, 214, 0.1);
}

/* Variables */
.variables {
  flex-shrink: 0;
  max-height: 200px;
  overflow: hidden;
}
.var-row {
  display: flex;
  padding: 3px 0;
  font-size: 12px;
  font-family: 'Cascadia Code', 'Consolas', monospace;
}
.var-name {
  color: #9cdcfe;
  min-width: 140px;
  flex-shrink: 0;
}
.var-value {
  color: #ce9178;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.var-changed {
  color: #dcdcaa;
}
.var-value.changed::before {
  content: "● ";
  color: #569cd6;
}

/* Bottom status bar */
.statusbar {
  background: #007acc;
  height: 28px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 12px;
  color: #fff;
  flex-shrink: 0;
}
.statusbar .left { flex: 1; }
.statusbar .right { text-align: right; }

/* Subtitle bar — shows current dialogue text */
.subtitle-bar {
  background: #1a1a2e;
  border-top: 2px solid #ffd54f;
  padding: 12px 24px;
  min-height: 56px;
  max-height: 80px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.subtitle-bar .speaker {
  color: #ffd54f;
  font-weight: 700;
  font-size: 14px;
  margin-right: 12px;
  flex-shrink: 0;
}
.subtitle-bar .dialogue {
  color: #e0e0e0;
  font-size: 14px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
"""


# ---------------------------------------------------------------------------
# Simple C++/C syntax colorizer (regex-based, good enough for screenshots)
# ---------------------------------------------------------------------------
CPP_KEYWORDS = set([
    'void', 'int', 'bool', 'char', 'unsigned', 'signed', 'long', 'short',
    'float', 'double', 'const', 'static', 'virtual', 'override', 'class',
    'struct', 'enum', 'namespace', 'using', 'typedef', 'typename',
    'template', 'public', 'private', 'protected', 'return', 'if', 'else',
    'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'default',
    'new', 'delete', 'nullptr', 'true', 'false', 'this', 'auto',
    'HRESULT', 'DWORD', 'BOOL', 'UINT', 'ULONG', 'SIZE_T', 'HGLOBAL',
    'STGMEDIUM', 'FORMATETC', 'IStream', 'IDataObject',
    'TYMED_ISTREAM', 'TYMED_HGLOBAL', 'TYMED_NULL', 'TYMED_ISTORAGE',
    'S_OK', 'E_NOTIMPL', 'DV_E_FORMATETC', 'SUCCEEDED', 'FAILED',
    'DCHECK', 'CHECK', 'NOTREACHED', 'TEST_F', 'EXPECT_EQ', 'EXPECT_TRUE',
    'ASSERT_EQ', 'IFACEMETHODIMP',
])

def colorize_cpp(text):
    """Simple regex-based C++ syntax coloring returning HTML spans."""
    escaped = html_mod.escape(text)

    # Order matters - do strings/comments first to avoid coloring keywords inside them
    # Comments
    escaped = re.sub(
        r'(//.*?)$',
        r'<span style="color:#6a9955">\1</span>',
        escaped, flags=re.MULTILINE
    )

    # Strings
    escaped = re.sub(
        r'(&quot;.*?&quot;|&amp;quot;)',
        r'<span style="color:#ce9178">\1</span>',
        escaped
    )
    escaped = re.sub(
        r'(".*?")',
        r'<span style="color:#ce9178">\1</span>',
        escaped
    )

    # Numbers
    escaped = re.sub(
        r'\b(\d+)\b',
        r'<span style="color:#b5cea8">\1</span>',
        escaped
    )

    # Preprocessor
    escaped = re.sub(
        r'^(\s*#\w+)',
        r'<span style="color:#c586c0">\1</span>',
        escaped, flags=re.MULTILINE
    )

    # Namespace/class qualifiers (ClassName::)
    escaped = re.sub(
        r'\b([A-Z]\w+)(::)',
        r'<span style="color:#4ec9b0">\1</span>\2',
        escaped
    )

    # Function calls (word followed by open paren)
    escaped = re.sub(
        r'\b([a-z_]\w*)\s*(\()',
        lambda m: (
            f'<span style="color:#569cd6">{m.group(1)}</span>{m.group(2)}'
            if m.group(1) in CPP_KEYWORDS
            else f'<span style="color:#dcdcaa">{m.group(1)}</span>{m.group(2)}'
        ),
        escaped
    )

    # Remaining keywords
    for kw in CPP_KEYWORDS:
        escaped = re.sub(
            rf'\b({re.escape(kw)})\b',
            rf'<span style="color:#569cd6">\1</span>',
            escaped
        )

    # -> and :: operators
    escaped = re.sub(r'(-&gt;|::)', r'<span style="color:#d4d4d4">\1</span>', escaped)

    return escaped


# ---------------------------------------------------------------------------
# HTML frame generator
# ---------------------------------------------------------------------------
def get_phase_label(cell_id, cell_type):
    """Derive a phase label from cell ID prefix."""
    if cell_id.startswith('cell-blink'):
        return 'BLINK RENDERER'
    elif cell_id.startswith('cell-pre'):
        return 'BROWSER ENTRY'
    elif cell_id.startswith('cell-bridge'):
        return 'WIN32 HANDOFF'
    elif cell_id.startswith('cell-post'):
        return 'CLEANUP'
    elif cell_type == 'note':
        return 'NOTE'
    else:
        idx = cell_id.replace('cell-', '')
        try:
            n = int(idx)
            if n <= 3:
                return 'ISTREAM STORAGE'
            elif n <= 8:
                return 'GETDATA SERVING'
            else:
                return 'TESTS'
        except ValueError:
            return 'CODE'


def truncate_narrative(text, max_chars=600):
    """Truncate narrative for the side panel."""
    # Remove markdown bold markers
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    # Remove markdown headers
    text = re.sub(r'^##?\s+', '', text, flags=re.MULTILINE)
    if len(text) > max_chars:
        text = text[:max_chars].rsplit(' ', 1)[0] + '...'
    return text


def match_segment_to_lines(segment_text, cell):
    """Match a dialogue segment to specific line numbers in a cell's code.

    Scans the segment text for function names, keywords, and terms that appear
    in the cell's highlight annotations or code text, and returns the set of
    line numbers that best match.

    Returns a set of line numbers, or None if no strong match found.
    """
    code = cell.get('code', {})
    highlights = code.get('highlights', [])
    code_text = code.get('text', '')
    start_line = code.get('startLine', 1)
    seg_lower = segment_text.lower()

    if not highlights and not code_text:
        return None

    # Strategy 1: Match against highlight annotations
    matched_lines = set()
    for hl in highlights:
        annotation = hl.get('annotation', '').lower()
        line = hl['line']

        # Extract keywords from annotation (3+ char words)
        ann_words = set(re.findall(r'[a-z_]\w{2,}', annotation))
        # Also check for class::method patterns
        ann_names = set(re.findall(r'[A-Za-z]\w+::\w+', hl.get('annotation', '')))

        # Score: how many annotation words appear in segment text
        score = sum(1 for w in ann_words if w in seg_lower)
        # Bonus for exact function name matches
        for name in ann_names:
            if name.lower() in seg_lower:
                score += 3

        if score >= 2:
            matched_lines.add(line)

    # Strategy 2: Match function/class names in code text against segment
    if not matched_lines:
        code_lines = code_text.split('\n')
        # Extract identifiers from segment
        seg_names = set(re.findall(r'[A-Z]\w+::\w+|[A-Z]\w+(?:Impl|Manager|Controller|Stream|Object|Data|Medium|Format)', segment_text))

        for i, line in enumerate(code_lines):
            line_num = start_line + i
            for name in seg_names:
                if name in line:
                    matched_lines.add(line_num)
                    # Include surrounding context (1 line above and below)
                    if i > 0:
                        matched_lines.add(line_num - 1)
                    if i < len(code_lines) - 1:
                        matched_lines.add(line_num + 1)

    # Strategy 3: Match specific terms (TYMED_ISTREAM, Clone, etc.)
    if not matched_lines:
        key_terms = re.findall(
            r'TYMED_\w+|CFSTR_\w+|HGLOBAL|GlobalAlloc|SHCreateMemStream|'
            r'DoDragDrop|SetFileContents|GetData|DuplicateMedium|QueryGetData|'
            r'EnumFormatEtc|ReleaseStgMedium|dragstart|DataTransfer|'
            r'Clone|AddRef|Seek|Read|Stat|checked_cast|UMA|histogram',
            segment_text, re.IGNORECASE
        )
        code_lines = code_text.split('\n')
        for term in key_terms:
            for i, line in enumerate(code_lines):
                if term.lower() in line.lower():
                    line_num = start_line + i
                    matched_lines.add(line_num)

    return matched_lines if matched_lines else None


def generate_cell_html(cell, cell_index, total_cells, walk_name,
                       focus_lines=None, subtitle_speaker=None, subtitle_text=None):
    """Generate a full 1920x1080 HTML page for one code walk cell.

    Args:
        focus_lines: set of line numbers to spotlight (bright highlight).
                     If provided, all other lines are dimmed.
        subtitle_speaker: speaker name for the subtitle bar (e.g. "Sarah")
        subtitle_text: dialogue text to show in the subtitle bar
    """
    cell_id = cell['id']
    cell_type = cell.get('type', 'block')
    code = cell.get('code', {})
    file_path = code.get('filePath', 'unknown')
    start_line = code.get('startLine', 1)
    code_text = code.get('text', '')
    highlights = code.get('highlights', [])
    narrative = cell.get('narrative', '')
    call_stack = cell.get('callStack', [])
    state = cell.get('state', {})

    filename = file_path.split('/')[-1]
    phase = get_phase_label(cell_id, cell_type)

    # Build highlight map: line_number -> {type, annotation}
    hl_map = {}
    for hl in highlights:
        hl_map[hl['line']] = hl

    # Build code lines HTML
    code_lines = code_text.split('\n')
    lines_html = []
    for i, line in enumerate(code_lines):
        line_num = start_line + i
        hl = hl_map.get(line_num)
        hl_class = f'hl-{hl["type"]}' if hl else 'no-highlight'
        annotation = ''
        if hl and hl.get('annotation'):
            annotation = f'<span class="annotation">// {html_mod.escape(hl["annotation"])}</span>'

        # Apply focus spotlight
        focus_cls = ''
        if focus_lines and line_num in focus_lines:
            focus_cls = ' focused'

        colored = colorize_cpp(line)
        lines_html.append(
            f'<div class="code-line {hl_class}{focus_cls}">'
            f'<span class="line-gutter">{line_num}</span>'
            f'<span class="line-content">{colored}{annotation}</span>'
            f'</div>'
        )

    code_html = '\n'.join(lines_html)

    # Build call stack HTML
    stack_html = ''
    if call_stack:
        frames = []
        for j, frame in enumerate(call_stack):
            active = 'active' if j == len(call_stack) - 1 else ''
            fn = html_mod.escape(frame.get('functionName', '?'))
            fp = frame.get('filePath', '')
            fp_short = fp.split('/')[-1] if '/' in fp else fp
            arrow = '→' if active else ' '
            frames.append(
                f'<div class="stack-frame {active}">'
                f'<span class="depth-indicator">{arrow}</span>'
                f'<span class="func-name">{fn}</span>'
                f'<span class="file-ref">{fp_short}</span>'
                f'</div>'
            )
        stack_html = '\n'.join(frames)

    # Build variables HTML
    vars_html = ''
    scopes = state.get('scopes', [])
    var_rows = []
    for scope in scopes:
        variables = scope.get('variables', {})
        for vname, vinfo in variables.items():
            if isinstance(vinfo, dict):
                val = vinfo.get('value', '?')
                changed = vinfo.get('changed', False)
            else:
                val = str(vinfo)
                changed = False
            changed_cls = 'changed' if changed else ''
            var_rows.append(
                f'<div class="var-row">'
                f'<span class="var-name">{html_mod.escape(str(vname)[:25])}</span>'
                f'<span class="var-value {changed_cls}">{html_mod.escape(str(val)[:60])}</span>'
                f'</div>'
            )
    if var_rows:
        vars_html = '\n'.join(var_rows[:6])  # Max 6 vars

    # Truncate narrative
    narr_text = truncate_narrative(narrative)
    narr_html = html_mod.escape(narr_text).replace('\n', '<br>')

    # Cell type badge
    type_colors = {
        'entry': '#569cd6', 'call': '#4ec9b0', 'branch': '#ce9178',
        'return': '#b5cea8', 'block': '#d4d4d4', 'note': '#dcdcaa'
    }
    type_color = type_colors.get(cell_type, '#d4d4d4')

    # Focus mode class
    focus_mode_cls = ' has-focus' if focus_lines else ''

    # Subtitle bar HTML
    subtitle_html = ''
    if subtitle_speaker and subtitle_text:
        sub_text = html_mod.escape(subtitle_text[:200])
        subtitle_html = f"""
<div class="subtitle-bar">
  <span class="speaker">{html_mod.escape(subtitle_speaker)}:</span>
  <span class="dialogue">{sub_text}</span>
</div>"""

    page_html = f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>{VS_CODE_CSS}</style>
</head><body>

<div class="topbar">
  <span class="phase">{phase}</span>
  <span class="separator">›</span>
  <span class="cell-title" style="color:{type_color}">[{cell_type}]</span>
  <span class="separator">›</span>
  <span class="cell-title">{html_mod.escape(cell_id)}</span>
  <span class="cell-index">Step {cell_index + 1} of {total_cells}</span>
</div>

<div class="main">
  <div class="code-panel">
    <div class="tab-bar">
      <div class="tab"><span class="icon">📄</span> {html_mod.escape(filename)}</div>
    </div>
    <div class="code-area{focus_mode_cls}">
      {code_html}
    </div>
  </div>

  <div class="side-panel">
    <div class="narrative">
      <div class="panel-title">Narrative</div>
      <div class="narrative-text">{narr_html}</div>
    </div>

    {"<div class='panel-section variables'><div class='panel-title'>Variables</div>" + vars_html + "</div>" if vars_html else ""}

    {"<div class='panel-section callstack'><div class='panel-title'>Call Stack</div>" + stack_html + "</div>" if stack_html else ""}
  </div>
</div>
{subtitle_html}
<div class="statusbar">
  <span class="left">{html_mod.escape(file_path)} : {start_line}</span>
  <span class="right">{html_mod.escape(walk_name)}</span>
</div>

</body></html>"""

    return page_html


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------
def load_walk(walk_path):
    """Load a code walk from v1 or v2 format."""
    if os.path.isdir(walk_path):
        # V2: directory with manifest + cell files
        manifest_path = os.path.join(walk_path, 'manifest.codewalk.json')
        with open(manifest_path) as f:
            manifest = json.load(f)
        walk = manifest['walk']
        cells = []
        for cell_id in walk['cellIds']:
            cell_path = os.path.join(walk_path, f'{cell_id}.json')
            with open(cell_path) as f:
                cell_data = json.load(f)
            cells.append(cell_data.get('cell', cell_data))
        return walk, cells
    else:
        # V1: single file
        with open(walk_path) as f:
            data = json.load(f)
        walk = data['walk']
        cells = walk.get('cells', [])
        return walk, cells


def get_audio_duration(audio_path):
    """Get duration of an audio file in seconds using ffprobe."""
    result = subprocess.run(
        ['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
         '-of', 'csv=p=0', audio_path],
        capture_output=True, text=True
    )
    try:
        return float(result.stdout.strip())
    except (ValueError, AttributeError):
        return 8.0  # default 8 seconds


def generate_podcast_segments(cells, walk_name, output_dir):
    """Generate TTS audio for each cell's narrative and return durations."""
    voices = {
        'Sarah': 'en-US-AvaNeural',
        'Michael': 'en-US-AndrewNeural',
    }

    durations = []
    for i, cell in enumerate(cells):
        narrative = cell.get('narrative', '')
        if not narrative:
            narrative = f"Step {i+1}: {cell.get('id', 'unknown')}"

        # Truncate for TTS (keep it to ~30 seconds per cell)
        narrative = truncate_narrative(narrative, max_chars=500)
        # Remove markdown formatting
        narrative = re.sub(r'\*\*(.+?)\*\*', r'\1', narrative)
        narrative = re.sub(r'`(.+?)`', r'\1', narrative)
        narrative = re.sub(r'\[(.+?)\]\(.+?\)', r'\1', narrative)

        # Alternate voices for variety
        voice_name = 'Sarah' if i % 2 == 0 else 'Michael'
        voice = voices[voice_name]

        audio_path = os.path.join(output_dir, f'narration_{i:03d}.mp3')

        if not os.path.exists(audio_path):
            subprocess.run([
                'edge-tts', '--voice', voice,
                '--rate', '+5%',
                '--text', narrative,
                '--write-media', audio_path
            ], capture_output=True, timeout=60)

        duration = get_audio_duration(audio_path)
        durations.append(duration)
        print(f'  [{i+1:2d}/{len(cells)}] {cell.get("id","?"):16s}  {duration:.1f}s  {voice_name}')

    return durations


def parse_podcast_script(script_path):
    """Parse a [Speaker] formatted podcast script into segments."""
    with open(script_path, 'r') as f:
        text = f.read()
    parts = re.split(r'\[(\w+)\]\s*', text)
    segments = []
    for i in range(1, len(parts), 2):
        line = parts[i + 1].strip()
        if line:
            segments.append({'speaker': parts[i], 'text': line})
    return segments


def auto_map_segments_to_cells(segments, cells):
    """Automatically map podcast segments to cells by matching content keywords.

    For each cell, builds a set of keywords from its narrative, code filePath,
    function names in callStack, and cell ID. Then scans segments in order,
    assigning each segment to the cell whose keywords best match the segment text.
    Segments are assigned greedily in cell order — once we advance past a cell,
    we don't go back.

    Returns a list of (seg_start, seg_end, cell_id) tuples.
    """
    # Build keyword sets per cell
    cell_keywords = []
    for cell in cells:
        kw = set()
        cid = cell.get('id', '')
        narrative = cell.get('narrative', '')
        code = cell.get('code', {})
        file_path = code.get('filePath', '')
        call_stack = cell.get('callStack', [])

        # Extract function/class names from narrative
        for match in re.findall(r'[A-Z]\w+::\w+|\b[A-Z]\w+(?:Impl|Manager|Controller|Handler)\b', narrative):
            kw.add(match.lower())
        # Extract key terms
        for match in re.findall(r'`(\w+)`|\b(TYMED_\w+|CFSTR_\w+|HGLOBAL|ISTREAM|ISTORAGE|DoDragDrop|SetFileContents|GetData|DuplicateMedium|QueryGetData|EnumFormatEtc|ReleaseStgMedium|SHCreateMemStream|DataTransfer|dragstart|DropData|DataObject)\b', narrative, re.IGNORECASE):
            for m in match:
                if m:
                    kw.add(m.lower())

        # File name
        if file_path:
            fname = file_path.split('/')[-1].replace('.cc', '').replace('.h', '')
            kw.add(fname.lower())

        # Call stack function names
        for frame in call_stack:
            fn = frame.get('functionName', '')
            if '::' in fn:
                kw.add(fn.split('::')[-1].lower())
            kw.add(fn.lower())

        cell_keywords.append(kw)

    # Score each segment against each cell
    def score_segment(seg_text, kw_set):
        text_lower = seg_text.lower()
        return sum(1 for k in kw_set if k and k in text_lower)

    # Greedy forward assignment: walk through segments, assign to best-matching
    # cell, but only advance cell index forward (never backward)
    mapping = []
    cell_idx = 0
    seg_idx = 0
    n_cells = len(cells)
    n_segs = len(segments)

    while cell_idx < n_cells and seg_idx < n_segs:
        # Find the range of segments that belong to this cell
        start = seg_idx

        # Score upcoming segments against current cell and next cell
        while seg_idx < n_segs:
            current_score = score_segment(segments[seg_idx]['text'], cell_keywords[cell_idx])
            next_score = 0
            if cell_idx + 1 < n_cells:
                next_score = score_segment(segments[seg_idx]['text'], cell_keywords[cell_idx + 1])

            # Stay with current cell if it scores better, or if next cell doesn't score
            if current_score >= next_score or next_score == 0:
                seg_idx += 1
            else:
                # But ensure at least 1 segment per cell
                if seg_idx == start:
                    seg_idx += 1
                break

        if seg_idx > start:
            mapping.append((start, seg_idx, cells[cell_idx]['id']))

        cell_idx += 1

    # Assign remaining segments to last cell
    if seg_idx < n_segs and mapping:
        last_start, last_end, last_cid = mapping[-1]
        mapping[-1] = (last_start, n_segs, last_cid)
    elif seg_idx < n_segs:
        mapping.append((seg_idx, n_segs, cells[-1]['id']))

    # Assign remaining cells with no segments
    assigned_cells = {m[2] for m in mapping}
    for cell in cells:
        if cell['id'] not in assigned_cells:
            mapping.append((0, 0, cell['id']))  # empty range = 3s minimum

    return mapping


def generate_aligned_audio_and_durations(segments, mapping, cell_ids, tmpdir):
    """Generate TTS for segments, build audio ordered by cell, return per-cell durations."""
    voices = {'Sarah': 'en-US-AvaNeural', 'Michael': 'en-US-AndrewNeural'}
    silence_gap = 0.3

    # Generate TTS for every segment
    print('  Generating TTS for segments...')
    seg_paths = []
    for i, seg in enumerate(segments):
        voice = voices.get(seg['speaker'], 'en-US-AvaNeural')
        outfile = os.path.join(tmpdir, f'seg_{i:03d}.mp3')
        if not os.path.exists(outfile):
            subprocess.run([
                'edge-tts', '--voice', voice, '--rate', '+5%',
                '--text', seg['text'], '--write-media', outfile
            ], capture_output=True, timeout=60)
        seg_paths.append(outfile)

    seg_durations = [get_audio_duration(p) for p in seg_paths]

    # Build silence files
    silence_path = os.path.join(tmpdir, 'silence.mp3')
    subprocess.run([
        'ffmpeg', '-y', '-f', 'lavfi',
        '-i', 'anullsrc=channel_layout=mono:sample_rate=24000',
        '-t', str(silence_gap), '-c:a', 'libmp3lame', '-b:a', '48k', silence_path
    ], capture_output=True)
    silence_3s = os.path.join(tmpdir, 'silence_3s.mp3')
    subprocess.run([
        'ffmpeg', '-y', '-f', 'lavfi',
        '-i', 'anullsrc=channel_layout=mono:sample_rate=24000',
        '-t', '3.0', '-c:a', 'libmp3lame', '-b:a', '48k', silence_3s
    ], capture_output=True)

    # Build concat list in cell order + compute per-cell durations
    concat_lines = []
    cell_durations = []

    for cid in cell_ids:
        # Find all segments mapped to this cell
        cell_segs = []
        for (start, end, map_cid) in mapping:
            if map_cid == cid:
                for si in range(start, end):
                    if si < len(seg_paths):
                        cell_segs.append(si)

        dur = 0.0
        if cell_segs:
            for si in cell_segs:
                concat_lines.append(f"file '{seg_paths[si]}'")
                concat_lines.append(f"file '{silence_path}'")
                dur += seg_durations[si] + silence_gap
        else:
            concat_lines.append(f"file '{silence_3s}'")
            dur = 3.0

        cell_durations.append(dur)
        print(f'  {cid:16s}  {dur:6.1f}s  ({len(cell_segs)} segments)')

    # Concatenate into final audio
    concat_path = os.path.join(tmpdir, 'audio_concat.txt')
    with open(concat_path, 'w') as f:
        f.write('\n'.join(concat_lines))

    audio_path = os.path.join(tmpdir, 'aligned_audio.mp3')
    subprocess.run([
        'ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', concat_path,
        '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '24000', '-ac', '1',
        audio_path
    ], capture_output=True)

    return audio_path, cell_durations


def main():
    if len(sys.argv) < 2:
        print(f'Usage: {sys.argv[0]} <walk-path> [--output video.mp4] [--with-podcast-script script.txt] [--segment-map map.json]')
        sys.exit(1)

    walk_path = sys.argv[1]
    output_path = None
    script_path = None
    segment_map_path = None

    # Parse args
    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == '--output' and i + 1 < len(args):
            output_path = args[i + 1]; i += 2
        elif args[i] == '--with-podcast-script' and i + 1 < len(args):
            script_path = args[i + 1]; i += 2
        elif args[i] == '--segment-map' and i + 1 < len(args):
            segment_map_path = args[i + 1]; i += 2
        elif args[i] == '--with-podcast' and i + 1 < len(args):
            # Legacy flag — look for podcast-script.txt alongside
            podcast_mp3 = args[i + 1]
            candidate = podcast_mp3.replace('.mp3', '-script.txt')
            if not os.path.exists(candidate):
                candidate = os.path.join(os.path.dirname(podcast_mp3), 'podcast-script.txt')
            if os.path.exists(candidate):
                script_path = candidate
            i += 2
        else:
            i += 1

    if not output_path:
        if os.path.isdir(walk_path):
            output_path = os.path.join(walk_path, 'video.mp4')
        else:
            output_path = walk_path.replace('.codewalk.json', '.video.mp4')

    # Auto-discover podcast script if not provided
    if not script_path:
        candidates = [
            os.path.join(walk_path, 'podcast-script.txt') if os.path.isdir(walk_path) else None,
            walk_path.replace('.codewalk.json', '.podcast-script.txt') if not os.path.isdir(walk_path) else None,
        ]
        for c in candidates:
            if c and os.path.exists(c):
                script_path = c
                break

    print(f'Loading walk from: {walk_path}')
    walk, cells = load_walk(walk_path)
    walk_name = walk.get('name', 'Code Walk')
    cell_ids = [c['id'] for c in cells]
    print(f'Walk: {walk_name}')
    print(f'Cells: {len(cells)}')

    with tempfile.TemporaryDirectory(prefix='codewalk-video-') as tmpdir:
        # Step 1: Build audio and get segment info
        segments = None
        mapping = None
        seg_paths = None
        seg_durations = None

        if script_path and os.path.exists(script_path):
            print(f'\n--- Using podcast script: {script_path} ---')
            segments = parse_podcast_script(script_path)
            print(f'  Parsed {len(segments)} dialogue segments')

            if segment_map_path and os.path.exists(segment_map_path):
                with open(segment_map_path) as f:
                    mapping = [tuple(m) for m in json.load(f)]
                print(f'  Loaded segment map from {segment_map_path}')
            else:
                print(f'  Auto-mapping segments to cells...')
                mapping = auto_map_segments_to_cells(segments, cells)

            print(f'\n--- Building aligned audio ({len(segments)} segments → {len(cells)} cells) ---')
            audio_source, durations = generate_aligned_audio_and_durations(
                segments, mapping, cell_ids, tmpdir
            )

            # Also compute per-segment durations for sub-frame timing
            voices = {'Sarah': 'en-US-AvaNeural', 'Michael': 'en-US-AndrewNeural'}
            seg_paths = []
            for si in range(len(segments)):
                seg_paths.append(os.path.join(tmpdir, f'seg_{si:03d}.mp3'))
            seg_durations = [get_audio_duration(p) for p in seg_paths]
        else:
            print('\n--- Generating per-cell narration ---')
            durations = generate_podcast_segments(cells, walk_name, tmpdir)
            durations = [d + 0.5 for d in durations]

            silence_path = os.path.join(tmpdir, 'silence.mp3')
            subprocess.run([
                'ffmpeg', '-y', '-f', 'lavfi',
                '-i', 'anullsrc=channel_layout=mono:sample_rate=24000',
                '-t', '0.3', '-c:a', 'libmp3lame', '-b:a', '48k',
                silence_path
            ], capture_output=True)

            concat_lines = []
            for i in range(len(cells)):
                narr_path = os.path.join(tmpdir, f'narration_{i:03d}.mp3')
                concat_lines.append(f"file '{narr_path}'")
                concat_lines.append(f"file '{silence_path}'")

            concat_path = os.path.join(tmpdir, 'audio_concat.txt')
            with open(concat_path, 'w') as f:
                f.write('\n'.join(concat_lines))

            audio_source = os.path.join(tmpdir, 'full_audio.mp3')
            subprocess.run([
                'ffmpeg', '-y', '-f', 'concat', '-safe', '0',
                '-i', concat_path,
                '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '24000', '-ac', '1',
                audio_source
            ], capture_output=True)

        total_dur = sum(durations)
        print(f'\n  Total audio: {total_dur:.0f}s ({total_dur/60:.1f} min)')

        # Step 2: Render sub-frames with per-segment focus highlights
        print('\n--- Rendering frames with focus highlights ---')
        from playwright.sync_api import sync_playwright

        silence_gap = 0.3
        # Build the list of (png_path, duration) for the final concat
        frame_entries = []  # list of (png_path, duration_seconds)
        frame_counter = 0

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={'width': 1920, 'height': 1080})

            for ci, cell in enumerate(cells):
                cid = cell['id']

                # Find segments mapped to this cell
                cell_segs = []
                if mapping and segments:
                    for (start, end, map_cid) in mapping:
                        if map_cid == cid:
                            for si in range(start, end):
                                if si < len(segments):
                                    cell_segs.append(si)

                if cell_segs and seg_durations:
                    # Render one sub-frame per segment with focus highlight
                    for seg_idx in cell_segs:
                        seg = segments[seg_idx]
                        focus_lines = match_segment_to_lines(seg['text'], cell)

                        html_content = generate_cell_html(
                            cell, ci, len(cells), walk_name,
                            focus_lines=focus_lines,
                            subtitle_speaker=seg['speaker'],
                            subtitle_text=seg['text']
                        )

                        html_path = os.path.join(tmpdir, f'frame_{frame_counter:04d}.html')
                        png_path = os.path.join(tmpdir, f'frame_{frame_counter:04d}.png')

                        with open(html_path, 'w') as f:
                            f.write(html_content)

                        page.goto(f'file://{html_path}')
                        page.wait_for_timeout(100)
                        page.screenshot(path=png_path)

                        dur = seg_durations[seg_idx] + silence_gap
                        frame_entries.append((png_path, dur))
                        focus_desc = f'{len(focus_lines)} lines' if focus_lines else 'all'
                        print(f'  [{frame_counter+1:3d}] {cid:16s}  seg={seg_idx:2d}  {dur:5.1f}s  focus={focus_desc}  [{seg["speaker"]}]')
                        frame_counter += 1
                else:
                    # No segments — render one static frame (no focus, no subtitle)
                    html_content = generate_cell_html(cell, ci, len(cells), walk_name)
                    html_path = os.path.join(tmpdir, f'frame_{frame_counter:04d}.html')
                    png_path = os.path.join(tmpdir, f'frame_{frame_counter:04d}.png')

                    with open(html_path, 'w') as f:
                        f.write(html_content)

                    page.goto(f'file://{html_path}')
                    page.wait_for_timeout(100)
                    page.screenshot(path=png_path)

                    dur = durations[ci] if ci < len(durations) else 3.0
                    frame_entries.append((png_path, dur))
                    print(f'  [{frame_counter+1:3d}] {cid:16s}  static  {dur:5.1f}s')
                    frame_counter += 1

            browser.close()

        print(f'\n  Total frames: {frame_counter}')

        # Step 3: Composite video
        print('\n--- Compositing video ---')
        img_concat_lines = []
        for png_path, dur in frame_entries:
            img_concat_lines.append(f"file '{png_path}'")
            img_concat_lines.append(f"duration {dur:.3f}")
        # Repeat last frame
        img_concat_lines.append(f"file '{frame_entries[-1][0]}'")

        img_concat_path = os.path.join(tmpdir, 'img_concat.txt')
        with open(img_concat_path, 'w') as f:
            f.write('\n'.join(img_concat_lines))

        result = subprocess.run([
            'ffmpeg', '-y',
            '-f', 'concat', '-safe', '0', '-i', img_concat_path,
            '-i', audio_source,
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k',
            '-shortest',
            '-movflags', '+faststart',
            output_path
        ], capture_output=True, text=True)

        if result.returncode != 0:
            print(f'ffmpeg error: {result.stderr[-500:]}')
            sys.exit(1)

    # Report
    file_size = os.path.getsize(output_path)
    duration = get_audio_duration(output_path)
    print(f'\n--- Done ---')
    print(f'Output: {output_path}')
    print(f'Duration: {duration:.0f}s ({duration/60:.1f} min)')
    print(f'Size: {file_size // (1024*1024)} MB')
    print(f'Frames: {frame_counter} sub-frames across {len(cells)} cells')


if __name__ == '__main__':
    main()
