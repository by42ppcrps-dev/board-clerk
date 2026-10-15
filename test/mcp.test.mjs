import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import worker from "../src/index.js";
import { createHandler, PROTOCOL_VERSION, SERVER_VERSION, TOOL_NAMES } from "../src/server.js";
import { MemoryStore } from "../src/state.js";

const transcript = readFileSync(new URL("../demo/juniper-2026-10-15-transcript.txt", import.meta.url), "utf8");
const ROSTER = [
  { name: "Dana Okafor", role: "President" },
  { name: "Luis Trevino", role: "Vice President" },
  { name: "Priya Raman", role: "Treasurer" },
  { name: "Mark Ellison", role: "Secretary" },
  { name: "Grace Lindqvist", role: "Director" },
];

function parseRpc(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("empty MCP response");
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const messages = [];
  for (const line of trimmed.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    messages.push(JSON.parse(payload));
  }
  if (!messages.length) throw new Error(trimmed.slice(0, 240));
  return messages[messages.length - 1];
}

async function rpc(handler, method, params, id) {
  const res = await handler.fetch(
    new Request("http://127.0.0.1:8787/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }),
  );
  const body = parseRpc(await res.text());
  if (body.error) {
    const error = new Error(body.error.message || JSON.stringify(body.error));
    error.rpc = body.error;
    error.status = res.status;
    throw error;
  }
  return body.result;
}

async function openSession(store) {
  const handler = createHandler({ store });
  let n = 0;
  const init = await rpc(
    handler,
    "initialize",
    {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "mcp-test", version: "0.2.0" },
    },
    ++n,
  );
  async function call(method, params) {
    return rpc(handler, method, params, ++n);
  }
  return { handler, init, call };
}

function dataOf(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = (result?.content || []).map((block) => block.text || "").join("\n");
  const idx = text.indexOf("{");
  if (idx === -1) throw new Error(text.slice(0, 400));
  return JSON.parse(text.slice(idx));
}

async function tool(call, name, args) {
  const result = await call("tools/call", { name, arguments: args });
  return { result, data: dataOf(result), isError: result.isError === true };
}

const INIT_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "origin-test", version: "0.2.0" },
  },
});

function postMcp(url, { origin, body, contentLength } = {}) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (origin !== undefined) headers.origin = origin;
  if (contentLength !== undefined) headers["content-length"] = String(contentLength);
  return worker.fetch(
    new Request(url, {
      method: "POST",
      headers,
      body,
    }),
  );
}

