/**
 * Board state across MCP sessions.
 * BoardState is a SQLite-backed Durable Object (one instance per board_id).
 * MemoryStore speaks the same POST /op JSON RPC for tests and for Workers with no binding.
 * Fixtures are not stored here; callers layer them on for the default board.
 */

export const DEFAULT_BOARD_ID = "juniper-hollow-demo";
export const BOARD_ID_RE = /^[a-z0-9-]{3,40}$/;
export const LIMITS = {
  transcriptBytes: 200 * 1024,
  maxIngestedMeetings: 25,
  maxConfirmChars: 80,
  maxApprovals: 40,
  maxAuditEntries: 200,
};

export function assertBoardId(id) {
  if (!BOARD_ID_RE.test(String(id || ""))) {
    throw new Error(
      "invalid board_id. Use 3 to 40 characters: lowercase letters, digits, and hyphens (example: juniper-hollow-demo).",
    );
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function decode(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

async function entriesWithPrefix(storage, prefix) {
  const listed = await storage.list(prefix ? { prefix } : {});
  if (listed instanceof Map) {
    return [...listed.entries()]
      .map(([key, value]) => [key, decode(value)])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
  const keys = [];
  if (listed && Array.isArray(listed.keys)) {
    for (const key of listed.keys) keys.push(typeof key === "string" ? key : key.name);
  }
  keys.sort();
  const out = [];
  for (const name of keys) {
    if (prefix && !name.startsWith(prefix)) continue;
    out.push([name, decode(await storage.get(name))]);
  }
  return out;
}

async function values(storage, prefix) {
  const pairs = await entriesWithPrefix(storage, prefix);
  return pairs.map(([, value]) => value).filter((value) => value != null);
}

export async function dispatch(storage, op, args = {}) {
  switch (op) {
    case "read_all":
      return {
        meetings: await values(storage, "meeting:"),
        confirms: await values(storage, "confirm:"),
        approvals: await values(storage, "approval:"),
        audit: await values(storage, "audit:"),
      };
    case "list_ingested":
      return await values(storage, "meeting:");
    case "put_meeting": {
      const meeting = args.meeting;
      if (!meeting?.meeting_id) throw new Error("meeting_id is required");
      const existing = await entriesWithPrefix(storage, "meeting:");
      const key = `meeting:${meeting.meeting_id}`;
      const already = existing.some(([name]) => name === key);
      if (!already && existing.length >= LIMITS.maxIngestedMeetings) {
        throw new Error("ingested meeting limit is 25");
      }
      await storage.put(key, meeting);
      return { meeting_id: meeting.meeting_id };
    }
    case "list_confirms":
      return await values(storage, "confirm:");
    case "put_confirm": {
      const confirmation = args.confirmation;
      if (!confirmation?.meeting_id || !confirmation?.motion_id || !confirmation?.field) {
        throw new Error("confirmation is incomplete");
      }
      const value = String(confirmation.value || "").trim();
      if (!value) throw new Error("value is required");
      if (value.length > LIMITS.maxConfirmChars) throw new Error("confirmation value exceeds 80 characters");
      const rec = { ...confirmation, value };
      await storage.put(`confirm:${rec.meeting_id}::${rec.motion_id}::${rec.field}`, rec);
      return rec;
    }
    case "list_approvals":
      return await values(storage, "approval:");
    case "put_approval": {
      const approval = args.approval;
      if (!approval?.id) throw new Error("approval id is required");
      const key = `approval:${approval.id}`;
      const existing = await entriesWithPrefix(storage, "approval:");
      const already = existing.some(([name]) => name === key);
      if (!already && existing.length >= LIMITS.maxApprovals) {
        throw new Error("approval request limit is 40. Call reset_board before recording another.");
      }
      await storage.put(key, approval);
      return approval;
    }
    case "patch_approval": {
      const current = decode(await storage.get(`approval:${args.id}`));
      if (!current) throw new Error("unknown approval_id");
      const next = { ...current, ...(args.patch || {}) };
      await storage.put(`approval:${args.id}`, next);
      return next;
    }
    case "list_audit": {
      let entries = await values(storage, "audit:");
      if (args.meeting_id) entries = entries.filter((entry) => entry.meeting_id === args.meeting_id);
      return entries;
    }
    case "append_audit": {
      const existing = await entriesWithPrefix(storage, "audit:");
      if (existing.length >= LIMITS.maxAuditEntries) {
        throw new Error("audit log limit is 200. Call reset_board to clear it.");
      }
      const meta = decode(await storage.get("meta")) || { seq: 0 };
      meta.seq = (meta.seq || 0) + 1;
      await storage.put("meta", meta);
      const src = args.entry || {};
      const entry = {
        id: `aud-${meta.seq}`,
        at: src.at || new Date().toISOString(),
        who: src.who || "Board Clerk",
        what: src.what || "event",
        meeting_id: src.meeting_id ?? null,
        detail: src.detail ?? null,
      };
      await storage.put(`audit:${String(meta.seq).padStart(8, "0")}`, entry);
      return entry;
    }
    case "reset": {
      const all = await entriesWithPrefix(storage, "");
      for (const [key] of all) await storage.delete(key);
      return { cleared: true };
    }
    default:
      throw new Error(`unknown op: ${op}`);
  }
}

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  async get(key) {
    return this.map.has(key) ? this.map.get(key) : undefined;
  }
  async put(key, value) {
    this.map.set(key, value);
  }
  async delete(key) {
    return this.map.delete(key);
  }
  async list({ prefix } = {}) {
    const out = new Map();
    for (const [key, value] of this.map) {
      if (!prefix || key.startsWith(prefix)) out.set(key, value);
    }
    return out;
  }
}

export class MemoryStore {
  constructor() {
    this.boards = new Map();
  }
  _bucket(boardId) {
    if (!this.boards.has(boardId)) this.boards.set(boardId, new MemoryStorage());
    return this.boards.get(boardId);
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/op") return new Response("Not found", { status: 404 });
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "invalid json" }, 400);
    }
    try {
      const args = { ...(body.args || {}) };
      if (!args.board_id) args.board_id = DEFAULT_BOARD_ID;
      assertBoardId(args.board_id);
      const result = await dispatch(this._bucket(args.board_id), body.op, args);
      return json({ ok: true, result });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }
  async op(op, args = {}) {
    const res = await this.fetch(
      new Request("https://board-state/op", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op, args }),
      }),
    );
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || `state op ${op} failed`);
    return data.result;
  }
}

/** Cloudflare Durable Object. Wrangler binds it as BOARD_STATE, one id per board_id. */
export class BoardState {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/op") return new Response("Not found", { status: 404 });
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "invalid json" }, 400);
    }
    try {
      const result = await dispatch(this.ctx.storage, body.op, body.args || {});
      return json({ ok: true, result });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }
}
