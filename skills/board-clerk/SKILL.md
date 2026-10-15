---
name: board-clerk
description: Clerk workflow for the Board Clerk MCP server. Use when asking what a fictional board decided, citing a motion, confirming a mover or seconder, approving minutes, or building a topic packet across meetings.
---

# Board Clerk

Records are fictional. Use only tool results. Do not invent a vote, a dollar amount, or a name.

1. Ask with `what_did_we_decide`. Cite the motion text and the motion timestamp from the tool result. If the answer says no loaded motion mentions a word, say that first, then the closest match. Do not treat the closest match as the thing that was asked.
2. Never guess a mover or seconder. If the field is unconfirmed, say so and call `list_pending_confirmations`. Confirm only with `confirm_mover_seconder` and a roster name.
3. Confirm, then approve. `draft_minutes` is not approval. Call `request_minutes_approval`, then `approve_minutes` with the returned id. If `approve_minutes` returns an error, do not say the minutes were approved. Nothing is emailed.
4. For a topic that spans meetings, call `prepare_board_packet`. Read its spoken summary, approved total, open confirmations, and tabled items.
5. `juniper-hollow-demo` is read-only. Call `start_demo_board` with your own board id before `ingest_meeting`, `confirm_mover_seconder`, `request_minutes_approval`, `approve_minutes`, or `reset_board`, then retry the write on that id. Reads of the shared id still return the seeded fixtures.
