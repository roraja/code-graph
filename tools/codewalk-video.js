#!/usr/bin/env node
/**
 * codewalk-video — Generate a narrated walkthrough video from a codewalk.
 *
 * Uses the live codegraph server viewer + Playwright + edge-tts + ffmpeg.
 *
 * Features:
 *   - Full file shown with cell range highlighted
 *   - **Podcast mode**: reads cell.podcast[] segments with per-segment
 *     spotlight cues and alternating speaker voices (2-person dialogue)
 *   - **Fallback mode**: if no podcast[], steps through highlights with
 *     single-voice TTS of the narrative
 *   - Audio-synced frame timing
 *
 * Prerequisites:
 *   npm install playwright
 *   pip install edge-tts
 *   ffmpeg in PATH
 *
 * Usage:
 *   # Generate podcast dialogue first:
 *   node tools/codewalk-podcast-gen.js <walk-id> --port 3018
 *
 *   # Then generate the video:
 *   node tools/codewalk-video.js <walk-id> --port 3018
 *
 * Options:
 *   --port <port>         Server port (default: 3018)
 *   --output <path>       Output video path (default: <walk-id>.mp4)
 *   --width <px>          Viewport width (default: 1920)
 *   --height <px>         Viewport height (default: 1080)
 *   --voice <voice>       TTS voice for fallback (default: en-US-AndrewNeural)
 *   --voice1 <voice>      TTS voice for speaker 1 (default: en-US-AvaNeural)
 *   --voice2 <voice>      TTS voice for speaker 2 (default: en-US-AndrewNeural)
 *   --no-tts              Skip TTS, use fixed duration per segment
 *   --delay <ms>          Fallback ms per segment when no TTS (default: 4000)
 *   --start-server        Auto-start a light server
 */

const { execSync, spawn } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync, statSync, rmSync } = require('node:fs');
const { resolve, join } = require('node:path');

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
if (!args.length || args[0] === '--help' || args[0] === '-h') {
  console.log(`
Usage: node tools/codewalk-video.js <walk-id> [options]

Options:
  --port <port>       Server port (default: 3018)
  --output <path>     Output file (default: <walk-id>.mp4)
  --width <px>        Viewport width (default: 1920)
  --height <px>       Viewport height (default: 1080)
  --voice1 <voice>    Speaker 1 voice (default: en-US-AvaNeural)
  --voice2 <voice>    Speaker 2 voice (default: en-US-AndrewNeural)
  --no-tts            Skip narration, use --delay per segment
  --delay <ms>        Ms per segment w/o TTS (default: 4000)
  --start-server      Auto-launch light server
  `);
  process.exit(0);
}

const walkId = args[0];
function opt(n, d) { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; }
function flag(n) { return args.includes('--' + n); }

const port = +opt('port', '3018');
const host = opt('host', '127.0.0.1');
const output = opt('output', `${walkId}.mp4`);
const W = +opt('width', '1920');
const H = +opt('height', '1080');
const voice1 = opt('voice1', 'en-US-AvaNeural');     // Sarah
const voice2 = opt('voice2', 'en-US-AndrewNeural');   // Michael
const voiceFallback = opt('voice', 'en-US-AndrewNeural');
const noTts = flag('no-tts');
const fallbackDelay = +opt('delay', '4000');
const doStartServer = flag('start-server');
const baseUrl = `http://${host}:${port}`;
const tmpDir = resolve(`.codewalk-video-${Date.now()}`);

