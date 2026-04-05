# Stable Code Location References

**Status:** Proposal
**Date:** 2026-04-05
**Problem:** Code locations in scenario traces use `filePath:lineNumber` — a single inserted or deleted line invalidates every downstream reference in the file.

## Problem Analysis

Code locations permeate the system:

| Where | What's stored | How it breaks |
|-------|---------------|---------------|
| `FunctionNode.id` | `filePath:startLine` (parser `makeId()`) | Function IDs change on any line shift |
| `ScenarioStep.line` | Raw line number within a function | Drifts after any edit to the file |
| `CallStackFrame.line` | Active line in each stack frame | Same drift problem |
| `CallEdge.line` | Line of the call expression | Drifts |
| `BranchNode.line/thenStartLine/thenEndLine/elseStartLine/elseEndLine` | Branch boundary lines | All drift together |

After a single `git commit` that adds a blank line, *all* traced scenarios referencing that file become subtly wrong. There is no mechanism to detect or repair the drift.

---

## Idea 1: Content-Anchored Lines (Line Fingerprint + Fuzzy Relocator)

**Store the line content alongside the line number; relocate by approximate match when the number drifts.**

Each code location becomes:

```ts
interface AnchoredLocation {
  filePath: string;
  line: number;                 // best-known line number (fast path)
  lineContent: string;          // trimmed source text of that line
  contentHash: string;          // hash of lineContent (fast equality check)
  neighborContext?: string[];   // 1-2 lines above/below for disambiguation
}
```

**Resolution algorithm:**
1. Read `filePath`, check if `lines[line]` matches `contentHash` — if yes, done.
2. If not, scan a window (line +/- 50) for a line matching `contentHash` + Levenshtein distance < threshold.
3. If multiple matches, use `neighborContext` to disambiguate.
4. Update the stored `line` to the new value (self-healing).

**Pros:** Simple, no new infrastructure, works for any language, self-healing.
**Cons:** Identical lines (e.g., `}` or `return;`) need context disambiguation. Renamed variables break the content match.

---

## Idea 2: Symbol Address (Structural Path)

**Identify a line by its position within the AST: `ClassName.methodName > if(condition) > thenBlock > line[3]`.**

```ts
interface SymbolAddress {
  filePath: string;
  symbolPath: string[];  // e.g. ["ScenarioTracer", "traceFunction", "if(depth >= maxDepth)", "return"]
  offsetInBlock: number; // line offset within the innermost block
  line: number;          // cached for fast access
}
```

**Resolution:** Walk the AST to find the node matching `symbolPath`, then index to `offsetInBlock`. Fall back to fuzzy search if the path doesn't resolve.

**Pros:** Survives line insertions, renames of unrelated code, and reformatting. Extremely precise for declarations and branch points.
**Cons:** Requires AST access at resolution time. Deeply nested or duplicated structures (e.g., multiple `if (x)` in the same function) need extra disambiguation. Language-specific.

---

## Idea 3: AI-Powered Semantic Anchor Registry

**Store a one-line semantic description with each code location in a global registry. On code changes, an AI agent re-validates each anchor and updates line numbers.**

```ts
interface SemanticAnchor {
  id: string;                    // stable UUID
  filePath: string;
  line: number;                  // current best line number
  semanticDescription: string;   // "null-check guard for the Neo4j driver connection"
  lineContent: string;           // actual source text for verification
  lastVerifiedCommit: string;    // git SHA when this was last confirmed
}
```

**Maintenance workflow:**
1. On `git diff` detection (pre-walk, post-commit hook, or CI), find all anchors in changed files.
2. For each anchor: read the new file, ask AI "Given this description, which line is it now?" with the surrounding code as context.
3. AI returns the new line number + confidence. High-confidence updates are auto-applied; low-confidence ones are flagged for human review.

**Pros:** Handles renames, refactors, and even logic moves between functions. The semantic description is human-readable and debuggable.
**Cons:** Requires AI calls (cost, latency). Registry grows with codebase. Must run the update pass before walks are valid.

---

## Idea 4: Git-Blame-Based Line Tracking

**Use `git blame` / `git log -L` to track how a specific line has moved through commits.**

```ts
interface BlameTrackedLocation {
  filePath: string;
  line: number;
  originCommit: string;    // the commit SHA when this location was recorded
  originFilePath: string;  // original file path (handles renames)
}
```

**Resolution:** Run `git log --follow -p <originCommit>..HEAD -- <filePath>`, parse the diffs to track how `line` shifted through each commit. Alternatively, use `git blame` on the current file to find the commit that last touched the target line and correlate back.

**Pros:** Zero storage overhead beyond commit SHA. Leverages git's built-in tracking. Works across file renames. No AI needed.
**Cons:** Requires git repository access at resolution time. Expensive for files with many commits. Doesn't survive cherry-picks or rebases well. Lines deleted entirely have no resolution path.

