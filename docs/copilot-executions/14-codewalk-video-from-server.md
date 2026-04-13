# 14 - CodeWalk Video with TTS and Sub-Cell Spotlight

**Date**: 2026-04-11 00:00 UTC
**Prompt**: "I want TTS narration also with codewalkthrough. Also I want to highlight even small parts within a cell like a function call or a line"

## 1. Code Reading & Analysis
- Read `packages/server/src/rest/codewalk-viewer.ts` — viewer page HTML/CSS/JS, code rendering, line highlighting
- Read `skills/codegraph-codewalk-video/codewalk_video.py` — existing Python video generator with focus-line support and TTS
- Read existing `tools/codewalk-video.js` — previous version without TTS or sub-cell highlighting

## 2. Issues Identified
- Video script showed all highlights at once per cell — no way to step through individual lines
- No TTS narration — video was silent
- Viewer page had no "spotlight" mode — couldn't dim everything except one line

## 3. Plan
Three changes:
1. **Add spotlight CSS + JS API to the viewer page** — `window.codewalkAPI.spotlightLine(lineNum)` dims all code except the target line (gold highlight), scrolls it into view
2. **Add `data-line` attributes** to code-line divs so lines can be targeted
3. **Rewrite video script** with: edge-tts narration per cell, sub-cell stepping through each highlight, audio-synced frame timing, ffmpeg compositing with audio track

## 4. Changes Made

### `packages/server/src/rest/codewalk-viewer.ts`
- Added spotlight CSS: `.code-area.has-spotlight .code-line` dims to 25% opacity, `.spotlight` gets gold highlight (#ffd54f) at full opacity
- Added `data-line` attribute to every `<div class="code-line">` for targeting
- Added `window.codewalkAPI` object exposing:
  - `goToCell(i)` — navigate to cell (async, returns after render)
  - `switchTab(t)` — switch right panel tab
  - `getCellCount()` / `getActiveIndex()` / `getCell(i)`
  - `getHighlightLines(i)` — returns `[{line, type, annotation}]` for a cell
  - `spotlightLine(lineNum)` — spotlight one line, dim everything else, scroll to it
  - `clearSpotlight()` — remove spotlight, show all normally
  - `spotlightRange(start, end)` — spotlight a range of lines

### `tools/codewalk-video.js`
- Complete rewrite with TTS + sub-cell spotlight
- Uses `edge-tts` for narration (free, offline after install, no API key)
- For each cell: generates TTS audio → calculates duration → divides by highlight count → steps through each highlight with spotlight → screenshots each
- Extra tab screenshots after highlights (optional)
- Concatenates all narration audio with gaps + tab silence
- ffmpeg composites image sequence + audio → MP4

## 5. Commands Run
- `npx tsc --noEmit -p packages/server/tsconfig.json` — passed
- `npm run build --workspace=packages/server` — built successfully

## 6. Result
Two features added:
1. **Spotlight API** on the viewer page — Playwright (or any automation) can call `codewalkAPI.spotlightLine(51)` to focus a specific line
2. **Video generator** with TTS narration and per-highlight-line stepping

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `packages/server/src/rest/codewalk-viewer.ts` | Modified | Added spotlight CSS, data-line attrs, window.codewalkAPI |
| `tools/codewalk-video.js` | Rewritten | TTS narration + sub-cell spotlight video generator |
| `docs/copilot-executions/14-codewalk-video-from-server.md` | Created | This execution log |