// Map speaker names to voices (case-insensitive matching)
const voiceMap = {};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n🎬 CodeWalk Video Generator (podcast mode)`);
  console.log(`   Walk:     ${walkId}`);
  console.log(`   Server:   ${baseUrl}`);
  console.log(`   Size:     ${W}x${H}`);
  console.log(`   Voices:   ${noTts ? '(disabled)' : voice1 + ' / ' + voice2}`);
  console.log(`   Output:   ${output}\n`);

  // Check deps
  try { execSync('ffmpeg -version', { stdio: 'pipe' }); } catch {
    console.error('❌ ffmpeg not found'); process.exit(1);
  }
  if (!noTts) {
    try { execSync('edge-tts --help', { stdio: 'pipe' }); } catch {
      console.error('❌ edge-tts not found. Install: pip install edge-tts'); process.exit(1);
    }
  }

  mkdirSync(tmpDir, { recursive: true });

  // Optionally start server
  let serverProc = null;
  if (doStartServer) {
    console.log('🔧 Starting light server...');
    serverProc = spawn('codegraph', ['serve', '--port', String(port), '--host', host], {
      stdio: 'pipe', cwd: process.cwd(),
    });
    await waitFor(`${baseUrl}/api/health`, 15000);
    console.log('✔ Server ready\n');
  }

  try {
    // Fetch walk
    const walkRes = await fetch(`${baseUrl}/api/codewalks/${encodeURIComponent(walkId)}`);
    if (!walkRes.ok) { console.error(`❌ Walk not found: ${walkId}`); process.exit(1); }
    const walkData = await walkRes.json();
    const walk = walkData.walk || walkData;
    const cellCount = walk.cells?.length || 0;
    console.log(`📖 ${walk.name} — ${cellCount} cells`);

    // Check if podcast segments exist
    const hasPodcast = walk.cells.some(c => c.podcast && c.podcast.length > 0);
    console.log(`🎙️  Mode: ${hasPodcast ? 'Podcast (2-person dialogue)' : 'Narrative (single voice fallback)'}\n`);

    // Build voice map from speakers found in podcast data
    if (hasPodcast) {
      const speakers = new Set();
      for (const c of walk.cells) {
        for (const seg of (c.podcast || [])) speakers.add(seg.speaker);
      }
      const speakerList = [...speakers];
      if (speakerList.length >= 1) voiceMap[speakerList[0].toLowerCase()] = voice1;
      if (speakerList.length >= 2) voiceMap[speakerList[1].toLowerCase()] = voice2;
      console.log(`   Voice map: ${speakerList.map((s, i) => s + ' → ' + (i === 0 ? voice1 : voice2)).join(', ')}\n`);
    }

    // Build the segment plan: [{cellIdx, speaker, text, spotlight, spotlightRange}]
    const plan = [];
    for (let ci = 0; ci < cellCount; ci++) {
      const cell = walk.cells[ci];

      if (cell.podcast && cell.podcast.length > 0) {
        // Podcast mode: use the pre-generated dialogue segments
        for (const seg of cell.podcast) {
          plan.push({
            cellIdx: ci,
            speaker: seg.speaker,
            text: seg.text,
            spotlight: seg.spotlight ?? null,
            spotlightRange: seg.spotlightRange ?? null,
          });
        }
      } else {
        // Fallback: split narrative across highlights
        const highlights = cell.code.highlights || [];
        if (highlights.length > 0) {
          for (const hl of highlights) {
            plan.push({
              cellIdx: ci,
              speaker: null, // use fallback voice
              text: hl.annotation || `Line ${hl.line}`,
              spotlight: hl.line,
              spotlightRange: null,
            });
          }
        } else {
          plan.push({
            cellIdx: ci,
            speaker: null,
            text: cell.narrative ? cell.narrative.substring(0, 300) : `Step ${ci + 1}`,
            spotlight: cell.code.startLine,
            spotlightRange: null,
          });
        }
      }
    }

    console.log(`📋 Plan: ${plan.length} segments across ${cellCount} cells\n`);

    // Step 1: Generate TTS audio per segment
    const segDurations = [];
    if (!noTts) {
      console.log('🔊 Generating TTS audio...');
      for (let si = 0; si < plan.length; si++) {
        const seg = plan[si];
        const voiceName = seg.speaker
          ? (voiceMap[seg.speaker.toLowerCase()] || voice1)
          : voiceFallback;

        let text = seg.text;
        text = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
        // Remove code blocks, markdown, and characters that break shell escaping
        text = text.replace(/```[\s\S]*?```/g, '').replace(/[`$\\]/g, '');
        text = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > 500) text = text.substring(0, 500) + '...';

        const audioPath = join(tmpDir, `seg_${String(si).padStart(4, '0')}.mp3`);
        execSync(`edge-tts --voice "${voiceName}" --rate "+5%" --text ${JSON.stringify(text)} --write-media "${audioPath}"`, {
          stdio: 'pipe', timeout: 60000,
        });
        const dur = getAudioDuration(audioPath);
        segDurations.push(dur);

        const spkLabel = (seg.speaker || 'Narrator').padEnd(10);
        const spotLabel = seg.spotlight ? `L${seg.spotlight}` : seg.spotlightRange ? `L${seg.spotlightRange[0]}-${seg.spotlightRange[1]}` : '';
        console.log(`  [${String(si + 1).padStart(3)}/${plan.length}] ${spkLabel} ${spotLabel.padEnd(10)} ${dur.toFixed(1)}s  ${text.substring(0, 60)}...`);
      }
      console.log(`  Total: ${segDurations.reduce((a, b) => a + b, 0).toFixed(0)}s\n`);
    } else {
      for (let si = 0; si < plan.length; si++) segDurations.push(fallbackDelay / 1000);
    }

    // Step 2: Launch Playwright and capture frames
    console.log('🌐 Launching browser...');
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: W, height: H } });

    await page.goto(`${baseUrl}/codewalks/${encodeURIComponent(walkId)}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#viewer.active', { timeout: 15000 });
    await page.waitForFunction(() => window.codewalkAPI && window.codewalkAPI.getCellCount() > 0, { timeout: 15000 });
    await page.waitForTimeout(1500);

    console.log('📸 Capturing frames...\n');
    const frames = [];
    let lastCellIdx = -1;

    for (let si = 0; si < plan.length; si++) {
      const seg = plan[si];
      const dur = segDurations[si];

      // Navigate to cell if changed
      if (seg.cellIdx !== lastCellIdx) {
        await page.evaluate((idx) => window.codewalkAPI.goToCell(idx), seg.cellIdx);
        await page.waitForTimeout(600);
        await page.evaluate(() => window.codewalkAPI.switchTab('narrative'));
        await page.waitForTimeout(200);
        lastCellIdx = seg.cellIdx;
      }

      // Apply spotlight
      if (seg.spotlightRange) {
        await page.evaluate(([s, e]) => window.codewalkAPI.spotlightRange(s, e), seg.spotlightRange);
      } else if (seg.spotlight) {
        await page.evaluate((ln) => window.codewalkAPI.spotlightLine(ln), seg.spotlight);
      } else {
        await page.evaluate(() => window.codewalkAPI.clearSpotlight());
      }
      await page.waitForTimeout(250);

      // Screenshot
      const framePath = join(tmpDir, `f_${String(si).padStart(5, '0')}.png`);
      await page.screenshot({ path: framePath });
      frames.push({ path: framePath, duration: dur + 0.3 }); // +0.3s gap between segments

      const spkLabel = (seg.speaker || 'Narrator').padEnd(10);
      const spotLabel = seg.spotlight ? `L${seg.spotlight}` : seg.spotlightRange ? `L${seg.spotlightRange[0]}-${seg.spotlightRange[1]}` : '    ';
      console.log(`  [${String(si + 1).padStart(3)}] Cell ${seg.cellIdx + 1}/${cellCount}  ${spkLabel} ${spotLabel.padEnd(10)} ${dur.toFixed(1)}s`);
    }

    await browser.close();
    console.log(`\n  Total frames: ${frames.length}`);

    // Step 3: Build audio track
    let audioPath = null;
    if (!noTts) {
      console.log('\n🔊 Concatenating audio...');
      const gapPath = join(tmpDir, 'gap.mp3');
      execSync(`ffmpeg -y -f lavfi -i anullsrc=channel_layout=mono:sample_rate=24000 -t 0.3 -c:a libmp3lame -b:a 48k "${gapPath}"`, { stdio: 'pipe' });

      const concatLines = [];
      for (let si = 0; si < plan.length; si++) {
        concatLines.push(`file '${join(tmpDir, `seg_${String(si).padStart(4, '0')}.mp3`)}'`);
        concatLines.push(`file '${gapPath}'`);
      }

      const audioConcatPath = join(tmpDir, 'audio_concat.txt');
      writeFileSync(audioConcatPath, concatLines.join('\n'), 'utf-8');

      audioPath = join(tmpDir, 'full_audio.mp3');
      execSync(`ffmpeg -y -f concat -safe 0 -i "${audioConcatPath}" -c:a libmp3lame -b:a 128k -ar 24000 -ac 1 "${audioPath}"`, { stdio: 'pipe' });
    }

    // Step 4: Composite video
    console.log('\n🎞️  Compositing video...');
    const imgConcat = [];
    for (const f of frames) {
      imgConcat.push(`file '${f.path}'`);
      imgConcat.push(`duration ${f.duration.toFixed(3)}`);
    }
    imgConcat.push(`file '${frames[frames.length - 1].path}'`);

    const imgConcatPath = join(tmpDir, 'img_concat.txt');
    writeFileSync(imgConcatPath, imgConcat.join('\n'), 'utf-8');

    const ffmpegCmd = audioPath
      ? `ffmpeg -y -f concat -safe 0 -i "${imgConcatPath}" -i "${audioPath}" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest -movflags +faststart "${output}"`
      : `ffmpeg -y -f concat -safe 0 -i "${imgConcatPath}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${output}"`;

    execSync(ffmpegCmd, { stdio: 'pipe' });

    // Report
    const fileStat = statSync(output);
    const totalDur = frames.reduce((s, f) => s + f.duration, 0);
    console.log(`\n✅ Done!`);
    console.log(`   Output:   ${output}`);
    console.log(`   Duration: ${totalDur.toFixed(0)}s (${(totalDur / 60).toFixed(1)} min)`);
    console.log(`   Size:     ${(fileStat.size / (1024 * 1024)).toFixed(1)} MB`);
    console.log(`   Frames:   ${frames.length} segments across ${cellCount} cells`);
    console.log(`   Mode:     ${hasPodcast ? 'Podcast' : 'Narrative fallback'}`);

  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    if (serverProc) serverProc.kill('SIGTERM');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getAudioDuration(path) {
  try {
    const out = execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${path}"`, { encoding: 'utf-8' });
    return parseFloat(out.trim()) || 5;
  } catch { return 5; }
}

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Server not ready after ${ms}ms`);
}

main().catch(e => { console.error('❌', e.message || e); process.exit(1); });
