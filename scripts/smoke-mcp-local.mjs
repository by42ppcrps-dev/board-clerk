#!/usr/bin/env node
/** In-process smoke of the real board-clerk handler. No Cloudflare deploy. */
import { createHandler, SERVER_VERSION, TOOL_NAMES } from "../src/server.js";
import { MemoryStore } from "../src/state.js";

const handler = createHandler({ store: new MemoryStore() });
let rpcId = 0;

function parseRpc(text) {
  const trimmed = String(text || "").trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  let last = null;
  for (const line of trimmed.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    last = JSON.parse(payload);
  }
  if (!last) throw new Error(trimmed.slice(0, 240));
  return last;
}

async function rpc(method, params) {
  const res = await handler.fetch(
    new Request("http://127.0.0.1:8787/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    }),
  );
  const parsed = parseRpc(await res.text());
  if (parsed.error) throw new Error(JSON.stringify(parsed.error));
  return parsed.result;
}

const init = await rpc("initialize", {
  protocolVersion: "2025-11-25",
  capabilities: {},
  clientInfo: { name: "smoke-mcp-local", version: SERVER_VERSION },
});
if (init.protocolVersion !== "2025-11-25") throw new Error("protocol " + init.protocolVersion);
if (init.serverInfo?.name !== "board-clerk" || init.serverInfo?.version !== SERVER_VERSION) {
  throw new Error("serverInfo " + JSON.stringify(init.serverInfo));
}
console.log("ok: initialize", init.serverInfo);

const tools = await rpc("tools/list", {});
const names = tools.tools.map((tool) => tool.name).sort();
console.log("ok: tools/list", names.join(", "));
for (const name of TOOL_NAMES) {
  if (!names.includes(name)) throw new Error("missing tool " + name);
}
for (const tool of tools.tools) {
  if (!tool.title) throw new Error("missing title " + tool.name);
}

const board = "smoke-local-board";
const started = await rpc("tools/call", { name: "start_demo_board", arguments: { board_id: board } });
if (started.isError) throw new Error(started.content?.[0]?.text || "start_demo_board failed");
console.log("ok: start_demo_board", board);

const roof = await rpc("tools/call", {
  name: "what_did_we_decide",
  arguments: { board_id: board, query: "what did we decide about the roof?" },
});
const roofText = roof.content.map((block) => block.text).join("\n");
if (!/Summit Ridge|roof/i.test(roofText)) throw new Error("roof tool miss: " + roofText.slice(0, 200));
if (!/August 20th/.test(roofText)) throw new Error("roof answer missing natural date");
console.log("ok: what_did_we_decide roof");

const study = await rpc("tools/call", {
  name: "what_did_we_decide",
  arguments: { board_id: board, query: "Who seconded the reserve study?" },
});
const studyText = study.content.map((block) => block.text).join("\n");
if (!/No loaded motion mentions "study"/.test(studyText)) {
  throw new Error("reserve-study answer overclaims: " + studyText.slice(0, 240));
}
console.log("ok: reserve-study answer names the gap");

const pending = await rpc("tools/call", {
  name: "list_pending_confirmations",
  arguments: { board_id: board, meeting_id: "juniper-2026-09-17" },
});
if ((pending.structuredContent?.count ?? 0) < 1) throw new Error("expected pending");
console.log("ok: list_pending_confirmations", pending.structuredContent.count);

console.log("\nMCP local smoke passed. Gemini $ spent: 0");
