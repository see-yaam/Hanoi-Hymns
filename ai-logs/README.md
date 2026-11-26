# AI Logs — Full Prompt Chain

This folder contains the **complete prompt chain** used to build *Zen Stones*, as required by the
Hub's Quest Epoch 1 rules: every prompt sent to the AI and the AI's full response to each one.

## AI tool used

| Tool | Used for |
|------|----------|
| **Claude Code** (Anthropic's agentic CLI, model: Claude Opus) | Building the whole project: code, audio design, visuals, docs, git commits |

No other AI tools were used to write code or assets. All sounds are synthesized live with Tone.js —
there are no AI-generated or third-party audio files.

## How the logs are produced

There are two complementary sources:

1. **Hook-based log — [`claude-code-log.md`](./claude-code-log.md)**
   `.claude/settings.json` registers two Claude Code hooks that run
   [`.claude/hooks/log_chain.py`](../.claude/hooks/log_chain.py):
   - `UserPromptSubmit` → appends each prompt with a timestamp under
     `## 🧑 Prompt N — <time>`.
   - `Stop` → reads the session transcript (`transcript_path`) and appends all assistant output
     since that prompt under `## 🤖 Response N — <time>`: every text block, plus a short record
     of each tool call (tool name + truncated input) inside a collapsible `<details>` block.
   - Secret-looking strings (`ghp_…`, `github_pat_…`, `sk-…`, `password=…`, `token=…`, etc.)
     are redacted before anything is written. The script never fails Claude Code (always exit 0).

2. **Full session exports — `session-NN.md`**
   Each complete session is also exported with Claude Code's `/export` command, which captures
   the entire conversation verbatim (including full tool inputs and outputs).

### Why the first session is an export

Claude Code loads project hooks when a session starts. The logging hooks were *created during*
the very first build session, so they could not capture it. That first session is therefore
saved as **[`session-01.md`](./session-01.md)** via `/export`. Every session after that is logged
automatically by the hooks (and may additionally be exported as `session-02.md`, …).

## Files

| File | Content |
|------|---------|
| `session-01.md` | Full `/export` of the first build session (logging setup + complete app) |
| `claude-code-log.md` | Auto-appended prompt/response chain from all later sessions |
| `session-NN.md` | Optional further full exports |
| `.chain_state.json` | Internal counter used by the hook (safe to ignore) |
