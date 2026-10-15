#!/usr/bin/env node
/**
 * Same ingest → pending → approve refused → confirm → approve → reset flow
 * against a deployed base URL. Usage: node scripts/smoke-remote.mjs <baseUrl>
 * Does not log in or deploy.
 */
import { readFileSync } from "node:fs";
import { SERVER_VERSION } from "../src/server.js";

const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) {
  console.error("usage: node scripts/smoke-remote.mjs <baseUrl>");
  process.exit(1);
}

const healthRes = await fetch(`${base}/health`);
const healthText = await healthRes.text();
if (!healthRes.ok) throw new Error(`health HTTP ${healthRes.status}: ${healthText.slice(0, 200)}`);
const health = JSON.parse(healthText);
if (health.version !== SERVER_VERSION) {
  throw new Error(`health version ${health.version} !== server ${SERVER_VERSION}`);
}
console.log("ok: health", health.version, "tools", (health.tools || []).length);

const transcript = readFileSync(new URL("../demo/juniper-2026-10-15-transcript.txt", import.meta.url), "utf8");
const roster = [
  { name: "Dana Okafor", role: "President" },
  { name: "Luis Trevino", role: "Vice President" },
  { name: "Priya Raman", role: "Treasurer" },
  { name: "Mark Ellison", role: "Secretary" },
  { name: "Grace Lindqvist", role: "Director" },
];
const names = roster.map((person) => person.name);
const board_id = `remote-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

function parseRpc(text) {
  const trimmed = String(text || "").trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const messages = [];
  for (const line of trimmed.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload) messages.push(JSON.parse(payload));
  }
  if (!messages.length) throw new Error(trimmed.slice(0, 300));
  return messages[messages.length - 1];
}

let rpcId = 0;
async function rpc(method, params) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${method}: ${text.slice(0, 300)}`);
  const body = parseRpc(text);
  if (body.error) throw new Error(`${method}: ${body.error.message || JSON.stringify(body.error)}`);
  return body.result;
}

function dataOf(result) {
  if (result?.structuredContent) return result.structuredContent;
  const text = (result.content || []).map((block) => block.text || "").join("\n");
  const idx = text.indexOf("{");
  return JSON.parse(text.slice(idx));
}

async function tool(name, args) {
  const result = await rpc("tools/call", { name, arguments: args });
  return { result, data: dataOf(result), isError: result.isError === true };
}

const init = await rpc("initialize", {
  protocolVersion: "2025-11-25",
  capabilities: {},
  clientInfo: { name: "smoke-remote", version: SERVER_VERSION },
});
if (init.protocolVersion !== "2025-11-25") throw new Error(`protocol ${init.protocolVersion}`);
if (init.serverInfo?.name !== "board-clerk" || init.serverInfo?.version !== SERVER_VERSION) {
  throw new Error(`serverInfo ${JSON.stringify(init.serverInfo)} !== ${SERVER_VERSION}`);
}
console.log("ok: initialize", init.protocolVersion, init.serverInfo.version, "board", board_id);

const ingested = await tool("ingest_meeting", {
  board_id,
  transcript,
  meeting_date: "2026-10-15",
  roster,
});
if (ingested.isError) throw new Error(ingested.data.error || "ingest failed");
const meeting_id = ingested.data.meeting_id;
console.log("ok: ingest", meeting_id);

const pending = await tool("list_pending_confirmations", { board_id, meeting_id });
if (pending.data.count < 1) throw new Error("expected pending confirmations");
console.log("ok: pending", pending.data.count);

const requested = await tool("request_minutes_approval", {
  board_id,
  meeting_id,
  approver_name: "Remote Smoke",
});
if (requested.isError) throw new Error(requested.data.error || "request failed");

const refused = await tool("approve_minutes", {
  board_id,
  meeting_id,
  approval_id: requested.data.id,
  approver_name: "Remote Smoke",
});
if (!refused.isError) throw new Error("approve should refuse while names are unconfirmed");
console.log("ok: approve refused");

let n = 0;
for (const item of pending.data.pending) {
  const confirmed = await tool("confirm_mover_seconder", {
    board_id,
    meeting_id,
    motion_id: item.motion_id,
    field: item.field,
    value: names[n % names.length],
    confirmed_by: "Remote Smoke",
  });
  n += 1;
  if (confirmed.isError) throw new Error(confirmed.data.error || "confirm failed");
}
console.log("ok: confirmed", n);

const approved = await tool("approve_minutes", {
  board_id,
  meeting_id,
  approval_id: requested.data.id,
  approver_name: "Remote Smoke",
});
if (approved.isError) throw new Error(approved.data.error || "approve failed");
if (!approved.data.markdown) throw new Error("approved minutes missing markdown");
console.log("ok: approve");

const reset = await tool("reset_board", { board_id });
if (reset.isError) throw new Error(reset.data.error || "reset failed");
const left = await tool("list_meetings", { board_id });
if (left.data.meetings?.length) throw new Error("board not empty after reset");
console.log("ok: reset_board");
console.log("\nRemote smoke passed.");
