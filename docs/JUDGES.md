# Judge test path

Server name `board-clerk`, version `0.4.0` (live host and this repo). Protocol `2025-11-25`. All meetings and names are synthetic. The page does not speak, and it is not an Alexa device. Assistant instructions for the clerk loop are [skills/board-clerk/SKILL.md](../skills/board-clerk/SKILL.md).

Boards are isolated by `board_id`. A `board_id` is 3 to 40 characters: lowercase letters, digits, and hyphens. Pick your own. `juniper-hollow-demo` is read-only: every write tool returns an error and tells you to call `start_demo_board` with your own id. Reads of that id still return the two seeded meetings and set `demo_board: true`. `start_demo_board` copies those fixtures onto the id you pass and refuses `juniper-hollow-demo`.

Live host `https://lumegrid-board-clerk-v02.lumegridai.workers.dev/` serves server `0.4.0`: 16 tools including `prepare_board_packet`. `juniper-hollow-demo` is read-only; call `start_demo_board` with your own board_id before any write. Check it with `scripts/smoke-remote.mjs` (it expects health and `initialize` to report `0.4.0`) and Inspector CLI `tools/list`.

## About two minutes on the simulated page

Local:

```bash
npm i
npm test
npx wrangler dev
```

Open `http://127.0.0.1:8787/demo?reset=1`. Wait until the board id replaces "preparing" and the answer says the board is ready.

Or open the deployed page: `https://lumegrid-board-clerk-v02.lumegridai.workers.dev/demo`. Add `?reset=1` for a clean take. Add `?board=<id>` to reuse a board.

Then:

1. Chip "What did we decide about the roof?" The answer is the spoken line. Under it, a card shows the motion, Passed, the tally, mover and seconder chips, "Listen at 00:22:10", and August 20, 2026.
2. Chip "Who seconded the pool resurfacing?" The search is the real `what_did_we_decide` tool. The September 17 Blue Fern motion passed, and Mark Ellison seconded. A question whose words are only partly in the motions still says so: the page shows "Partial match", and the spoken line says no loaded motion mentions the missing word.
3. Chip "What still needs confirming?" One-click "Confirm &lt;name&gt;" stores the full roster name. If the guess is not a roster name, use the roster dropdown and "Confirm roster name". The page's board is the private id from `start_demo_board`. The same confirm on `juniper-hollow-demo` returns an error.
4. Chip "Draft last night's minutes", then "Approve the minutes". Before the October 15 transcript is ingested, the draft is the latest meeting already on the board (September 17), and this checkout's page says that it is not the October 15 transcript. Approving while a mover or seconder on the latest meeting still needs confirmation shows "Not approved" and the tool's refusal. Confirm those names, then approve again. The banner says the minutes were approved and no email was sent.
5. "Ingest last night's meeting" loads `GET /demo/transcript.txt` (the fictional October 15 transcript) and shows that meeting's motions and pending names.
6. Chip "Board packet: roof" calls `prepare_board_packet` and renders the packet (`data-testid` `board-packet`): the motions, the approved dollar total parsed from the motion text, open confirmations, and tabled items. After the October 15 ingest, the roof total is the August bid plus the October change order.

The right side is the MCP trace: method, tool name, key arguments, latency, a one-line result, and raw JSON. Microphone input uses speech recognition only. The page does not speak.

## Inspector CLI against the deployed MCP

Use your own board id. `judge-demo-01` is only an example. If someone else already used it, pick another.

```bash
MCP=https://lumegrid-board-clerk-v02.lumegridai.workers.dev/mcp
BOARD=judge-demo-01

npx @modelcontextprotocol/inspector --cli "$MCP" --transport http --method tools/list

npx @modelcontextprotocol/inspector --cli "$MCP" --transport http --method tools/call \
  --tool-name start_demo_board --tool-arg board_id="$BOARD"

npx @modelcontextprotocol/inspector --cli "$MCP" --transport http --method tools/call \
  --tool-name what_did_we_decide --tool-arg board_id="$BOARD" \
  --tool-arg query="What did we decide about the roof?"

npx @modelcontextprotocol/inspector --cli "$MCP" --transport http --method tools/call \
  --tool-name prepare_board_packet --tool-arg board_id="$BOARD" \
  --tool-arg topic=roof

npx @modelcontextprotocol/inspector --cli "$MCP" --transport http --method tools/call \
  --tool-name list_pending_confirmations --tool-arg board_id="$BOARD"

npx @modelcontextprotocol/inspector --cli "$MCP" --transport http --method tools/call \
  --tool-name confirm_mover_seconder --tool-arg board_id="$BOARD" \
  --tool-arg meeting_id=juniper-2026-08-20 --tool-arg motion_id=M3 \
  --tool-arg field=mover --tool-arg value=Okafor --tool-arg confirmed_by="Demo Judge"

npx @modelcontextprotocol/inspector --cli "$MCP" --transport http --method tools/call \
  --tool-name confirm_mover_seconder --tool-arg board_id="$BOARD" \
  --tool-arg meeting_id=juniper-2026-08-20 --tool-arg motion_id=M3 \
  --tool-arg field=seconder --tool-arg value=Lindqvist --tool-arg confirmed_by="Demo Judge"

npx @modelcontextprotocol/inspector --cli "$MCP" --transport http --method tools/call \
  --tool-name request_minutes_approval --tool-arg board_id="$BOARD" \
  --tool-arg meeting_id=juniper-2026-08-20 --tool-arg approver_name="Demo Judge"
```

Copy `id` from `structuredContent` in that response. Do not parse it out of the text blob.

```bash
npx @modelcontextprotocol/inspector --cli "$MCP" --transport http --method tools/call \
  --tool-name approve_minutes --tool-arg board_id="$BOARD" \
  --tool-arg meeting_id=juniper-2026-08-20 --tool-arg approval_id=PASTE_ID \
  --tool-arg approver_name="Demo Judge"

npx @modelcontextprotocol/inspector --cli "$MCP" --transport http --method tools/call \
  --tool-name get_audit_log --tool-arg board_id="$BOARD"
```

August 20 motion M3 is the adjournment whose mover and seconder are not spoken. Approving that meeting before both confirms returns an error and does not approve. September 17 still has its own unconfirmed names. That does not block August 20.

`--tool-arg` JSON-parses values when they are valid JSON. A roster array is one argument, for example `--tool-arg 'roster=[{"name":"Dana Okafor","role":"President"}]'` on `ingest_meeting`.

The Inspector CLI itself was not re-run for this note, and this repo has no saved Inspector transcript. The same tool sequence was run with `fetch` against the public host at 2026-10-12 03:49 UTC on a fresh board (`start_demo_board`, roof question, reserve-study question, confirms, approval, audit, non-roster rejection, resource read, then `reset_board` on that board only). A JSON array argument was not part of that fetch run. See [FRICTION-LOG.md](FRICTION-LOG.md).
