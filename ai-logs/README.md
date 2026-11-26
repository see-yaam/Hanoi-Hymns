# AI Logs — Full Prompt Chain

This folder contains the **complete prompt chain** used to build *Hanoi Hymns* (originally called
*Zen Stones*), as required by the Hub's Quest Epoch 1 rules: every prompt sent to the AI and the
AI's full response to each one.

## AI tool used

| Tool | Used for |
|------|----------|
| **Claude Code** (Anthropic's agentic CLI, model: Claude Opus) | Building the whole project: code, audio design, visuals, docs, git commits |

No other AI tools were used to write code or assets. All sounds are synthesized live with Tone.js —
there are no AI-generated or third-party audio files.

## One session

The whole project was built in **one single Claude Code session**, from the first prompt
(logging setup + the complete app) through every later refinement (rename to Hanoi Hymns,
recursion-as-musical-form, Sierpinski constellation, sound polish, export options, mute/pause).

## Files

| File | Content |
|------|---------|
| [`full-session-export.txt`](./full-session-export.txt) | **Primary log.** Complete verbatim `/export` of the session, from the first prompt to the latest, including full tool inputs and outputs. |
| [`early-session-export-1205.txt`](./early-session-export-1205.txt) | An earlier `/export` of the same session, taken at 12:05 and kept as a checkpoint (it covers the first build of the app). |
| [`claude-code-log.md`](./claude-code-log.md) | Hook-based automatic log of prompts and responses, written once the logging hooks became active (from 13:28 onwards). |
| `.chain_state.json` | Internal counter used by the hook — safe to ignore. |

## How the logs are produced

1. **Full session export** — Claude Code's `/export` command writes the entire conversation
   verbatim. This is the authoritative record; `full-session-export.txt` was exported at the end
   and contains everything in the early checkpoint as well.

2. **Hook-based log** — `.claude/settings.json` registers two Claude Code hooks that run
   [`.claude/hooks/log_chain.py`](../.claude/hooks/log_chain.py):
   - `UserPromptSubmit` → appends each prompt with a timestamp under `## 🧑 Prompt N — <time>`.
   - `Stop` → reads the session transcript (`transcript_path`) and appends all assistant output
     since that prompt under `## 🤖 Response N — <time>`: every text block, plus a short record
     of each tool call (tool name + truncated input) inside a collapsible `<details>` block.
   - Secret-looking strings (`ghp_…`, `github_pat_…`, `sk-…`, `password=…`, `token=…`, etc.)
     are redacted before anything is written. The script never fails Claude Code (always exit 0).

   The hooks were created *during* the session, so they only started logging once Claude Code
   picked them up; the prompts before that point are covered by the `/export` files.
