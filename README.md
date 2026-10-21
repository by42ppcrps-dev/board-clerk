# Board Clerk MCP

Streamable-HTTP MCP server for the MinutesDesk board-clerk loop: ingest a clean transcript, list what the board decided, confirm a mover or seconder, and approve minutes. It keeps that state per board across sessions. Protocol `2025-11-25`. Server name `board-clerk`, version `0.4.0`.

Judge walkthrough: [docs/JUDGES.md](docs/JUDGES.md). Assistant instructions: [skills/board-clerk/SKILL.md](skills/board-clerk/SKILL.md).

All meetings, names, and organizations in this repo are synthetic and fictional. The server does not call a model and does not send email.

## Judge quick start

- MCP: `https://lumegrid-board-clerk-v02.lumegridai.workers.dev/mcp`
- Simulated Alexa+ page: `https://lumegrid-board-clerk-v02.lumegridai.workers.dev/demo`

```bash
npx @modelcontextprotocol/inspector --cli https://lumegrid-board-clerk-v02.lumegridai.workers.dev/mcp --transport http --method tools/list
```

The `/demo` page is a simulated Alexa+ experience, not an Alexa device. It calls `/mcp` (initialize `2025-11-25`, then `tools/call`). Speech recognition, when the browser has it, is input only. The page does not speak.

On first load the page calls `start_demo_board` with a random `judge-` id stored in `localStorage` (`boardClerkDemoBoardId`), so a judge is not writing on the shared demo board. `?board=<id>` reuses a board. `?reset=1` starts a fresh isolated board. Judge boards are isolated by `board_id`.

Live demo: `https://lumegrid-board-clerk-v02.lumegridai.workers.dev` (MCP at `/mcp`, demo at `/demo`). This repo's server version is `0.4.0`. `npx wrangler dev` serves this checkout locally and does not deploy.

`wrangler.toml` names the worker `lumegrid-board-clerk-v02` and does not set `account_id`. Log in with Wrangler on the account that should own that worker before any deploy.

Local worker (does not deploy):

Use a supported Node.js release (22 or newer); Node.js 24 LTS is used in CI.
Install the locked Wrangler 4 toolchain with `npm ci` before running the local worker.

```bash
npx wrangler dev
```

Health: `GET /` and `GET /health`. MCP: `/mcp`. Demo: `/demo`. Transcript: `GET /demo/transcript.txt`.

## Tests

```bash
npm test                 # node --test
npm run test:engine      # offline fixture smoke
npm run test:mcp-local   # in-process MCP smoke
```

`npm run test:remote -- <baseUrl>` runs the same ingest, confirm, and approve flow over HTTP against that URL, using a random board id, then calls `reset_board`. It is not part of the offline suite.

## Tools

| Tool | What it does |
|------|----------------|
| `list_meetings` | Meetings on this board |
| `list_motions` | Motions and attribution status |
| `get_motion` | One motion |
| `get_decision` | Short decision card |
| `what_did_we_decide` | Search; `top_answer` is at most two spoken sentences |
| `prepare_board_packet` | Motions on one topic across meetings, approved dollar total, open confirmations, tabled items |
| `list_pending_confirmations` | Mover or seconder still unconfirmed |
| `confirm_mover_seconder` | Store a roster name for a later session |
| `draft_minutes` | Markdown draft; approval is still required |
| `ingest_meeting` | Rule-based extract of a `[HH:MM:SS] Speaker:` transcript. Optional `second_pass_motions` runs crosscheck |
| `request_minutes_approval` | Record a pending approval; nothing is emailed |
| `list_approvals` | Recorded approval requests |
| `approve_minutes` | Approve, or refuse while a name is unconfirmed |
| `get_audit_log` | Who did what, and when |
| `reset_board` | Clear layered state for this board |
| `start_demo_board` | Copy the two Juniper fixtures onto a new board |

Resources: `board://{board_id}/roster`, `board://{board_id}/meetings`, and `ui://board-clerk/decision-card` (`text/html;profile=mcp-app`). Prompt: `ask_the_board`.

`get_decision` and `what_did_we_decide` set `_meta.ui.resourceUri` to that card. Text and `structuredContent` are still returned for clients that do not render UI. Installed `@modelcontextprotocol/server` 2.3.1 copies tool `_meta` onto `tools/list` and can register a static resource at a `ui://` URI. It does not export `registerAppTool` or `registerAppResource`, and this server does not advertise `io.modelcontextprotocol/ui`. No MCP Apps host was run. The in-process tests check the resource bytes and the tool link only, not an iframe.

