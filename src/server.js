/**
 * MCP server "board-clerk" 0.4.0. Tools are state-aware (MemoryStore or BoardState DO).
 * No network calls. Approval requests are recorded only — email is never sent.
 */
import { McpServer, ResourceTemplate, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { FIXTURES } from "./engine.js";
import { crosscheck } from "./engine/crosscheck.js";
import { extractMeeting, transcriptMeta } from "./engine/extract.js";
import { rosterPeople } from "./engine/namerule.js";
import { draftMinutes } from "./engine/minutes.js";
import { prepareBoardPacket } from "./engine/packet.js";
import {
  confirmKey,
  confirmMoverSeconder,
  getDecision,
  getMotion,
  listMeetings,
  listMotions,
  listPendingConfirmations,
  whatDidWeDecide,
} from "./engine/query.js";
import { validateMotions } from "./engine/validate.js";
import { DEFAULT_BOARD_ID, LIMITS, MemoryStore, assertBoardId } from "./state.js";
import { DECISION_CARD_HTML, DECISION_CARD_MIME, DECISION_CARD_URI } from "./ui/decision-card.js";

export const SERVER_NAME = "board-clerk";
export const SERVER_VERSION = "0.4.0";
export const PROTOCOL_VERSION = "2025-11-25";

export const TOOL_NAMES = [
  "list_meetings",
  "list_motions",
  "get_motion",
  "get_decision",
  "what_did_we_decide",
  "prepare_board_packet",
  "list_pending_confirmations",
  "confirm_mover_seconder",
  "draft_minutes",
  "ingest_meeting",
  "request_minutes_approval",
  "list_approvals",
  "approve_minutes",
  "get_audit_log",
  "reset_board",
  "start_demo_board",
];

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const UI_META = { ui: { resourceUri: DECISION_CARD_URI } };
const READ_ONLY_MESSAGE =
  "juniper-hollow-demo is read-only. Call start_demo_board with your own board_id, then retry this write on that board.";
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const IDEMP = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const DESTROY = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

const boardId = z
  .string()
  .optional()
  .describe("Board id, ^[a-z0-9-]{3,40}$. Defaults to juniper-hollow-demo.");

const SLUG_DROP = new Set([
  "owners", "association", "board", "of", "directors", "the", "fictional", "inc", "a", "and",
]);

let fallbackStore;

export function getFallbackStore() {
  if (!fallbackStore) fallbackStore = new MemoryStore();
  return fallbackStore;
}

function toolResult(spoken, data, { isError = false } = {}) {
  const payload = data && typeof data === "object" && !Array.isArray(data) ? { ...data } : { value: data };
  if (typeof payload.board_id === "string") payload.demo_board = payload.board_id === DEFAULT_BOARD_ID;
  const line = String(spoken).replace(/[\r\n]+/g, " ").trim();
  const result = {
    content: [{ type: "text", text: `${line}\n${JSON.stringify(payload, null, 2)}` }],
    structuredContent: payload,
  };
  if (isError) result.isError = true;
  return result;
}

function fail(message, extra = {}) {
  return toolResult(message, { ok: false, error: message, ...extra }, { isError: true });
}

function boardOf(args) {
  const id = args?.board_id || DEFAULT_BOARD_ID;
  assertBoardId(id);
  return id;
}

function sharedWriteRefusal(board_id) {
  if (board_id !== DEFAULT_BOARD_ID) return null;
  return fail(READ_ONLY_MESSAGE, { board_id, read_only: true });
}

/** A second pass that names a different mover or seconder must not be treated as spoken. */
function applyPassDisagreements(meeting) {
  for (const mot of meeting.motions || []) {
    const flags = Array.isArray(mot.flags) ? mot.flags : [];
    mot.attribution = mot.attribution || {};
    for (const field of ["mover", "seconder"]) {
      if (!flags.some((flag) => String(flag).startsWith(`passes disagree on ${field}:`))) continue;
      const prev = mot.attribution[field] || {};
      mot.attribution[field] = {
        status: "NEEDS CONFIRMATION",
        reason: `second pass disagrees on ${field}`,
        ai_suggestion: prev.value || prev.ai_suggestion || mot[field] || "",
      };
      if (!Array.isArray(mot.uncertain_fields)) mot.uncertain_fields = [];
      if (!mot.uncertain_fields.includes(field)) mot.uncertain_fields.push(field);
    }
  }
}

function guard(fn) {
  return async (args) => {
    try {
      return await fn(args || {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const board_id = args?.board_id || DEFAULT_BOARD_ID;
      try {
        assertBoardId(board_id);
      } catch {
        return fail(message);
      }
      return fail(message, { board_id });
    }
  };
}

function useDurable(env) {
  return !!(env && env.BOARD_STATE && typeof env.BOARD_STATE.idFromName === "function");
}

async function callState(env, store, op, args) {
  const board_id = args.board_id || DEFAULT_BOARD_ID;
  assertBoardId(board_id);
  const withBoard = { ...args, board_id };
  if (useDurable(env)) {
    const id = env.BOARD_STATE.idFromName(board_id);
    const stub = env.BOARD_STATE.get(id);
    const res = await stub.fetch(
      new Request("https://board-state/op", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op, args: withBoard }),
      }),
    );
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || `state op ${op} failed`);
    return data.result;
  }
  return store.op(op, withBoard);
}

