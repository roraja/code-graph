# 04 - Fix Copilot CLI Provider Stdin Piping

**Date**: 2026-04-04 13:58 UTC
**Prompt**: User hit error running `codegraph discover --hint "GetUrlFromHDrop function in ui/base/clipboard/clipboard_util_win.cc:77"` — the full system prompt was being passed as a CLI argument to `copilot -p`, exceeding OS argument-length limits.

## 1. Code Reading & Analysis
- `packages/core/src/ai/copilot-cli-provider.ts` — The `chat()` method at line 63 combined all messages into a single prompt string and passed it as a `-p` CLI argument via `execFileAsync`. With system instructions (~3KB) + function list + call graph, the prompt easily exceeds the Linux `ARG_MAX` of ~128KB.
- `packages/core/src/ai/scenario-discovery.ts` — Builds the system prompt (~3KB) plus user prompt with entry points, call graph edges, branch points, class hierarchy, and source code. Total can reach 50–200KB for non-trivial codebases.
- `packages/core/src/config/loader.ts` — Default AI provider is `'copilot'`, so this path is hit by default.

## 2. Issues Identified
- **ARG_MAX exceeded** (`copilot-cli-provider.ts:78`): The entire prompt was passed as a single CLI argument (`-p prompt`). On Linux, `ARG_MAX` is typically ~128KB. Large prompts cause `E2BIG` or `ENOBUFS` errors.
- **Error message leaks full prompt**: Because the prompt is in the CLI args, the error message includes the entire system instructions, which is confusing.

## 3. Plan
- Replace `execFile` with `spawn` and pipe the prompt via **stdin** using `-p -` (read from stdin convention).
- Implement proper timeout and buffer management with the spawn-based approach.
- Keep the same public API and error handling contract.

## 4. Changes Made

### `packages/core/src/ai/copilot-cli-provider.ts`
- **Import**: Replaced `execFile` + `promisify` with `spawn` from `node:child_process`
- **`chat()` method**: Changed `-p prompt` to `-p -` (read from stdin); delegates to new `spawnWithStdin()` method
- **New `spawnWithStdin()` method**: Spawns the copilot binary, pipes the prompt via stdin, collects stdout/stderr, handles timeout and buffer limits

## 5. Commands Run
- `npm run build --workspace=packages/core` → exit 0
- `npx vitest run` → 131 tests passed (3 files)

## 6. Result
- Prompts of any size can now be sent to the Copilot CLI without hitting OS argument-length limits
- Error messages no longer leak the full system prompt
- All existing tests continue to pass

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| packages/core/src/ai/copilot-cli-provider.ts | Modified | Switch from CLI args to stdin piping for prompt delivery |
