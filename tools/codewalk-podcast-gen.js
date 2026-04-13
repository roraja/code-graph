#!/usr/bin/env node
/**
 * codewalk-podcast-gen — Generate 2-person podcast dialogue for a codewalk.
 *
 * Reads a codewalk from the server API, converts each cell's narrative +
 * highlights into a 2-person dialogue with spotlight cues, then writes
 * the podcast[] segments back into the codewalk JSON on disk.
 *
 * Two modes:
 *   --ai       Use Anthropic API (requires ANTHROPIC_API_KEY env var)
 *   (default)  Algorithmic: splits narrative into sentences, alternates speakers,
 *              matches sentences to highlighted lines
 *
 * Usage:
 *   node tools/codewalk-podcast-gen.js <walk-id> --port 3018
 *   node tools/codewalk-podcast-gen.js <walk-id> --port 3018 --ai
 *   node tools/codewalk-podcast-gen.js <walk-id> --port 3018 --dry-run
 */

const { execSync } = require('node:child_process');
const { writeFileSync, readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const args = process.argv.slice(2);
if (!args.length || args[0] === '--help') {
  console.log(`Usage: node tools/codewalk-podcast-gen.js <walk-id> [--port 3018] [--dry-run] [--ai]`);
  process.exit(0);
}

const walkId = args[0];
function opt(n, d) { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; }
function flag(n) { return args.includes('--' + n); }

const port = +opt('port', '3018');
const outputPath = opt('output', '');
const dryRun = flag('dry-run');
const useAI = flag('ai');
const s1 = opt('speaker1', 'Sarah');
const s2 = opt('speaker2', 'Michael');
const baseUrl = `http://127.0.0.1:${port}`;

async function main() {
  console.log(`\n🎙️  CodeWalk Podcast Generator`);
  console.log(`   Walk:      ${walkId}`);
  console.log(`   Speakers:  ${s1} & ${s2}`);
  console.log(`   Mode:      ${useAI ? 'AI (Anthropic)' : 'Algorithmic'}\n`);

  const res = await fetch(`${baseUrl}/api/codewalks/${encodeURIComponent(walkId)}`);
  if (!res.ok) { console.error(`❌ Walk not found: ${walkId}`); process.exit(1); }
  const data = await res.json();
  const walk = data.walk || data;
  const cells = walk.cells || [];
  console.log(`📖 ${walk.name} — ${cells.length} cells\n`);

  for (let ci = 0; ci < cells.length; ci++) {
    const cell = cells[ci];
    console.log(`  [${ci + 1}/${cells.length}] ${cell.id}`);

    if (useAI) {
      cell.podcast = await generateWithAI(cell, ci, cells.length, walk.name);
    } else {
      cell.podcast = generateAlgorithmic(cell, ci, cells.length);
    }
    console.log(`    → ${cell.podcast.length} segments`);
  }

  if (dryRun) {
    console.log('\n--- Podcast Preview ---\n');
    for (const cell of cells) {
      console.log(`\n━━━ ${cell.id} (${cell.type}) ━━━`);
      for (const seg of (cell.podcast || [])) {
        const spot = seg.spotlight ? ` [L${seg.spotlight}]` : seg.spotlightRange ? ` [L${seg.spotlightRange[0]}-${seg.spotlightRange[1]}]` : '';
        console.log(`  [${seg.speaker}]${spot} ${seg.text}`);
      }
    }
  } else {
    const walkData = { _format: 'codegraph-codewalk-v1', walk };
    const outPath = outputPath || findWalkFile(walkId);
    writeFileSync(outPath, JSON.stringify(walkData, null, 2), 'utf-8');
    console.log(`\n✅ Saved to ${outPath}`);
  }

  const totalSegs = cells.reduce((s, c) => s + (c.podcast?.length || 0), 0);
  console.log(`   Total segments: ${totalSegs}`);
}

// ---------------------------------------------------------------------------
// Algorithmic generation (no AI needed)
// ---------------------------------------------------------------------------
function generateAlgorithmic(cell, cellIdx, totalCells) {
  const narrative = cell.narrative || '';
  const highlights = cell.code.highlights || [];
  const segments = [];

  if (!narrative && highlights.length === 0) {
    segments.push({ speaker: s1, text: `Let's move to step ${cellIdx + 1}.`, spotlight: cell.code.startLine });
    return segments;
  }

  // Split narrative into sentences
  const sentences = splitSentences(narrative);

  // Strategy: match each highlight to nearby sentences by looking for
  // keywords from the annotation in the sentence text
  const hlQueue = [...highlights];
  const usedHl = new Set();

  // Phase 1: Create segments by pairing sentences with highlights
  let segIdx = 0;
  for (let si = 0; si < sentences.length; si++) {
    const sentence = sentences[si].trim();
    if (!sentence || sentence.length < 10) continue;

    const speaker = segIdx % 2 === 0 ? s1 : s2;

    // Try to find a matching highlight for this sentence
    let matchedHl = null;
    for (let hi = 0; hi < hlQueue.length; hi++) {
      if (usedHl.has(hi)) continue;
      const hl = hlQueue[hi];
      if (sentenceMatchesHighlight(sentence, hl)) {
        matchedHl = hl;
        usedHl.add(hi);
        break;
      }
    }

    // If no match, use the next unused highlight
    if (!matchedHl) {
      for (let hi = 0; hi < hlQueue.length; hi++) {
        if (!usedHl.has(hi)) {
          matchedHl = hlQueue[hi];
          usedHl.add(hi);
          break;
        }
      }
    }

    // Make it conversational
    let text = sentence;
    if (speaker === s2 && segIdx > 0) {
      // Add conversational connectors for the second speaker
      const connectors = [
        'Right, and ', 'I see — so ', 'Interesting. ', 'Got it. ',
        'That makes sense. ', 'Ah, so ', 'And notice that ',
        'So basically, ', 'OK so ', 'Makes sense — ',
      ];
      // Only prepend if sentence doesn't already start conversationally
      if (!/^(so|and|but|right|ok|yes|note|notice|importantly)/i.test(text)) {
        text = connectors[segIdx % connectors.length] + text.charAt(0).toLowerCase() + text.slice(1);
      }
    }

    segments.push({
      speaker,
      text,
      spotlight: matchedHl ? matchedHl.line : null,
    });
    segIdx++;
  }

  // Phase 2: Add any remaining highlights that weren't matched
  for (let hi = 0; hi < hlQueue.length; hi++) {
    if (usedHl.has(hi)) continue;
    const hl = hlQueue[hi];
    const speaker = segIdx % 2 === 0 ? s1 : s2;
    const text = hl.annotation || `Look at line ${hl.line}.`;
    segments.push({ speaker, text, spotlight: hl.line });
    segIdx++;
  }

  // If no segments were created, create a simple one
  if (segments.length === 0) {
    segments.push({
      speaker: s1,
      text: narrative.substring(0, 200) || `Step ${cellIdx + 1}.`,
      spotlight: cell.code.startLine,
    });
  }

  // Ensure first segment spotlights the cell start
  if (segments[0] && !segments[0].spotlight) {
    segments[0].spotlight = cell.code.startLine;
  }

  return segments;
}

// Split text into sentences, preserving meaningful chunks
function splitSentences(text) {
  if (!text) return [];
  // Split on sentence boundaries but keep items in numbered lists together
  const raw = text
    .replace(/\*\*(.+?)\*\*/g, '$1')  // remove bold markdown
    .replace(/`([^`]+)`/g, '$1')       // remove code markdown
    .split(/(?<=[.!?])\s+(?=[A-Z(0-9])|(?<=\))\s+(?=[A-Z])/);

  // Merge very short fragments with previous
  const merged = [];
  for (const s of raw) {
    if (merged.length > 0 && s.length < 30) {
      merged[merged.length - 1] += ' ' + s;
    } else {
      merged.push(s);
    }
  }

  // Split overly long sentences
  const result = [];
  for (const s of merged) {
    if (s.length > 250) {
      // Split on commas/semicolons at reasonable points
      const parts = s.split(/(?<=,|;|—)\s+/);
      let current = '';
      for (const p of parts) {
        if (current.length + p.length > 200 && current.length > 50) {
          result.push(current.trim());
          current = p;
        } else {
          current += (current ? ' ' : '') + p;
        }
      }
      if (current) result.push(current.trim());
    } else {
      result.push(s.trim());
    }
  }

  return result.filter(s => s.length > 0);
}

// Check if a sentence is related to a highlight annotation
function sentenceMatchesHighlight(sentence, hl) {
  if (!hl.annotation) return false;
  const annWords = hl.annotation.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const sentLower = sentence.toLowerCase();

  // Count matching words
  let matches = 0;
  for (const w of annWords) {
    if (sentLower.includes(w)) matches++;
  }

  // Match if at least 2 words match, or >40% of annotation words
  return matches >= 2 || (annWords.length > 0 && matches / annWords.length > 0.4);
}

// ---------------------------------------------------------------------------
// AI generation (requires ANTHROPIC_API_KEY)
// ---------------------------------------------------------------------------
async function generateWithAI(cell, cellIdx, totalCells, walkName) {
  const highlights = (cell.code.highlights || [])
    .map(h => `  Line ${h.line} (${h.type}): ${h.annotation || ''}`)
    .join('\n');

  const prompt = `Write a 2-person podcast dialogue between ${s1} (explainer) and ${s2} (curious colleague) about this code.

CONTEXT: "${walkName}" — Cell ${cellIdx + 1}/${totalCells}, type: ${cell.type}
FILE: ${cell.code.filePath}, lines ${cell.code.startLine}-${cell.code.endLine}

CODE:
\`\`\`
${(cell.code.text || '').substring(0, 2000)}
\`\`\`

HIGHLIGHTED LINES:
${highlights || '(none)'}

NARRATIVE: ${cell.narrative || '(none)'}

Rules:
- Each segment must have a "spotlight" field with a line number to highlight
- ${s1} explains, ${s2} asks questions and adds observations
- 1-3 sentences per segment, natural and conversational
- Cover every highlighted line

Output ONLY a JSON array: [{"speaker":"${s1}","text":"...","spotlight":40}, ...]`;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('    ⚠ No ANTHROPIC_API_KEY, using algorithmic fallback');
    return generateAlgorithmic(cell, cellIdx, totalCells);
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array in response');

    const parsed = JSON.parse(match[0]);
    return parsed.map(seg => ({
      speaker: seg.speaker || s1,
      text: seg.text,
      spotlight: seg.spotlight ?? null,
      spotlightRange: seg.spotlightRange ?? null,
    })).filter(s => s.text?.trim());
  } catch (e) {
    console.log(`    ⚠ AI failed: ${e.message}, using algorithmic fallback`);
    return generateAlgorithmic(cell, cellIdx, totalCells);
  }
}

// ---------------------------------------------------------------------------
// Find walk file on disk
// ---------------------------------------------------------------------------
function findWalkFile(id) {
  const candidates = [
    resolve(process.cwd(), `.vscode/code-graph/codewalks/${id}.codewalk.json`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Check for v2 directory — write as v1 alongside
  const v2dir = resolve(process.cwd(), `.vscode/code-graph/codewalks/${id}`);
  if (existsSync(v2dir)) {
    return resolve(process.cwd(), `.vscode/code-graph/codewalks/${id}.codewalk.json`);
  }
  return resolve(process.cwd(), `${id}.codewalk.json`);
}

main().catch(e => { console.error('❌', e.message || e); process.exit(1); });