function mergeMeetings(board_id, ingested) {
  const map = new Map();
  if (board_id === DEFAULT_BOARD_ID) {
    for (const meeting of FIXTURES) map.set(meeting.meeting_id, meeting);
  }
  for (const meeting of ingested || []) map.set(meeting.meeting_id, meeting);
  return [...map.values()];
}

async function loadBoard(env, store, board_id) {
  const snap = await callState(env, store, "read_all", { board_id });
  const confirms = {};
  for (const confirmation of snap.confirms || []) {
    confirms[confirmKey(confirmation.meeting_id, confirmation.motion_id, confirmation.field)] = confirmation;
  }
  return {
    meetings: mergeMeetings(board_id, snap.meetings),
    ingested: snap.meetings || [],
    confirms,
    approvals: snap.approvals || [],
    audit: snap.audit || [],
  };
}

async function writeAudit(env, store, board_id, entry) {
  return callState(env, store, "append_audit", { board_id, entry });
}

export function meetingIdFor(org, title, meetingDate, existingIds) {
  const base = String(org || title || "meeting").toLowerCase();
  const slug = base
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const parts = slug.split("-").filter((word) => word && !SLUG_DROP.has(word));
  let id = `${parts.slice(0, 3).join("-") || "meeting"}-${meetingDate}`
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 60);
  if (id.length < 3) id = `meeting-${meetingDate}`;
  const ids = new Set(existingIds || []);
  if (!ids.has(id)) return id;
  let n = 2;
  while (ids.has(`${id}-${n}`)) n += 1;
  return `${id}-${n}`.slice(0, 64);
}

function transcriptBytes(text) {
  return new TextEncoder().encode(String(text || "")).length;
}

function rosterOf(meetings, board_id) {
  for (let i = meetings.length - 1; i >= 0; i--) {
    if (meetings[i].roster?.length) return meetings[i].roster;
  }
  if (board_id === DEFAULT_BOARD_ID && FIXTURES[0]?.roster) return FIXTURES[0].roster;
  return [];
}

function matchRosterMember(value, roster) {
  const trimmed = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!trimmed) {
    return { error: "value is required. Use a roster member's full name, first name, or last name." };
  }
  if (trimmed.length > LIMITS.maxConfirmChars) {
    return {
      error: "confirmation value exceeds 80 characters. Use a roster member's full name, first name, or last name.",
    };
  }
  const people = rosterPeople(roster);
  const rosterList = people.map((person) => person.name).join(", ");
  if (!people.length) {
    return {
      error:
        "This meeting has no roster. Ingest the meeting with roster names, or call start_demo_board, then confirm with a member's name.",
    };
  }
  const lower = trimmed.toLowerCase();
  const parts = lower.split(" ").filter(Boolean);
  const hits = [];
  const seen = new Set();
  for (const person of people) {
    const full = person.name.toLowerCase();
    const first = person.first.toLowerCase();
    const last = person.last.toLowerCase();
    const matched =
      full === lower ||
      (parts.length === 1 && (first === lower || last === lower)) ||
      (parts.length >= 2 && first === parts[0] && last === parts[parts.length - 1]);
    if (!matched || seen.has(person.name)) continue;
    seen.add(person.name);
    hits.push(person);
  }
  if (hits.length === 1) {
    if (hits[0].name.length > LIMITS.maxConfirmChars) {
      return {
        error: "confirmation value exceeds 80 characters. Use a roster member's full name, first name, or last name.",
      };
    }
    return { name: hits[0].name };
  }
  if (hits.length > 1) {
    return {
      error: `"${trimmed}" matches more than one roster member (${hits.map((person) => person.name).join(", ")}). Use a full name. Roster: ${rosterList}.`,
    };
  }
  return {
    error: `No roster member matches "${trimmed}". Roster: ${rosterList}. Use a full name, first name, or last name.`,
  };
}