Every tool has a title and annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false`). Pass `board_id` when you have one. The pattern is `^[a-z0-9-]{3,40}$`. Omitted, it is `juniper-hollow-demo`, which is read-only for writes.

## State

`BoardState` is a SQLite Durable Object, one instance per board id (`BOARD_STATE`). It stores ingested meetings, confirmations, approval requests, and an audit log. `MemoryStore` speaks the same `POST /op` JSON RPC for tests and for a worker with no binding.

Fixtures are not stored. Reads of `juniper-hollow-demo` layer them under any meetings already stored and set `demo_board: true`. `ingest_meeting`, `confirm_mover_seconder`, `request_minutes_approval`, `approve_minutes`, and `reset_board` return `isError` on that id and tell the caller to use `start_demo_board` with their own id. `start_demo_board` deep-copies `juniper-2026-08-20` and `juniper-2026-09-17` onto that id and refuses `juniper-hollow-demo`.

A new handler that shares the same store sees earlier confirms and ingested meetings. A different `board_id` does not.

## Guardrails

- `approve_minutes` returns `isError` while any mover or seconder on that meeting is `NEEDS CONFIRMATION`.
- `confirm_mover_seconder` accepts a roster full name, first name, or last name (case-insensitive), stores the full name, and otherwise returns `isError` with the roster. The value is at most 80 characters. The engine helper used by the offline tests stays permissive; the MCP tool is what normalizes.
- Transcripts are capped at 200 KB, ingested meetings at 25 per board, approval requests at 40, and audit entries at 200. `approver_name` and `confirmed_by` are capped at 80 characters.
- `/mcp` rejects a present `Origin` that is not `http://localhost` (any port), `http://127.0.0.1` (any port), or the worker's own `https://*.workers.dev` origin. A missing `Origin` is allowed. `https://localhost` and `Origin: null` are rejected. The error body does not echo `Origin`. Any other path than `GET /`, `GET /health`, `GET /demo`, `GET /demo/transcript.txt`, and `/mcp` is 404, so the checks cannot be skipped. `POST /mcp` bodies over 256 KB get 413.
- Tool failures are tool results with `isError` and a message that names the board, the roster, the limit, or the next call to make.

## Accuracy

A name is marked `SPOKEN` only when it appears in what someone said (the transcript text after the speaker label) within −45s to +30s of the motion. A speaker label alone never counts, because labels come from diarization or a transcriber, not from words said in the meeting. A name that fits more than one roster member (for example "Dana" when the roster has Dana Smith and Dana Jones) is never resolved by roster order: the field stays `NEEDS CONFIRMATION`, the candidates are listed in the open question, and only a single roster member can confirm it. Otherwise the field is `NEEDS CONFIRMATION` and a person confirms it in one step. Approval is refused while any mover or seconder still needs confirmation. The window, the speaker-label rule, and the shared-name cases are unit-tested on synthetic lines in `test/namerule.test.mjs`, `test/extract.test.mjs`, and `test/mcp.test.mjs`. The rule-based extractor covers clean synthetic `[HH:MM:SS] Speaker:` transcripts only. This server does not call a model.

A separate Gemini MinutesDesk pipeline test, not this extractor, reported 24/24 motions and outcomes, movers 16/24, and seconders 14/24 on 5 public meetings. This repository does not compute those ratios and does not call Gemini. An outside note did not accept that run as checked against the recordings. Do not treat the ratios as recording-verified, and do not treat them as this server's score.

`ingest_meeting` runs `crosscheck` only when the caller passes `second_pass_motions`. A disagreement whose flag starts with `passes disagree on mover:` or `passes disagree on seconder:` sets that attribution to `NEEDS CONFIRMATION`. The server still does not call Gemini.

`what_did_we_decide` answers in at most two sentences, with dates like "August 20th" and amounts as written in the motion (not rewritten as dollars). If the mover or seconder is unconfirmed, the answer says so. If a topic word is not in any motion, the first sentence says that and the second sentence is the closest match. It does not pretend the closest match is the thing that was asked. `prepare_board_packet` uses the same topic score. Approved dollar totals are parsed from motion text only, and only for a passed motion that is not a tabling motion. A missing topic word is named in the spoken summary.