---

## Idea 5: Content-Range Hash (Block Fingerprint)

**Instead of anchoring to a single line, anchor to a content-hashed range of 3-5 lines centered on the target.**

```ts
interface BlockAnchor {
  filePath: string;
  line: number;            // center line of the block
  blockHash: string;       // hash of normalized 5-line window
  blockSize: number;       // number of lines in the window (3 or 5)
  targetOffset: number;    // offset of the actual target line within the block
}
```

**Resolution:** Slide the 5-line window across the current file, compute hashes, find the matching block. The target line is at `matchStart + targetOffset`. Normalize whitespace before hashing for resilience to formatting changes.

**Pros:** Much more unique than single-line matching. Fast (just string hashing, no AI). Survives minor edits to nearby lines if the window still has 3+ matching lines.
**Cons:** Falls apart if the block itself is heavily edited. Doesn't handle moves across functions or files.

---

## Idea 6: Tree-Sitter Positional Anchoring

**Use tree-sitter to assign each node a stable positional ID based on its type and ordinal position in its parent.**

```ts
interface TreeSitterAnchor {
  filePath: string;
  treePath: string;   // "program > class_declaration[0] > method_definition[2] > if_statement[0] > expression_statement[1]"
  line: number;       // cached
}
```

**Resolution:** Parse the file with tree-sitter (fast, incremental), walk the tree following the path. If a child index is out of bounds, search siblings of the same type for a content match.

**Pros:** Language-agnostic (tree-sitter has grammars for 100+ languages). Very fast incremental parsing. More resilient than raw AST because tree-sitter node types are stable across minor edits.
**Cons:** Ordinal indices (`[2]`) still shift if a sibling is added before them. Needs tree-sitter as a dependency (WASM or native). Some node types are too generic (e.g., `expression_statement`).

---

## Idea 7: Hybrid Anchor (Symbol Path + Content Fingerprint)

**Combine the structural path (Idea 2) with content fingerprinting (Idea 1) into a single anchor that tries structural resolution first, then falls back to content matching.**

```ts
interface HybridAnchor {
  filePath: string;
  line: number;

  // Structural component
  functionName: string;         // qualified name of containing function
  blockType?: string;           // "if" | "for" | "try" | "catch" | "else" | null
  blockCondition?: string;      // "depth >= maxDepth" (for branches)
  offsetInBlock: number;        // line offset within the block

  // Content component
  lineContent: string;          // trimmed source text
  contentHash: string;          // fast check
  neighborHashes?: string[];    // hashes of adjacent lines
}
```

**Resolution cascade:**
1. **Fast path:** Check `lines[line]` against `contentHash`. Done if match.
2. **Structural:** Find `functionName` in the file, locate the block matching `blockType + blockCondition`, index to `offsetInBlock`.
3. **Fuzzy content:** Scan the function body for `contentHash` match with neighbor verification.
4. **Broad scan:** Search the entire file.
5. **Report drift** if nothing matches — mark anchor as `stale`.

**Pros:** Multiple fallback layers mean very high resilience. Each layer is cheap on its own. Self-documenting (you can read the anchor and understand what it points to). Works without AI for most cases.
**Cons:** More data per anchor. Resolution logic is more complex. Needs careful implementation of the cascade to avoid false positives.

---

## Idea 8: Incremental Diff Patcher

**Don't try to make anchors stable — instead, intercept every `git diff` and batch-update all affected anchors using diff hunks.**

```ts
// No new anchor format — keep using plain line numbers.
// Add a maintenance command:
//   codegraph rebase-locations [--from <commit>] [--to HEAD]

interface DiffHunk {
  filePath: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}
```

**Algorithm:** Parse `git diff <from>..<to>` into hunks. For each hunk, compute the line offset delta. Apply delta to all stored locations in that file where `line >= oldStart`.

**Pros:** Exact — no guessing, no fuzzy matching, no AI. Works for any language. Can be run as a git hook automatically. Cheap and fast.
**Cons:** Must be run after every commit (or before every walk). Doesn't handle non-git changes. Can't recover if the patch pass was skipped for several commits (compounding diffs). Deleted lines become orphaned.

---

## Idea 9: LSP-Based Symbol References

**Leverage the Language Server Protocol's `textDocument/documentSymbol` and `textDocument/definition` to resolve locations dynamically at walk time.**

```ts
interface LSPAnchor {
  filePath: string;
  symbolKind: string;       // "function" | "method" | "class" | "variable"
  symbolName: string;        // "traceFunction"
  containerName?: string;    // "ScenarioTracer"
  line: number;              // cached, updated on resolution
}
```

**Resolution:** Query the running LSP server for `documentSymbol` on the file, find the symbol matching `symbolKind + symbolName + containerName`, read its range.