describe("MCP streamable HTTP", () => {
  it("negotiates protocol 2025-11-25 and lists tools, templates, and prompts", async () => {
    const { init, call } = await openSession(new MemoryStore());
    assert.equal(init.protocolVersion, PROTOCOL_VERSION);
    assert.equal(init.protocolVersion, "2025-11-25");
    assert.equal(init.serverInfo.name, "board-clerk");
    assert.equal(init.serverInfo.version, SERVER_VERSION);
    assert.equal(init.serverInfo.version, "0.4.0");

    const listed = await call("tools/list", {});
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...TOOL_NAMES].sort());
    for (const tool of listed.tools) {
      assert.equal(typeof tool.title, "string");
      assert.ok(tool.title.length > 0, tool.name);
      assert.equal(typeof tool.annotations, "object");
      for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        assert.equal(typeof tool.annotations[key], "boolean", `${tool.name} ${key}`);
      }
      assert.equal(tool.annotations.openWorldHint, false, tool.name);
    }
    const byName = Object.fromEntries(listed.tools.map((tool) => [tool.name, tool]));
    assert.equal(byName.list_meetings.annotations.readOnlyHint, true);
    assert.equal(byName.reset_board.annotations.destructiveHint, true);
    assert.equal(byName.ingest_meeting.annotations.readOnlyHint, false);
    assert.equal(byName.start_demo_board.annotations.readOnlyHint, false);
    assert.equal(byName.prepare_board_packet.annotations.readOnlyHint, true);
    assert.equal(byName.get_decision._meta.ui.resourceUri, "ui://board-clerk/decision-card");
    assert.equal(byName.what_did_we_decide._meta.ui.resourceUri, "ui://board-clerk/decision-card");
    assert.equal(init.capabilities?.extensions?.["io.modelcontextprotocol/ui"], undefined);

    const resources = await call("resources/list", {});
    const card = (resources.resources || []).find((item) => item.uri === "ui://board-clerk/decision-card");
    assert.ok(card, JSON.stringify(resources.resources));
    assert.equal(card.mimeType, "text/html;profile=mcp-app");
    const readCard = await call("resources/read", { uri: "ui://board-clerk/decision-card" });
    const htmlCard = readCard.contents[0];
    assert.equal(htmlCard.mimeType, "text/html;profile=mcp-app");
    assert.match(htmlCard.text, /ui\/initialize/);
    assert.match(htmlCard.text, /appInfo/);
    assert.match(htmlCard.text, /ui\/notifications\/tool-result/);
    assert.match(htmlCard.text, /structuredContent/);
    assert.match(htmlCard.text, /<!DOCTYPE html>/i);

    const templates = await call("resources/templates/list", {});
    const uris = (templates.resourceTemplates || []).map((item) => item.uriTemplate);
    assert.ok(uris.some((uri) => String(uri).includes("board://")));
    assert.ok(uris.some((uri) => String(uri).includes("roster")));
    assert.ok(uris.some((uri) => String(uri).includes("meetings")));

    const prompts = await call("prompts/list", {});
    const ask = prompts.prompts.find((prompt) => prompt.name === "ask_the_board");
    assert.ok(ask);
    assert.equal(typeof ask.title, "string");
    const got = await call("prompts/get", { name: "ask_the_board", arguments: { question: "the roof" } });
    const promptText = JSON.stringify(got);
    assert.match(promptText, /what_did_we_decide/);
    assert.match(promptText, /confirm_mover_seconder/);
    assert.match(promptText, /prepare_board_packet/);
    assert.match(promptText, /start_demo_board/);
    assert.match(promptText, /do not say the minutes were approved/i);
    assert.match(promptText, /Never guess a mover or seconder/);
  });

  it("ingests, refuses approval until both names are confirmed, then approves", async () => {
    const { call } = await openSession(new MemoryStore());
    const board_id = "oct-board-demo";
    const ingested = await tool(call, "ingest_meeting", {
      board_id,
      transcript,
      meeting_date: "2026-10-15",
      roster: ROSTER,
    });
    assert.equal(ingested.isError, false, JSON.stringify(ingested.data));
    assert.equal(ingested.data.demo_board, false);
    assert.equal(ingested.data.meeting_id, "juniper-hollow-2026-10-15");
    assert.match(ingested.data.org, /Juniper Hollow/);
    assert.doesNotMatch(ingested.data.org, /^Board \(FICTIONAL\)$/);
    assert.match(ingested.data.title, /Regular board meeting|Juniper Hollow/i);
    assert.match(ingested.data.motions[0].agenda_item, /agenda/i);
    assert.equal(
      ingested.data.motions.some((motion) => /^Business item \d+$/.test(motion.agenda_item)),
      false,
    );

    const pending = await tool(call, "list_pending_confirmations", {
      board_id,
      meeting_id: ingested.data.meeting_id,
    });
    assert.equal(pending.data.count, 2, JSON.stringify(pending.data.pending));
    const requested = await tool(call, "request_minutes_approval", {
      board_id,
      meeting_id: ingested.data.meeting_id,
      approver_name: "Demo Judge",
    });
    assert.equal(requested.isError, false, JSON.stringify(requested.data));
    assert.match(requested.data.note || requested.result.content[0].text, /email/i);

    const refused = await tool(call, "approve_minutes", {
      board_id,
      meeting_id: ingested.data.meeting_id,
      approval_id: requested.data.id,
      approver_name: "Demo Judge",
    });
    assert.equal(refused.isError, true);
    assert.match(refused.data.error, /confirm/i);

    for (const item of pending.data.pending) {
      const value = item.field === "mover" ? "grace" : "trevino";
      const confirmed = await tool(call, "confirm_mover_seconder", {
        board_id,
        meeting_id: ingested.data.meeting_id,
        motion_id: item.motion_id,
        field: item.field,
        value,
        confirmed_by: "Demo Judge",
      });
      assert.equal(confirmed.isError, false, JSON.stringify(confirmed.data));
      assert.equal(
        confirmed.data.confirmation.value,
        item.field === "mover" ? "Grace Lindqvist" : "Luis Trevino",
      );
    }

    const approved = await tool(call, "approve_minutes", {
      board_id,
      meeting_id: ingested.data.meeting_id,
      approval_id: requested.data.id,
      approver_name: "Demo Judge",
    });
    assert.equal(approved.isError, false, JSON.stringify(approved.data));
    assert.equal(approved.data.status, "approved");
    assert.equal(approved.data.meeting_date, "2026-10-15");
    assert.match(approved.data.markdown, /## Motions/);

    const repeated = await tool(call, "approve_minutes", {
      board_id,
      meeting_id: ingested.data.meeting_id,
      approval_id: requested.data.id,
      approver_name: "Someone Else",
    });
    assert.equal(repeated.isError, false, JSON.stringify(repeated.data));
    assert.equal(repeated.data.status, "approved");
    assert.equal(repeated.data.approver_name, "Demo Judge");
  });

  it("shares confirmations and ingested meetings across handler instances", async () => {
    const store = new MemoryStore();
    const first = await openSession(store);
    const board_id = "cross-session-board";
    const ingested = await tool(first.call, "ingest_meeting", {
      board_id,
      transcript,
      meeting_date: "2026-10-15",
      roster: ROSTER,
    });
    assert.equal(ingested.isError, false, JSON.stringify(ingested.data));
    const pending = await tool(first.call, "list_pending_confirmations", {
      board_id,
      meeting_id: ingested.data.meeting_id,
    });
    const mover = pending.data.pending.find((item) => item.field === "mover");
    assert.ok(mover);
    const confirmed = await tool(first.call, "confirm_mover_seconder", {
      board_id,
      meeting_id: ingested.data.meeting_id,
      motion_id: mover.motion_id,
      field: "mover",
      value: "Ellison",
    });
    assert.equal(confirmed.data.confirmation.value, "Mark Ellison");

    const second = await openSession(store);
    const meetings = await tool(second.call, "list_meetings", { board_id });
    assert.ok(meetings.data.meetings.some((meeting) => meeting.meeting_id === ingested.data.meeting_id));
    const motion = await tool(second.call, "get_motion", {
      board_id,
      meeting_id: ingested.data.meeting_id,
      motion_id: mover.motion_id,
    });
    assert.equal(motion.data.attribution.mover.status, "CONFIRMED BY CLERK");
    assert.equal(motion.data.attribution.mover.value, "Mark Ellison");
    const still = await tool(second.call, "list_pending_confirmations", {
      board_id,
      meeting_id: ingested.data.meeting_id,
    });
    assert.equal(still.data.count, pending.data.count - 1);
  });

  it("keeps confirmations on one board invisible to another", async () => {
    const { call } = await openSession(new MemoryStore());
    for (const board_id of ["board-alpha", "board-beta"]) {
      const ingested = await tool(call, "ingest_meeting", {
        board_id,
        transcript,
        meeting_date: "2026-10-15",
        roster: ROSTER,
      });
      assert.equal(ingested.isError, false, board_id);
    }
    const pendingA = await tool(call, "list_pending_confirmations", { board_id: "board-alpha" });
    const item = pendingA.data.pending[0];
    await tool(call, "confirm_mover_seconder", {
      board_id: "board-alpha",
      meeting_id: item.meeting_id,
      motion_id: item.motion_id,
      field: item.field,
      value: "Dana Okafor",
    });
    const afterA = await tool(call, "list_pending_confirmations", { board_id: "board-alpha" });
    const afterB = await tool(call, "list_pending_confirmations", { board_id: "board-beta" });
    assert.equal(afterA.data.count, pendingA.data.count - 1);
    assert.equal(afterB.data.count, pendingA.data.count);
  });

  it("rejects oversized transcripts, bad board ids, non-roster names, and the meeting cap", async () => {
    const { call } = await openSession(new MemoryStore());
    const badBoard = await tool(call, "list_meetings", { board_id: "NO" });
    assert.equal(badBoard.isError, true);
    assert.match(badBoard.data.error, /invalid board_id/);

    const huge = await tool(call, "ingest_meeting", {
      board_id: "limit-board",
      transcript: "x".repeat(200 * 1024 + 1),
      meeting_date: "2026-10-15",
      roster: ROSTER,
    });
    assert.equal(huge.isError, true);
    assert.match(huge.data.error, /200 KB/);

    const locked = await tool(call, "confirm_mover_seconder", {
      meeting_id: "juniper-2026-09-17",
      motion_id: "M2",
      field: "mover",
      value: "E".repeat(81),
    });
    assert.equal(locked.isError, true);
    assert.match(locked.data.error, /read-only/);
    assert.match(locked.data.error, /start_demo_board/);

    const rosterBoard = "roster-board";
    const startedRoster = await tool(call, "start_demo_board", { board_id: rosterBoard });
    assert.equal(startedRoster.isError, false, JSON.stringify(startedRoster.data));

    const longName = await tool(call, "confirm_mover_seconder", {
      board_id: rosterBoard,
      meeting_id: "juniper-2026-09-17",
      motion_id: "M2",
      field: "mover",
      value: "E".repeat(81),
    });
    assert.equal(longName.isError, true);
    assert.match(longName.data.error, /80/);

    const stranger = await tool(call, "confirm_mover_seconder", {
      board_id: rosterBoard,
      meeting_id: "juniper-2026-09-17",
      motion_id: "M2",
      field: "mover",
      value: "Somebody Else",
    });
    assert.equal(stranger.isError, true);
    assert.match(stranger.data.error, /Roster:/);
    assert.match(stranger.data.error, /Dana Okafor/);

    const normalized = await tool(call, "confirm_mover_seconder", {
      board_id: rosterBoard,
      meeting_id: "juniper-2026-09-17",
      motion_id: "M2",
      field: "mover",
      value: "ellison",
    });
    assert.equal(normalized.isError, false, JSON.stringify(normalized.data));
    assert.equal(normalized.data.confirmation.value, "Mark Ellison");
    assert.equal(normalized.data.demo_board, false);

    const tiny = `[00:00:01] Dana Okafor: I move that we adjourn.
[00:00:02] Luis Trevino: Second.
[00:00:03] Dana Okafor: The motion carries.
`;
    const roster = [
      { name: "Dana Okafor", role: "President" },
      { name: "Luis Trevino", role: "Vice President" },
    ];
    for (let n = 1; n <= 25; n++) {
      const month = n <= 25 ? "03" : "04";
      const day = String(n).padStart(2, "0");
      const saved = await tool(call, "ingest_meeting", {
        board_id: "cap-board",
        transcript: tiny,
        meeting_date: `2024-${month}-${day}`,
        org: "Limit Check Club",
        title: "Cap check",
        roster,
      });
      assert.equal(saved.isError, false, `${n} ${JSON.stringify(saved.data)}`);
    }
    const overflow = await tool(call, "ingest_meeting", {
      board_id: "cap-board",
      transcript: tiny,
      meeting_date: "2024-04-02",
      org: "Limit Check Club",
      title: "Cap check",
      roster,
    });
    assert.equal(overflow.isError, true);
    assert.match(overflow.data.error, /25/);
  });

  it("flags the public demo, copies fixtures, and restores them on reset", async () => {
    const { call } = await openSession(new MemoryStore());
    const demo = await tool(call, "list_meetings", {});
    assert.equal(demo.data.demo_board, true);
    assert.equal(demo.data.board_id, "juniper-hollow-demo");
    assert.equal(demo.data.meetings.length, 2);

    const shadow = await tool(call, "ingest_meeting", {
      transcript: "[00:00:01] Dana Okafor: I move that we adjourn.\n",
      meeting_date: "2026-08-20",
      org: "Juniper",
      roster: ROSTER,
    });
    assert.equal(shadow.isError, true);
    assert.match(shadow.data.error, /read-only/);
    assert.match(shadow.data.error, /start_demo_board/);

    const copyId = "judge-copy-001";
    const started = await tool(call, "start_demo_board", { board_id: copyId });
    assert.equal(started.isError, false, JSON.stringify(started.data));
    assert.equal(started.data.demo_board, false);
    assert.deepEqual(started.data.meeting_ids.sort(), ["juniper-2026-08-20", "juniper-2026-09-17"]);
    const copied = await tool(call, "list_meetings", { board_id: copyId });
    assert.equal(copied.data.meetings.length, 2);
    assert.equal(copied.data.demo_board, false);
    const roof = await tool(call, "what_did_we_decide", { board_id: copyId, query: "what did we decide about the roof?" });
    assert.match(roof.data.top_answer, /August 20th/);
    assert.match(roof.data.top_answer, /forty-seven thousand nine hundred/);
    assert.equal(roof.isError, false);

    const shared = await tool(call, "start_demo_board", { board_id: "juniper-hollow-demo" });
    assert.equal(shared.isError, true);

    await tool(call, "reset_board", { board_id: copyId });
    const cleared = await tool(call, "list_meetings", { board_id: copyId });
    assert.equal(cleared.data.meetings.length, 0);

    const extra = await tool(call, "ingest_meeting", {
      transcript: `[00:00:01] Dana Okafor: I move that we adjourn.
[00:00:02] Luis Trevino: Second.
[00:00:03] Dana Okafor: The motion carries.
`,
      meeting_date: "2026-12-01",
      org: "Pine Club",
      title: "Extra",
      roster: ROSTER.slice(0, 2),
    });
    assert.equal(extra.isError, true);
    assert.match(extra.data.error, /read-only/);
    assert.match(extra.data.error, /start_demo_board/);
    const grown = await tool(call, "list_meetings", {});
    assert.equal(grown.data.meetings.length, 2);
    const reset = await tool(call, "reset_board", {});
    assert.equal(reset.isError, true);
    assert.match(reset.data.error, /read-only/);
    assert.match(reset.data.error, /start_demo_board/);
    const restored = await tool(call, "list_meetings", {});
    assert.equal(restored.data.meetings.length, 2);
    assert.deepEqual(
      restored.data.meetings.map((meeting) => meeting.meeting_id),
      ["juniper-2026-08-20", "juniper-2026-09-17"],
    );
  });

  it("refuses every write on the shared demo board, including an explicit id", async () => {
    const { call } = await openSession(new MemoryStore());
    const writes = [
      [
        "ingest_meeting",
        {
          transcript: "[00:00:01] Dana Okafor: I move that we adjourn.\n",
          meeting_date: "2026-12-01",
          org: "Pine Club",
          roster: ROSTER.slice(0, 2),
        },
      ],
      [
        "confirm_mover_seconder",
        { meeting_id: "juniper-2026-09-17", motion_id: "M2", field: "mover", value: "Ellison" },
      ],
      ["request_minutes_approval", { meeting_id: "juniper-2026-08-20", approver_name: "Demo Judge" }],
      [
        "approve_minutes",
        { meeting_id: "juniper-2026-08-20", approval_id: "apr-nope", approver_name: "Demo Judge" },
      ],
      ["reset_board", {}],
    ];
    for (const [name, args] of writes) {
      const omitted = await tool(call, name, args);
      assert.equal(omitted.isError, true, name);
      assert.match(omitted.data.error, /read-only/, name);
      assert.match(omitted.data.error, /start_demo_board/, name);
      const explicit = await tool(call, name, { ...args, board_id: "juniper-hollow-demo" });
      assert.equal(explicit.isError, true, `${name} explicit`);
      assert.match(explicit.data.error, /read-only/, name);
    }
    const listed = await tool(call, "list_meetings", {});
    assert.equal(listed.isError, false);
    assert.equal(listed.data.meetings.length, 2);
  });

  it("flags a second pass that disagrees on the seconder and does not store an invalid pass", async () => {
    const { call } = await openSession(new MemoryStore());
    const board_id = "crosscheck-board";
    const tiny = `[00:00:01] Dana Okafor: I move that we adjourn.
[00:00:02] Luis Trevino: Second.
[00:00:03] Dana Okafor: The motion carries.
`;
    const preview = await tool(call, "ingest_meeting", {
      board_id,
      transcript: tiny,
      meeting_date: "2026-11-01",
      org: "Crosscheck Club",
      title: "Crosscheck",
      roster: ROSTER.slice(0, 2),
    });
    assert.equal(preview.isError, false, JSON.stringify(preview.data));
    assert.equal(preview.data.crosschecked, false);
    const draft = preview.data.motions[0];
    const second = [
      {
        agenda_item: draft.agenda_item,
        motion_text: draft.motion_text,
        mover: "Okafor",
        seconder: "Ellison",
        outcome: draft.outcome,
        ayes: ["Dana Okafor", "Luis Trevino"],
        nays: [],
        motion_timestamp: draft.motion_timestamp,
        vote_timestamp: draft.vote_timestamp || draft.motion_timestamp,
        confidence: "high",
        uncertain_fields: [],
        evidence_quote: draft.motion_text,
      },
    ];
    const checked = await tool(call, "ingest_meeting", {
      board_id,
      transcript: tiny,
      meeting_date: "2026-11-01",
      org: "Crosscheck Club",
      title: "Crosscheck",
      roster: ROSTER.slice(0, 2),
      second_pass_motions: second,
    });
    assert.equal(checked.isError, false, JSON.stringify(checked.data));
    assert.equal(checked.data.crosschecked, true);
    const flagged = checked.data.motions.find((motion) =>
      (motion.flags || []).some((flag) => flag.startsWith("passes disagree on seconder:")),
    );
    assert.ok(flagged, JSON.stringify(checked.data.motions));
    assert.equal(flagged.attribution.seconder.status, "NEEDS CONFIRMATION");
    assert.match(checked.data.pending.map((item) => item.field).join(","), /seconder/);

    const badBoard = "bad-pass-board";
    const bad = await tool(call, "ingest_meeting", {
      board_id: badBoard,
      transcript: tiny,
      meeting_date: "2026-11-02",
      org: "Bad Pass Club",
      title: "Bad",
      roster: ROSTER.slice(0, 2),
      second_pass_motions: [{ agenda_item: "only one field" }],
    });
    assert.equal(bad.isError, true);
    assert.match(bad.data.error, /second_pass_motions is not valid/);
    const empty = await tool(call, "list_meetings", { board_id: badBoard });
    assert.equal(empty.data.meetings.length, 0);
  });

  it("builds a roof packet across the August bid and an ingested October change order", async () => {
    const { call } = await openSession(new MemoryStore());
    const board_id = "packet-board";
    const started = await tool(call, "start_demo_board", { board_id });
    assert.equal(started.isError, false, JSON.stringify(started.data));
    const before = await tool(call, "prepare_board_packet", { board_id, topic: "roof" });
    assert.equal(before.isError, false, JSON.stringify(before.data));
    assert.equal(before.data.motion_count, 1);
    assert.equal(before.data.approved_total_dollars, 47900);
    assert.match(before.data.spoken_summary, /\$47,900/);
    assert.equal(before.data.partial, false);

    const ingested = await tool(call, "ingest_meeting", {
      board_id,
      transcript,
      meeting_date: "2026-10-15",
      roster: ROSTER,
    });
    assert.equal(ingested.isError, false, JSON.stringify(ingested.data));
    const after = await tool(call, "prepare_board_packet", { board_id, topic: "roof" });
    assert.equal(after.isError, false, JSON.stringify(after.data));
    assert.equal(after.data.motion_count, 2, JSON.stringify(after.data.motions));
    assert.ok(after.data.motions.some((motion) => motion.meeting_date === "2026-08-20"));
    assert.ok(after.data.motions.some((motion) => motion.meeting_date === "2026-10-15"));
    assert.equal(after.data.approved_total_dollars, 50300);
    assert.match(after.data.spoken_summary, /\$50,300/);

    const study = await tool(call, "prepare_board_packet", { board_id, topic: "reserve study" });
    assert.equal(study.isError, false, JSON.stringify(study.data));
    assert.equal(study.data.partial, true);
    assert.match(study.data.spoken_summary, /No loaded motion mentions "study"/);
  });
});

