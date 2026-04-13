---
name: codewalk-video
description: "Use this skill when the user asks to 'create a video', 'generate video walkthrough',
  'make a code video', 'video from code walk', 'screen recording', 'code walkthrough video',
  'codewalk video', 'mp4 walkthrough', 'visual walkthrough', 'record code walk',
  or when they want to generate a video (MP4) showing code walk cells as VS Code-like
  editor frames with syntax highlighting, annotations, call stacks, and narration."
---

# Code Walk Video — Generate Visual MP4 Walkthrough

Generate a professional video walkthrough (MP4) from a code walk. Each cell is rendered as a
VS Code Dark+-themed editor frame with syntax highlighting, line-level gutter highlights,
annotation tooltips, a narrative side panel, call stack panel, and variable state display.
Frames are composited with TTS narration or an existing podcast MP3 into a final video.

## When to Use

- User has an existing code walk (v1 `.codewalk.json` or v2 directory)
- User wants a video version of a code walk for presentations, onboarding, or review
- User asks for "video", "mp4", "screen recording", "visual walkthrough"

## Prerequisites

- `/usr/bin/python3` with `playwright` package (Python Playwright)
- Chromium browser installed for Playwright (`playwright install chromium`)
- `ffmpeg` on PATH
- `edge-tts` for narration generation (if no existing podcast audio)

## Procedure

### Step 1: Find the Code Walk

Locate the walk at `.vscode/code-graph/codewalks/`. It may be:
- **V2 (directory):** `manifest.codewalk.json` + `<cell-id>.json` files
- **V1 (single file):** `<walk-id>.codewalk.json`

### Step 2: Run the Video Generator

The video generator script is at:
```
~/src/code-graph/skills/codegraph-codewalk-video/codewalk_video.py
```

**With podcast script (recommended — aligns dialogue segments to cells):**
```bash
/usr/bin/python3 ~/src/code-graph/skills/codegraph-codewalk-video/codewalk_video.py \
  <walk-path> \
  --with-podcast-script <walk-path>/podcast-script.txt \
  --output <walk-path>/video.mp4
```

The script automatically:
1. Parses the `[Speaker] dialogue` segments from the podcast script
2. Auto-maps each dialogue segment to the correct code walk cell by matching
   function names, class names, and keywords from cell narratives
3. Generates TTS audio per segment (Sarah → en-US-AvaNeural, Michael → en-US-AndrewNeural)
4. Groups segment audio by cell to compute exact per-cell durations
5. Composites video frames with durations exactly matching the audio

**With explicit segment mapping (for precise control):**
```bash
/usr/bin/python3 ~/src/code-graph/skills/codegraph-codewalk-video/codewalk_video.py \
  <walk-path> \
  --with-podcast-script <walk-path>/podcast-script.txt \
  --segment-map <walk-path>/segment-map.json \
  --output <walk-path>/video.mp4
```

The segment map is a JSON array of `[seg_start, seg_end, cell_id]` tuples that
explicitly controls which dialogue segments appear during which cell's frame.

**Without podcast (generates per-cell narration automatically):**
```bash
/usr/bin/python3 ~/src/code-graph/skills/codegraph-codewalk-video/codewalk_video.py \
  <walk-path> \
  --output <walk-path>/video.mp4
```

**Auto-discovery:** If `podcast-script.txt` exists alongside the walk, it's used
automatically — no `--with-podcast-script` flag needed.

### Step 3: Verify Output

Check the output file exists and has reasonable size/duration:
```bash
ls -lh <walk-path>/video.mp4
ffprobe -v quiet -show_entries format=duration -of csv=p=0 <walk-path>/video.mp4
```

## What the Video Looks Like

Each frame is a 1920x1080 image rendered to look like VS Code:

```
┌──────────────────────────────────────────────────────────────┐
│ BLINK RENDERER › [entry] › cell-blink-0     Step 1 of 25    │  ← Top bar (phase + cell ID)
├──────────────────────────────────────────┬───────────────────┤
│ 📄 mouse_event_manager.cc               │                   │  ← File tab
├──────────────────────────────────────────┤   NARRATIVE       │
│  883│ DragHandlingResult MouseEvent...   │                   │
│  884│   const MouseEventWithHitTest...   │   Explains what   │  ← Side panel with
│▎ 886│   DCHECK(event.Event()...          │   this code does  │     narrative text
│  887│   ...                              │   and why         │
│▎ 895│   if (mouse_down_may_start_drag_)  │                   │
│  ...│   ...                              ├───────────────────┤
│▎ 937│   const bool drag_started = ...    │   VARIABLES       │  ← Variable state
│                                          │   drag_type_ = .. │
│                                          ├───────────────────┤
│                                          │   CALL STACK      │  ← Call stack
│                                          │   → HandleDrag    │
├──────────────────────────────────────────┴───────────────────┤
│ mouse_event_manager.cc : 883              CL 7566722: ...    │  ← Status bar
└──────────────────────────────────────────────────────────────┘
```

### Visual Features

- **Syntax highlighting** — C++ keywords (blue), strings (orange), numbers (green), comments (green italic), class names (teal), function calls (yellow)
- **Gutter highlights** — Color-coded left border per highlight type:
  - 🔵 `executed` — blue
  - 🟢 `called` — teal
  - 🟠 `branched` — orange
  - 🟡 `assigned` — yellow
  - 🟩 `returned` — green
  - ⬜ `skipped` — gray
- **Inline annotations** — Green italic comments showing what each highlighted line does
- **Phase labels** — Top bar shows which phase of the walk (BLINK RENDERER, BROWSER ENTRY, ISTREAM STORAGE, etc.)
- **Step counter** — "Step N of M" in top-right

## Output

- **Format:** MP4 (H.264 video + AAC audio)
- **Resolution:** 1920×1080 (Full HD)
- **Typical duration:** Matches podcast audio (~15 minutes for 25 cells)
- **Typical size:** 30-80 MB depending on duration

## Important Notes

- The script uses `/usr/bin/python3` (system Python) because Playwright requires it
- If using `--with-podcast`, the podcast duration is divided equally across cells
- Without `--with-podcast`, each cell gets its own TTS narration with alternating voices
- Temporary files are cleaned up automatically (uses `tempfile.TemporaryDirectory`)
- The video is optimized for playback with `-movflags +faststart`