**Pros:** Always accurate if an LSP is running. Handles renames through `textDocument/rename` tracking. Language-agnostic via LSP.
**Cons:** Requires a running LSP server — not available in CI, CLI, or headless environments. Only works for symbol-level locations, not arbitrary lines within a function. Adds a runtime dependency.

---

## Idea 10: Persistent Source Maps

**Generate and maintain a source map (like JavaScript source maps) that tracks original-to-current line mappings across edits.**

```ts
interface SourceMap {
  filePath: string;
  baseCommit: string;            // the commit these mappings are relative to
  mappings: LineMapping[];       // sorted by originalLine
}

interface LineMapping {
  originalLine: number;          // line number when the scenario was traced
  currentLine: number;           // line number in the current file
  confidence: number;            // 1.0 for exact, lower for heuristic
  status: 'exact' | 'moved' | 'modified' | 'deleted';
}
```

**Maintenance:** On each commit touching a tracked file, compute the source map delta from the diff. Compound deltas over time. If the map grows stale (too many `modified`/`deleted` entries), trigger a re-index.

**Pros:** Single map per file covers all anchors in that file. Composable (can chain maps across commits). Familiar concept (source maps are well understood).
**Cons:** Must be maintained continuously. Map files add storage overhead. Compounding maps across many commits can accumulate drift. Needs a daemon or hook to stay current.

---

## Comparison Matrix

| Idea | Resilience to inserts | Resilience to refactors | AI Required | New Dependencies | Complexity | Self-healing |
|------|----------------------|------------------------|-------------|------------------|------------|-------------|
| 1. Content-Anchored Lines | Medium | Low | No | None | Low | Yes |
| 2. Symbol Address | High | Medium | No | AST parser | Medium | No |
| 3. AI Semantic Registry | Very High | Very High | Yes | AI provider | High | Yes |
| 4. Git Blame Tracking | High | Medium | No | Git CLI | Medium | No |
| 5. Block Fingerprint | Medium-High | Low | No | None | Low | Yes |
| 6. Tree-Sitter Anchoring | High | Medium | No | tree-sitter | Medium | No |
| 7. **Hybrid Anchor** | **Very High** | **High** | **No** | **None (uses existing parser)** | **Medium** | **Yes** |
| 8. Diff Patcher | High (if run) | Low | No | Git CLI | Low | No |
| 9. LSP References | Very High | Very High | No | LSP server | High | Yes |
| 10. Persistent Source Maps | High | Low | No | None | Medium | No |

---

## Recommendation: Idea 7 — Hybrid Anchor (Symbol Path + Content Fingerprint)

**The Hybrid Anchor is the best fit for CodeGraph** because:

1. **No new infrastructure.** CodeGraph already has a TypeScript parser (ts-morph) that can resolve `functionName` and block structures. No AI calls, no tree-sitter, no LSP, no git CLI needed at resolution time.

2. **Multi-layer resilience.** The cascade (fast line check -> structural lookup -> fuzzy content scan) means it degrades gracefully. A simple line insertion is caught by the content hash. A rename is caught by the structural path. A major refactor triggers the stale report, prompting a re-trace rather than silently using wrong data.

3. **Self-healing.** When the fast path fails but a deeper layer succeeds, the `line` field is updated in place — subsequent walks are fast again without any manual intervention.

4. **Human-debuggable.** Reading a hybrid anchor like `{functionName: "ScenarioTracer.traceFunction", blockType: "if", blockCondition: "depth >= maxDepth", offsetInBlock: 0, lineContent: "return;"}` tells you exactly what it points to, even without opening the file.

5. **Incremental adoption.** The `line` field remains the primary key for backward compatibility. Existing code that only reads `line` continues to work. The structural and content fields are additive — old scenarios without them degrade to current behavior.

6. **Complements AI Semantic Registry (Idea 3) as a future upgrade.** If content and structural resolution both fail, a future pass could use the AI semantic anchor as a last resort, but the system works without it.

### Suggested Implementation Path

1. **Phase 1 — Enrich anchors at trace time.** When `createStep()` and `buildCallStackFrame()` record a line number, also capture `lineContent`, `contentHash`, `functionName`, and block metadata from the parser. Extend `ScenarioStep`, `CallStackFrame`, `CallEdge`, and `BranchNode` interfaces.

2. **Phase 2 — Add a `resolveLocation()` utility.** A single function that implements the resolution cascade. All consumers (VS Code extension, web walkthrough, CLI walk command) call this instead of using `line` directly.

3. **Phase 3 — Add `codegraph rebase-locations` command.** A CLI command that reads all scenarios, resolves every anchor against the current source, and updates stale line numbers. Can be run as a git post-commit hook.

4. **Phase 4 (optional) — AI fallback.** For anchors that `resolveLocation()` can't resolve, queue them for AI-assisted relocation using semantic descriptions (borrowing from Idea 3).