describe("worker HTTP guards", () => {
  it("serves health JSON and the demo page", async () => {
    const health = await worker.fetch(new Request("http://127.0.0.1:8787/"));
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.protocol, "2025-11-25");
    assert.equal(body.demo, "/demo");
    assert.equal(body.version, SERVER_VERSION);
    assert.equal(body.version, "0.4.0");
    assert.ok(body.tools.includes("start_demo_board"));
    assert.ok(body.tools.includes("prepare_board_packet"));

    const healthPath = await worker.fetch(new Request("http://127.0.0.1:8787/health"));
    assert.equal(healthPath.status, 200);
    const healthBody = await healthPath.json();
    assert.equal(healthBody.version, body.version);

    const demo = await worker.fetch(new Request("http://127.0.0.1:8787/demo"));
    assert.equal(demo.status, 200);
    assert.match(demo.headers.get("content-type"), /text\/html/);
    const html = await demo.text();
    assert.match(html, /2025-11-25/);
    assert.match(html, /Simulated Alexa\+ experience · synthetic fictional board · not an Alexa device/);
    assert.match(html, /not an Alexa device/);
    assert.match(html, /fictional/i);
    assert.equal(html.includes("speechSynthesis"), false);
    assert.equal(html.includes("cdn."), false);
    assert.equal(html.includes("fonts.googleapis"), false);
    assert.match(html, /0\.4\.0/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /:focus-visible/);
    assert.match(html, /min-width:\s*1200px/);
    assert.match(html, /max-width:\s*899px/);
    assert.match(html, /params\.get\("reset"\)/);
    assert.match(html, /params\.get\("board"\)/);
    assert.match(html, /What did we decide about the roof\?/);
    assert.match(html, /Who seconded the pool resurfacing\?/);
    assert.doesNotMatch(html, /Who seconded the reserve study\?/);
    assert.match(html, /Board packet: roof/);
    assert.match(html, /prepare_board_packet/);
    assert.match(html, /Partial match/);
    assert.match(html, /data-testid", "board-packet"/);
    assert.match(html, /data-testid", "packet-total"/);
    assert.match(html, /What still needs confirming\?/);
    assert.match(html, /Draft last night's minutes/);
    assert.match(html, /Approve the minutes/);
    assert.match(html, /Ingest last night's meeting/);
    assert.match(html, /not the October 15 transcript/);
    assert.match(html, /Ingest last night's meeting first if that is the one you meant/);
    assert.match(html, /What Board Clerk did/);
    assert.match(html, /Spoken in recording/);
    assert.match(html, /Confirmed by clerk/);
    assert.match(html, /Needs confirmation/);
    assert.match(html, /Listen at /);
    assert.match(html, /confirm_mover_seconder/);
    for (const testid of [
      "sim-banner",
      "device",
      "board-id",
      "state-indicator",
      "question-echo",
      "answer",
      "decision-card",
      "pending-list",
      "minutes-view",
      "minutes-body",
      "approve-minutes",
      "refusal",
      "approved-banner",
      "utterance",
      "ask-btn",
      "mic",
      "prompt-chips",
      "ingest-meeting",
      "trace-pane",
      "mcp-trace",
    ]) {
      assert.match(html, new RegExp(`data-testid="${testid}"`), testid);
    }
    assert.match(html, /<label for="utterance">/);
  });

  it("serves the fictional October 15 transcript", async () => {
    const res = await worker.fetch(new Request("http://127.0.0.1:8787/demo/transcript.txt"));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/plain/);
    assert.equal(await res.text(), transcript);
    const post = await worker.fetch(
      new Request("http://127.0.0.1:8787/demo/transcript.txt", { method: "POST", body: "{}" }),
    );
    assert.equal(post.status, 404);
  });

  it("allowlists Origin and rejects /mcp bodies over 256 KB", async () => {
    const local = await postMcp("http://127.0.0.1:8787/mcp", { body: INIT_BODY });
    assert.equal(local.status, 200);
    assert.match(await local.text(), /2025-11-25/);

    const loopback = await postMcp("http://127.0.0.1:8787/mcp", {
      origin: "http://127.0.0.1:9999",
      body: INIT_BODY,
    });
    assert.equal(loopback.status, 200);

    const localhost = await postMcp("http://localhost:8787/mcp", {
      origin: "http://localhost:4321",
      body: INIT_BODY,
    });
    assert.equal(localhost.status, 200);

    const own = await postMcp("https://lumegrid-board-clerk-mcp.lumegridai.workers.dev/mcp", {
      origin: "https://lumegrid-board-clerk-mcp.lumegridai.workers.dev",
      body: INIT_BODY,
    });
    assert.equal(own.status, 200);

    const evil = await postMcp("http://127.0.0.1:8787/mcp", {
      origin: "https://evil.example",
      body: INIT_BODY,
    });
    assert.equal(evil.status, 403);

    const tlsLocal = await postMcp("http://127.0.0.1:8787/mcp", {
      origin: "https://localhost:8787",
      body: INIT_BODY,
    });
    assert.equal(tlsLocal.status, 403);

    const opaque = await postMcp("http://127.0.0.1:8787/mcp", { origin: "null", body: INIT_BODY });
    assert.equal(opaque.status, 403);

    const tooBig = await postMcp("http://127.0.0.1:8787/mcp", { body: "x".repeat(256 * 1024 + 1) });
    assert.equal(tooBig.status, 413);

    const exact = await postMcp("http://127.0.0.1:8787/mcp", { body: "x".repeat(256 * 1024) });
    assert.notEqual(exact.status, 413);
    assert.notEqual(exact.status, 403);

    const rebound = await postMcp("http://evil.example:8787/mcp", {
      origin: "http://evil.example:8787",
      body: INIT_BODY,
    });
    assert.equal(rebound.status, 403);
    const reboundBody = await rebound.json();
    assert.equal(JSON.stringify(reboundBody).includes("evil.example"), false);

    const bypass = await postMcp("http://127.0.0.1:8787/", {
      origin: "https://evil.example",
      body: INIT_BODY,
    });
    assert.equal(bypass.status, 404);
    const slash = await postMcp("http://127.0.0.1:8787/mcp/", {
      origin: "https://evil.example",
      body: INIT_BODY,
    });
    assert.equal(slash.status, 404);
  });
});