function resourceBody(uri, payload) {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType: "application/json",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function createBoardServer({ env, store } = {}) {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const ctx = { env, store: store || getFallbackStore() };

  server.registerTool(
    "list_meetings",
    {
      title: "List meetings",
      description: "List board meetings on this board (seeded fixtures plus ingested). Synthetic data.",
      inputSchema: { board_id: boardId },
      annotations: RO,
    },
    guard(async (args) => {
      const board_id = boardOf(args);
      const { meetings, confirms } = await loadBoard(ctx.env, ctx.store, board_id);
      const listed = listMeetings(meetings, confirms);
      return toolResult(`There are ${listed.length} meetings on this board.`, {
        board_id,
        meetings: listed,
        note: "FICTIONAL synthetic data only.",
      });
    }),
  );

  server.registerTool(
    "list_motions",
    {
      title: "List motions",
      description: "List motions for a meeting with mover/seconder attribution status.",
      inputSchema: {
        board_id: boardId,
        meeting_id: z.string().optional().describe("Meeting id. Defaults to the latest meeting."),
      },
      annotations: RO,
    },
    guard(async (args) => {
      const board_id = boardOf(args);
      const { meetings, confirms } = await loadBoard(ctx.env, ctx.store, board_id);
      const listed = listMotions(meetings, args.meeting_id, confirms);
      return toolResult(`${listed.motions.length} motions in ${listed.meeting_id}.`, { board_id, ...listed });
    }),
  );

  server.registerTool(
    "get_motion",
    {
      title: "Get motion",
      description: "Get one motion with tally, timestamps, evidence quote, and attribution.",
      inputSchema: {
        board_id: boardId,
        meeting_id: z.string().optional(),
        motion_id: z.string().describe("Motion id, for example M2"),
      },
      annotations: RO,
    },
    guard(async (args) => {
      const board_id = boardOf(args);
      const { meetings, confirms } = await loadBoard(ctx.env, ctx.store, board_id);
      const motion = getMotion(meetings, args.meeting_id, args.motion_id, confirms);
      return toolResult(
        `${motion.motion_id} ${motion.outcome} (${motion.tally}). Mover ${motion.mover}.`,
        { board_id, ...motion },
      );
    }),
  );

  server.registerTool(
    "get_decision",
    {
      title: "Get decision",
      description: "Short decision card for a motion: outcome, tally, mover/seconder, evidence.",
      inputSchema: {
        board_id: boardId,
        meeting_id: z.string().optional(),
        motion_id: z.string().describe("Motion id, for example M2"),
      },
      annotations: RO,
      _meta: UI_META,
    },
    guard(async (args) => {
      const board_id = boardOf(args);
      const { meetings, confirms } = await loadBoard(ctx.env, ctx.store, board_id);
      const decision = getDecision(meetings, args.meeting_id, args.motion_id, confirms);
      return toolResult(decision.decision, { board_id, ...decision });
    }),
  );

  server.registerTool(
    "what_did_we_decide",
    {
      title: "What did we decide",
      description: "Search decisions across meetings. Example: what did we decide about the roof?",
      inputSchema: {
        board_id: boardId,
        query: z.string().describe("Natural language query, for example roof bid or pool resurfacing"),
        date_from: z.string().optional().describe("Optional YYYY-MM-DD lower bound"),
        date_to: z.string().optional().describe("Optional YYYY-MM-DD upper bound"),
        meeting_id: z.string().optional().describe("Limit to one meeting"),
      },
      annotations: RO,
      _meta: UI_META,
    },
    guard(async (args) => {
      const board_id = boardOf(args);
      const { meetings, confirms } = await loadBoard(ctx.env, ctx.store, board_id);
      const found = whatDidWeDecide(
        meetings,
        args.query,
        { date_from: args.date_from, date_to: args.date_to, meeting_id: args.meeting_id },
        confirms,
      );
      return toolResult(found.top_answer, { board_id, ...found });
    }),
  );

  server.registerTool(
    "prepare_board_packet",
    {
      title: "Prepare a board packet",
      description:
        "Gather every motion on one topic across meetings, total approved dollar amounts parsed from the motion text, and list open confirmations and tabled items. Deterministic. No model call.",
      inputSchema: {
        board_id: boardId,
        topic: z.string().describe("Topic, for example roof or pool resurfacing"),
      },
      annotations: RO,
    },
    guard(async (args) => {
      const board_id = boardOf(args);
      const { meetings, confirms } = await loadBoard(ctx.env, ctx.store, board_id);
      const packet = prepareBoardPacket(meetings, args.topic, confirms);
      return toolResult(packet.spoken_summary, { board_id, ...packet });
    }),
  );

  server.registerTool(
    "list_pending_confirmations",
    {
      title: "List pending confirmations",
      description: "Mover/seconder fields that still need a clerk confirm because the name was not spoken.",
      inputSchema: {
        board_id: boardId,
        meeting_id: z.string().optional().describe("Optional meeting filter"),
      },
      annotations: RO,
    },
    guard(async (args) => {
      const board_id = boardOf(args);
      const { meetings, confirms } = await loadBoard(ctx.env, ctx.store, board_id);
      const pending = listPendingConfirmations(meetings, args.meeting_id, confirms);
      return toolResult(`${pending.count} mover or seconder fields need confirmation.`, { board_id, ...pending });
    }),
  );

  server.registerTool(
    "confirm_mover_seconder",
    {
      title: "Confirm mover or seconder",
      description:
        "Persist a clerk confirmation for mover or seconder. Stored for later sessions. Does not email anyone. juniper-hollow-demo is read-only; call start_demo_board with your own id first.",
      inputSchema: {
        board_id: boardId,
        meeting_id: z.string().describe("Meeting id"),
        motion_id: z.string().describe("Motion id, for example M2"),
        field: z.enum(["mover", "seconder"]),
        value: z.string().describe("Confirmed person name. At most 80 characters."),
        confirmed_by: z.string().optional().describe("Who confirmed. Defaults to Board Clerk (demo)."),
      },
      annotations: IDEMP,
    },
    guard(async (args) => {
      const board_id = boardOf(args);
      const refused = sharedWriteRefusal(board_id);
      if (refused) return refused;
      const { meetings, confirms } = await loadBoard(ctx.env, ctx.store, board_id);
      const meeting = meetings.find((item) => item.meeting_id === args.meeting_id);
      if (!meeting) {
        return fail(
          `Unknown meeting_id "${args.meeting_id}". Known: ${meetings.map((item) => item.meeting_id).join(", ") || "(none)"}.`,
          { board_id },
        );
      }
      if (args.confirmed_by && String(args.confirmed_by).trim().length > LIMITS.maxConfirmChars) {
        return fail("confirmed_by exceeds 80 characters. Use a short name, for example Board Clerk.", {
          board_id,
          meeting_id: args.meeting_id,
        });
      }
      const roster = meeting.roster?.length ? meeting.roster : rosterOf(meetings, board_id);
      const matched = matchRosterMember(args.value, roster);
      if (matched.error) return fail(matched.error, { board_id, meeting_id: args.meeting_id });
      const { confirmation, motion } = confirmMoverSeconder(meetings, { ...args, value: matched.name }, confirms);
      await callState(ctx.env, ctx.store, "put_confirm", { board_id, confirmation });
      await writeAudit(ctx.env, ctx.store, board_id, {
        who: confirmation.confirmed_by,
        what: "confirm_mover_seconder",
        meeting_id: confirmation.meeting_id,
        detail: { motion_id: confirmation.motion_id, field: confirmation.field, value: confirmation.value },
      });
      return toolResult(
        `Confirmed ${confirmation.field} as ${confirmation.value} on ${confirmation.motion_id}.`,
        { ok: true, board_id, confirmation, motion },
      );
    }),
  );

  server.registerTool(
    "draft_minutes",
    {
      title: "Draft minutes",
      description: "Render draft minutes markdown. Board approval is still required. Nothing is sent.",
      inputSchema: {
        board_id: boardId,
        meeting_id: z.string().optional().describe("Meeting id. Defaults to the latest meeting."),
      },
      annotations: RO,
    },
    guard(async (args) => {
      const board_id = boardOf(args);
      const { meetings, confirms } = await loadBoard(ctx.env, ctx.store, board_id);
      const draft = draftMinutes(meetings, args.meeting_id, confirms);
      return toolResult(`Draft minutes for ${draft.meeting_id}. Board approval is still required.`, {
        board_id,
        ...draft,
      });
    }),
  );

  server.registerTool(
    "ingest_meeting",
    {
      title: "Ingest meeting",
      description:
        "Extract motions from a clean [HH:MM:SS] Speaker: text transcript with the rule baseline and store the meeting. Optional second_pass_motions runs crosscheck and flags disagreements. No model call. juniper-hollow-demo is read-only.",
      inputSchema: {
        board_id: boardId,
        transcript: z.string().describe("Timestamped transcript. Maximum 200 KB. Lines starting with # are ignored."),
        meeting_date: z.string().describe("YYYY-MM-DD"),
        title: z.string().optional(),
        org: z.string().optional(),
        roster: z
          .array(z.object({ name: z.string(), role: z.string() }))
          .min(1)
          .max(40)
          .describe("Directors and staff, {name, role}. At most 40 people."),
        second_pass_motions: z
          .array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])))
          .optional()
          .describe(
            "Optional independent pass, one object per motion. Validated with the motion schema. Disagreements are flagged and the disagreed name needs confirmation.",
          ),
      },
      annotations: WRITE,
    },
    guard(async (args) => {
      const board_id = boardOf(args);
      const refused = sharedWriteRefusal(board_id);
      if (refused) return refused;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.meeting_date || "")) {
        return fail("meeting_date must be YYYY-MM-DD, for example 2026-10-15.", { board_id });
      }
      if (transcriptBytes(args.transcript) > LIMITS.transcriptBytes) {
        return fail("transcript exceeds 200 KB. Shorten it or split the meeting, then ingest again.", { board_id });
      }
      const loaded = await loadBoard(ctx.env, ctx.store, board_id);
      const meta = transcriptMeta(args.transcript);
      const org = String(args.org || "").trim() || meta.org;
      const title = String(args.title || "").trim() || meta.title;
      const meeting_id = meetingIdFor(
        org,
        title,
        args.meeting_date,
        loaded.ingested.map((meeting) => meeting.meeting_id),
      );
      if (board_id === DEFAULT_BOARD_ID && FIXTURES.some((meeting) => meeting.meeting_id === meeting_id)) {
        return fail(
          `Meeting id ${meeting_id} is a seeded fixture on the public demo board. Call start_demo_board with a new board_id, then ingest there so the shared demo is not overwritten.`,
          { board_id, meeting_id },
        );
      }
      const replacing = loaded.ingested.some((meeting) => meeting.meeting_id === meeting_id);
      if (!replacing && loaded.ingested.length >= LIMITS.maxIngestedMeetings) {
        return fail("ingested meeting limit is 25. Call reset_board or use another board_id.", { board_id });
      }
      const meeting = extractMeeting({
        transcript: args.transcript,
        roster: args.roster,
        meeting_id,
        meeting_date: args.meeting_date,
        org,
        title,
      });
      let crosschecked = false;
      if (args.second_pass_motions != null) {
        const checked = validateMotions(args.second_pass_motions);
        if (!checked.ok) {
          const detail = checked.errors.map((error) => `motion ${error.index}: ${error.message}`).join("; ");
          return fail(`second_pass_motions is not valid. ${detail} Nothing was stored.`, { board_id });
        }
        crosscheck(meeting, { motions: checked.motions });
        applyPassDisagreements(meeting);
        crosschecked = true;
      }
      await callState(ctx.env, ctx.store, "put_meeting", { board_id, meeting });
      await writeAudit(ctx.env, ctx.store, board_id, {
        who: "Board Clerk",
        what: "ingest_meeting",
        meeting_id,
        detail: { motion_count: meeting.motions.length, meeting_date: meeting.meeting_date },
      });
      const pending = listPendingConfirmations([meeting], meeting_id, {});
      const motions = listMotions([meeting], meeting_id, {});
      return toolResult(
        `Ingested ${meeting_id}. ${motions.motions.length} motions, ${pending.count} need confirmation.`,
        {
          ok: true,
          board_id,
          meeting_id,
          meeting_date: meeting.meeting_date,
          org: meeting.org,
          title: meeting.title,
          motions: motions.motions,
          pending: pending.pending,
          count: pending.count,
          crosschecked,
        },
      );
    }),
  );

  server.registerTool(
    "request_minutes_approval",
    {
      title: "Request minutes approval",
      description:
        "Record a pending minutes approval request. Never sends email or any other message. juniper-hollow-demo is read-only; call start_demo_board with your own id first.",
      inputSchema: {
        board_id: boardId,
        meeting_id: z.string(),
        approver_name: z.string().min(1),
      },
      annotations: WRITE,
    },
    guard(async (args) => {
      const board_id = boardOf(args);
      const refused = sharedWriteRefusal(board_id);
      if (refused) return refused;
      if (String(args.approver_name || "").trim().length > LIMITS.maxConfirmChars) {
        return fail("approver_name exceeds 80 characters. Use a short name, for example Demo Judge.", {
          board_id,
          meeting_id: args.meeting_id,
        });
      }
      const { meetings } = await loadBoard(ctx.env, ctx.store, board_id);
      const meeting = meetings.find((item) => item.meeting_id === args.meeting_id);
      if (!meeting) {
        return fail(
          `Unknown meeting_id "${args.meeting_id}". Known: ${meetings.map((item) => item.meeting_id).join(", ") || "(none)"}.`,
          { board_id },
        );
      }
      const approval = {
        id: `apr-${crypto.randomUUID()}`,
        meeting_id: args.meeting_id,
        approver_name: args.approver_name,
        status: "pending",
        requested_at: new Date().toISOString(),
        approved_at: null,
      };
      await callState(ctx.env, ctx.store, "put_approval", { board_id, approval });
      await writeAudit(ctx.env, ctx.store, board_id, {
        who: args.approver_name,
        what: "request_minutes_approval",
        meeting_id: args.meeting_id,
        detail: { approval_id: approval.id },
      });
      return toolResult("Approval request recorded only. No email was sent.", {
        ok: true,
        board_id,
        ...approval,
        note: "Recorded only. No email was sent.",
      });
    }),
  );

  server.registerTool(
    "list_approvals",
    {
      title: "List minutes approvals",
      description: "List recorded minutes approval requests. Nothing is emailed.",
      inputSchema: {
        board_id: boardId,
        meeting_id: z.string().optional(),
      },
      annotations: RO,
    },
    guard(async (args) => {
      const board_id = boardOf(args);
      const { approvals } = await loadBoard(ctx.env, ctx.store, board_id);
      const listed = args.meeting_id
        ? approvals.filter((approval) => approval.meeting_id === args.meeting_id)
        : approvals;
      return toolResult(`${listed.length} approval requests.`, {
        board_id,
        approvals: listed,
        count: listed.length,
      });
    }),
  );

  server.registerTool(
    "approve_minutes",
    {
      title: "Approve minutes",
      description:
        "Mark a recorded approval request approved and return final minutes. Refuses while any mover or seconder on that meeting still needs confirmation. Never sends email. juniper-hollow-demo is read-only.",
      inputSchema: {
        board_id: boardId,
        meeting_id: z.string(),
        approval_id: z.string(),
        approver_name: z.string().min(1),
      },
      annotations: IDEMP,
    },
    guard(async (args) => {
      const board_id = boardOf(args);
      const refused = sharedWriteRefusal(board_id);
      if (refused) return refused;
      if (String(args.approver_name || "").trim().length > LIMITS.maxConfirmChars) {
        return fail("approver_name exceeds 80 characters. Use a short name, for example Demo Judge.", {
          board_id,
          meeting_id: args.meeting_id,
        });
      }
      const { meetings, confirms, approvals } = await loadBoard(ctx.env, ctx.store, board_id);
      const approval = approvals.find((item) => item.id === args.approval_id);
      if (!approval) {
        return fail(
          `Unknown approval_id "${args.approval_id}". Call request_minutes_approval for this meeting first. Nothing was emailed.`,
          { board_id, meeting_id: args.meeting_id },
        );
      }
      if (approval.meeting_id !== args.meeting_id) {
        return fail("approval_id does not match meeting_id. Pass the meeting_id from the approval request.", {
          board_id,
          meeting_id: args.meeting_id,
          approval_id: args.approval_id,
        });
      }
      const pending = listPendingConfirmations(meetings, args.meeting_id, confirms);
      if (pending.count > 0) {
        return fail(
          "Cannot approve minutes while a mover or seconder still needs confirmation. Confirm each pending name with confirm_mover_seconder, then call approve_minutes again.",
          {
            board_id,
            meeting_id: args.meeting_id,
            approval_id: args.approval_id,
            pending: pending.pending,
            count: pending.count,
          },
        );
      }
      let status = approval.status;
      let approverName = approval.approver_name;
      if (status !== "approved") {
        const updated = await callState(ctx.env, ctx.store, "patch_approval", {
          board_id,
          id: approval.id,
          patch: {
            status: "approved",
            approver_name: args.approver_name,
            approved_at: new Date().toISOString(),
          },
        });
        status = updated.status;
        approverName = updated.approver_name;
        await writeAudit(ctx.env, ctx.store, board_id, {
          who: args.approver_name,
          what: "approve_minutes",
          meeting_id: args.meeting_id,
          detail: { approval_id: approval.id },
        });
      }
      const draft = draftMinutes(meetings, args.meeting_id, confirms);
      return toolResult(`Minutes approved for ${args.meeting_id}. No email was sent.`, {
        ok: true,
        board_id,
        meeting_id: args.meeting_id,
        approval_id: args.approval_id,
        status,
        approver_name: approverName,
        meeting_date: draft.meeting_date,
        markdown: draft.markdown,
        note: "Recorded only. No email was sent.",
      });
    }),
  );

  server.registerTool(
    "get_audit_log",
    {
      title: "Get audit log",
      description: "Append-only audit entries for this board (who, what, when). Optional meeting filter.",
      inputSchema: {
        board_id: boardId,
        meeting_id: z.string().optional(),
      },
      annotations: RO,
    },
    guard(async (args) => {
      const board_id = boardOf(args);
      let entries = await callState(ctx.env, ctx.store, "list_audit", {
        board_id,
        meeting_id: args.meeting_id,
      });
      if (!Array.isArray(entries)) entries = [];
      return toolResult(`${entries.length} audit entries.`, { board_id, entries, count: entries.length });
    }),
  );

  server.registerTool(
    "reset_board",
    {
      title: "Reset board",
      description:
        "Clear ingested meetings, confirmations, approvals, and the audit log for this board. Refuses juniper-hollow-demo, which is read-only. Call start_demo_board with your own id.",
      inputSchema: { board_id: boardId },
      annotations: DESTROY,
    },
    guard(async (args) => {
      const board_id = boardOf(args);
      const refused = sharedWriteRefusal(board_id);
      if (refused) return refused;
      await callState(ctx.env, ctx.store, "reset", { board_id });
      await writeAudit(ctx.env, ctx.store, board_id, {
        who: "Board Clerk",
        what: "reset_board",
        meeting_id: null,
        detail: { board_id },
      });
      const seeded = board_id === DEFAULT_BOARD_ID;
      return toolResult(
        seeded
          ? "Cleared layered state for this board. Seeded fixtures remain."
          : "Cleared layered state for this board.",
        { ok: true, board_id, seeded_fixtures: seeded },
      );
    }),
  );

  server.registerTool(
    "start_demo_board",
    {
      title: "Start an isolated demo board",
      description:
        "Copy the two fictional Juniper Hollow fixture meetings into a new board so a judge has a private full copy. Does not change the shared juniper-hollow-demo board.",
      inputSchema: {
        board_id: z
          .string()
          .describe("New board id, ^[a-z0-9-]{3,40}$. Do not pass juniper-hollow-demo."),
      },
      annotations: WRITE,
    },
    guard(async (args) => {
      if (!args.board_id) {
        return fail(
          "board_id is required. Choose 3 to 40 lowercase letters, digits, or hyphens, for example judge-demo-01.",
        );
      }
      const board_id = args.board_id;
      assertBoardId(board_id);
      if (board_id === DEFAULT_BOARD_ID) {
        return fail(
          "juniper-hollow-demo is read-only and already includes the fixtures. Call start_demo_board with your own board_id.",
          { board_id, read_only: true },
        );
      }
      const loaded = await loadBoard(ctx.env, ctx.store, board_id);
      const have = new Set(loaded.ingested.map((meeting) => meeting.meeting_id));
      const incoming = FIXTURES.filter((meeting) => !have.has(meeting.meeting_id));
      if (loaded.ingested.length + incoming.length > LIMITS.maxIngestedMeetings) {
        return fail(
          "ingested meeting limit is 25. reset_board or choose an empty board_id before start_demo_board.",
          { board_id },
        );
      }
      const meeting_ids = [];
      for (const fixture of FIXTURES) {
        const meeting = structuredClone(fixture);
        await callState(ctx.env, ctx.store, "put_meeting", { board_id, meeting });
        meeting_ids.push(meeting.meeting_id);
      }
      await writeAudit(ctx.env, ctx.store, board_id, {
        who: "Board Clerk",
        what: "start_demo_board",
        meeting_id: null,
        detail: { meeting_ids },
      });
      return toolResult(
        `Isolated demo board ${board_id} is ready with the two fictional Juniper Hollow meetings.`,
        { ok: true, board_id, meeting_ids, synthetic: true },
      );
    }),
  );

  server.registerResource(
    "roster",
    new ResourceTemplate("board://{board_id}/roster", {
      list: async () => ({
        resources: [
          {
            uri: `board://${DEFAULT_BOARD_ID}/roster`,
            name: "demo-roster",
            mimeType: "application/json",
          },
        ],
      }),
    }),
    {
      title: "Board roster",
      description: "Roster for a board. Synthetic fictional names only.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const board_id = variables?.board_id || DEFAULT_BOARD_ID;
      assertBoardId(board_id);
      const { meetings } = await loadBoard(ctx.env, ctx.store, board_id);
      return resourceBody(uri, { board_id, roster: rosterOf(meetings, board_id), synthetic: true });
    },
  );

  server.registerResource(
    "meetings",
    new ResourceTemplate("board://{board_id}/meetings", {
      list: async () => ({
        resources: [
          {
            uri: `board://${DEFAULT_BOARD_ID}/meetings`,
            name: "demo-meetings",
            mimeType: "application/json",
          },
        ],
      }),
    }),
    {
      title: "Board meetings",
      description: "Meetings on a board: seeded fixtures plus ingested sessions.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const board_id = variables?.board_id || DEFAULT_BOARD_ID;
      assertBoardId(board_id);
      const { meetings, confirms } = await loadBoard(ctx.env, ctx.store, board_id);
      return resourceBody(uri, {
        board_id,
        meetings: listMeetings(meetings, confirms),
        synthetic: true,
      });
    },
  );

  server.registerResource(
    "decision-card",
    DECISION_CARD_URI,
    {
      title: "Decision card",
      description:
        "Interactive HTML card for get_decision and what_did_we_decide. The host renders structuredContent. Text results still stand on their own.",
      mimeType: DECISION_CARD_MIME,
      _meta: { ui: { prefersBorder: true } },
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: DECISION_CARD_MIME,
          text: DECISION_CARD_HTML,
          _meta: { ui: { prefersBorder: true } },
        },
      ],
    }),
  );

  server.registerPrompt(
    "ask_the_board",
    {
      title: "Ask the board",
      description:
        "Clerk loop: search with what_did_we_decide and cite the motion plus its timestamp, use prepare_board_packet for a topic across meetings, confirm names before approving, and call start_demo_board before any write. Never claim an email was sent.",
      argsSchema: {
        question: z.string().describe("Question about a board decision"),
      },
    },
    async ({ question }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Question: ${question}\n\n` +
              "Call what_did_we_decide with this question and the caller's board_id. " +
              "Cite the motion text and the motion timestamp. " +
              "If top_answer says no loaded motion mentions a word, say that first and then the closest match. Do not pretend the closest match is the thing they asked about. " +
              "Answer with the motion, outcome, tally, mover and seconder status, and timestamp. " +
              "Never guess a mover or seconder. If a name is unconfirmed, say so and call list_pending_confirmations. " +
              "Confirm only with confirm_mover_seconder using a roster name. " +
              "For a topic that spans meetings, call prepare_board_packet and read its spoken_summary. " +
              "juniper-hollow-demo is read-only. Call start_demo_board with a new board_id before ingest, confirm, approval, or reset. " +
              "Draft with draft_minutes. Approve with request_minutes_approval, then approve_minutes. " +
              "If approve_minutes returns an error, do not say the minutes were approved. " +
              "Nothing is emailed. Use only tool results. The records are fictional. Do not invent a vote.",
          },
        },
      ],
    }),
  );

  return server;
}

export function createHandler({ env, store } = {}) {
  const resolved = store || getFallbackStore();
  // SDK 2.3.1 createMcpHandler has no `route` option. src/index.js mounts this only at /mcp.
  return createMcpHandler(() => createBoardServer({ env, store: resolved }), {
    onerror: (err) => console.error("board-clerk mcp error", err),
  });
}

export function healthBody() {
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    mcp: "/mcp",
    protocol: PROTOCOL_VERSION,
    transport: "streamable-http",
    synthetic: true,
    demo: "/demo",
    tools: TOOL_NAMES,
  };
}
