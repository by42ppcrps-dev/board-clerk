/** Simulated Alexa+ page. No CDN, no downloaded fonts. Speech recognition is input only; the page never speaks. */
import { SERVER_VERSION } from "../server.js";

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Board Clerk | simulated Alexa+</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html, body { margin: 0; }
  body {
    font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    background: #e6e0d6;
    color: #1b1916;
    line-height: 1.45;
  }
  a.skip {
    position: absolute;
    left: 8px;
    top: -48px;
    background: #083044;
    color: #f4f8f8;
    padding: 8px 12px;
    z-index: 6;
  }
  a.skip:focus { top: 8px; }
  .banner {
    position: sticky;
    top: 0;
    z-index: 5;
    margin: 0;
    padding: 8px 16px;
    background: #083044;
    color: #f4f8f8;
    text-align: center;
    font-size: 0.875rem;
    line-height: 1.4;
  }
  .app {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
    max-width: 1680px;
    margin: 0 auto;
    padding: 16px;
  }
  .device {
    background: radial-gradient(900px 280px at 0% 0%, #1a3c52 0%, #0e1c27 42%);
    color: #f7f4ef;
    border-radius: 28px;
    padding: 22px 22px 18px;
    box-shadow: 0 16px 40px rgba(14, 28, 39, 0.28);
  }
  .device-top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  h1 { font-size: 1.55rem; line-height: 1.2; margin: 0; }
  .board-line { margin: 4px 0 0; color: #d5dee8; }
  .state { display: flex; align-items: center; gap: 8px; margin: 0; color: #d5dee8; font-size: 0.95rem; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #9fb0c0; flex: 0 0 auto; }
  .state[data-state="ready"] .dot { background: #3ddc84; }
  .state[data-state="thinking"] .dot { background: #8ec8ff; animation: pulse 1.2s ease-in-out infinite; }
  .state[data-state="listening"] .dot { background: #ffb020; animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.35; } }
  @media (prefers-reduced-motion: reduce) {
    .state .dot { animation: none; }
  }
  .echo { margin: 18px 0 0; color: #d5dee8; font-size: 1rem; }
  #answer {
    margin: 8px 0 0;
    font-size: clamp(1.45rem, 2.5vw, 2.45rem);
    line-height: 1.3;
    font-weight: 600;
    color: #f7f4ef;
    min-height: 6.5rem;
    overflow-wrap: anywhere;
  }
  #answer[data-error="true"] { color: #ffd2cc; box-shadow: inset 4px 0 0 #ffb4ac; padding-left: 12px; }
  .sheet {
    background: #f7f4ef;
    color: #1b1916;
    border-radius: 16px;
    padding: 14px 16px;
    margin-top: 14px;
  }
  .decision + .decision { border-top: 1px solid #d9d1c4; margin-top: 12px; padding-top: 12px; }
  .motion-text { margin: 0; font-size: 1.05rem; overflow-wrap: anywhere; }
  .meta, .people, .roster-row, .controls, .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .meta { margin-top: 10px; align-items: center; }
  .people { margin-top: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .person { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .role { font-weight: 700; }
  .badge, .chip, .listen, .tally, .date {
    display: inline-block;
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 0.875rem;
    line-height: 1.3;
  }
  .tally, .date { background: #e7e1d6; color: #1b1916; }
  .listen { background: #102433; color: #f7f4ef; }
  .badge[data-outcome="passed"] { background: #c8efd8; color: #08331c; }
  .badge[data-outcome="failed"] { background: #ffd4ce; color: #5c1212; }
  .badge[data-outcome="tabled"] { background: #ffe6ad; color: #3d2800; }
  .badge[data-outcome="withdrawn"], .badge[data-outcome="unclear"] { background: #e6e1d8; color: #1b1916; }
  .chip[data-status="SPOKEN"] { background: #d5e6fb; color: #0b2744; }
  .chip[data-status="CONFIRMED BY CLERK"] { background: #c8efd8; color: #08331c; }
  .chip[data-status="NEEDS CONFIRMATION"] { background: #ffe0c2; color: #4a2208; }
  .also { margin: 12px 0 0; color: #3e3a34; }
  .partial { background: #ffe6ad; color: #3d2800; border-radius: 10px; padding: 8px 10px; font-weight: 700; margin: 0 0 10px; }
  .packet-total, .packet-note { margin: 0 0 8px; }
  .packet-total { font-weight: 700; }
  .pending-items { list-style: none; margin: 0; padding: 0; }
  .pending-item { margin: 0; padding: 12px 0; border-top: 1px solid #d9d1c4; }
  .pending-item:first-child { border-top: 0; padding-top: 0; }
  .pending-title { margin: 0 0 4px; font-weight: 700; }
  .sheet h2 { margin: 0 0 8px; font-size: 1.15rem; }
  #refusal {
    background: #fde8e6;
    color: #5c1212;
    border: 2px solid #5c1212;
    border-radius: 12px;
    padding: 12px;
    font-weight: 600;
  }
  #approved-banner {
    background: #e5f6ea;
    color: #08331c;
    border: 2px solid #08331c;
    border-radius: 12px;
    padding: 12px;
    font-weight: 700;
  }
  #minutes-body h2, #minutes-body h3, #minutes-body h4 { margin: 0.7em 0 0.3em; line-height: 1.25; color: #0e1c27; }
  #minutes-body p, #minutes-body li { margin: 0.35em 0; }
  #minutes-body ul { margin: 0.3em 0 0.6em; padding-left: 1.2em; }
  .quote { border-left: 3px solid #0e1c27; padding-left: 10px; }
  label { font-weight: 700; }
  .device > form label { display: block; margin: 16px 0 8px; }
  #pending-view label { display: block; margin: 8px 0 4px; }
  input[type="text"], select, button { font: inherit; }
  input[type="text"], select {
    color: #1b1916;
    background: #f7f4ef;
    border: 2px solid #1b1916;
    border-radius: 10px;
    padding: 10px 12px;
  }
  input[type="text"] { flex: 1 1 12rem; min-width: 0; border-radius: 999px; border-color: #f7f4ef; }
  button {
    background: #f3c15b;
    color: #1b1408;
    border: 2px solid #f3c15b;
    border-radius: 999px;
    padding: 10px 16px;
    cursor: pointer;
  }
  button.secondary { background: transparent; color: #f7f4ef; border-color: #d5dee8; }
  button.quiet { background: #fffdf8; color: #1b1916; border-color: #1b1916; }
  button[disabled] { opacity: 0.55; cursor: not-allowed; }
  .chips { margin-top: 12px; }
  #ingest-meeting { margin-top: 12px; }
  .hint { color: #d5dee8; font-size: 0.875rem; }
  .trace-pane {
    background: #fffdf8;
    color: #1b1916;
    border-radius: 20px;
    padding: 16px 16px 8px;
    border: 1px solid #d9d1c4;
  }
  .trace-pane h2 { margin: 0 0 12px; font-size: 1.25rem; }
  #trace { list-style: none; margin: 0; padding: 0; overflow: auto; max-height: 70vh; }
  .trace-item { margin: 0 0 12px; padding: 0 0 12px 14px; border-left: 3px solid #0e1c27; }
  .trace-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
  .method { font-size: 0.75rem; letter-spacing: 0.04em; text-transform: uppercase; color: #3e3a34; }
  .tool { font-weight: 700; }
  .latency { margin-left: auto; color: #3e3a34; }
  .trace-args, .trace-summary { margin: 4px 0; overflow-wrap: anywhere; }
  details { margin-top: 6px; }
  summary { cursor: pointer; font-weight: 700; }
  pre {
    white-space: pre-wrap;
    overflow: auto;
    max-height: 16rem;
    font-family: ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace;
    font-size: 0.78rem;
    background: #f3efe7;
    color: #1b1916;
    padding: 8px;
    border-radius: 8px;
  }
  footer { color: #3e3a34; font-size: 0.875rem; padding: 0 16px 24px; max-width: 1680px; margin: 0 auto; }
  :focus-visible { outline: 3px solid #ffbf00; outline-offset: 2px; }
  @media (min-width: 1200px) {
    .app {
      grid-template-columns: minmax(0, 1.2fr) minmax(340px, 0.8fr);
      gap: 20px;
      padding: 20px 24px 28px;
      min-height: calc(100vh - 40px);
    }
    .device { min-height: calc(100vh - 88px); }
  }
  @media (max-width: 899px) {
    .app { padding: 12px; grid-template-columns: 1fr; }
    .device { border-radius: 18px; padding: 14px; }
    .people { grid-template-columns: 1fr; }
    .controls, .chips, .roster-row { flex-direction: column; align-items: stretch; }
    .controls button, .controls input, .chips button, #ingest-meeting, select, .roster-row button { width: 100%; }
    .controls input[type="text"] { flex: 0 0 auto; }
    #answer { min-height: 0; }
    .latency { margin-left: 0; }
  }
</style>
</head>
<body>
<a class="skip" href="#utterance">Skip to the question</a>
<p class="banner" data-testid="sim-banner">Simulated Alexa+ experience · synthetic fictional board · not an Alexa device</p>
<main class="app">
  <section class="device" data-testid="device" aria-label="Simulated smart display">
    <div class="device-top">
      <div>
        <h1>Board Clerk</h1>
        <p class="board-line">Fictional Juniper Hollow · board <strong id="board-id" data-testid="board-id">preparing</strong></p>
      </div>
      <p class="state" id="state-indicator" data-testid="state-indicator" data-state="thinking">
        <span class="dot" aria-hidden="true"></span>
        <span id="state-label">Thinking</span>
      </p>
    </div>
    <p id="question-echo" class="echo" data-testid="question-echo">Your question will appear here.</p>
    <div id="answer" data-testid="answer" role="status" aria-live="polite" aria-atomic="true">Preparing an isolated copy of the fictional board.</div>
    <div id="decision-list" class="sheet" data-testid="decision-card" hidden></div>
    <section id="pending-view" class="sheet" data-testid="pending-list" hidden aria-label="Pending confirmations"></section>
    <section id="minutes-view" class="sheet" data-testid="minutes-view" hidden aria-label="Draft minutes">
      <h2>Draft minutes</h2>
      <p id="approved-banner" data-testid="approved-banner" hidden>Minutes approved. No email was sent.</p>
      <p id="refusal" data-testid="refusal" role="alert" hidden></p>
      <div id="minutes-body" data-testid="minutes-body"></div>
      <button type="button" id="approve-minutes" data-testid="approve-minutes">Approve minutes</button>
    </section>
    <form id="ask-form">
      <label for="utterance">Ask the board</label>
      <div class="controls">
        <input id="utterance" data-testid="utterance" name="utterance" type="text" autocomplete="off" required maxlength="500" placeholder="What did we decide about the roof?">
        <button type="submit" id="ask-btn" data-testid="ask-btn">Ask</button>
        <button type="button" id="mic" data-testid="mic" aria-label="Microphone, speech recognition input only">Microphone</button>
      </div>
    </form>
    <div class="chips" data-testid="prompt-chips" role="group" aria-label="Suggested prompts">
      <button type="button" class="secondary" data-ask="What did we decide about the roof?">What did we decide about the roof?</button>
      <button type="button" class="secondary" data-ask="Who seconded the pool resurfacing?">Who seconded the pool resurfacing?</button>
      <button type="button" class="secondary" data-ask="Board packet: roof">Board packet: roof</button>
      <button type="button" class="secondary" data-ask="What still needs confirming?">What still needs confirming?</button>
      <button type="button" class="secondary" data-ask="Draft last night's minutes">Draft last night's minutes</button>
      <button type="button" class="secondary" data-ask="Approve the minutes">Approve the minutes</button>
    </div>
    <button type="button" id="ingest-meeting" class="secondary" data-testid="ingest-meeting">Ingest last night's meeting</button>
    <p class="hint">Microphone fills the question. This page does not speak.</p>
  </section>
  <section class="trace-pane" data-testid="trace-pane" aria-labelledby="trace-title">
    <h2 id="trace-title">What Board Clerk did</h2>
    <ol id="trace" data-testid="mcp-trace">
      <li id="trace-empty">No calls yet.</li>
    </ol>
  </section>
</main>
<footer>Board Clerk @@VERSION@@. MCP 2025-11-25. Synthetic fictional data only.</footer>
<noscript><p>This simulated Alexa+ page needs JavaScript to call the MCP server. It still does not speak.</p></noscript>
<script>
(function () {
  var STORAGE = "boardClerkDemoBoardId";
  var DEFAULT_ROSTER = [
    { name: "Dana Okafor", role: "President" },
    { name: "Luis Trevino", role: "Vice President" },
    { name: "Priya Raman", role: "Treasurer" },
    { name: "Mark Ellison", role: "Secretary" },
    { name: "Grace Lindqvist", role: "Director" }
  ];
  var boardId = "";
  var pendingMeetingId = "";
  var roster = DEFAULT_ROSTER.slice();
  var ready = false;
  var busy = false;
  var micUnsupported = false;
  var micListening = false;
  var rpcId = 0;
  var answer = document.getElementById("answer");
  var form = document.getElementById("ask-form");
  var input = document.getElementById("utterance");
  var askBtn = document.getElementById("ask-btn");
  var micBtn = document.getElementById("mic");
  var ingestBtn = document.getElementById("ingest-meeting");
  var approveBtn = document.getElementById("approve-minutes");

  function showAnswer(text, isError) {
    answer.textContent = text || "";
    if (isError) answer.setAttribute("data-error", "true");
    else answer.removeAttribute("data-error");
  }

  function setState(name) {
    var el = document.getElementById("state-indicator");
    el.setAttribute("data-state", name);
    var label = name === "listening" ? "Listening" : name === "thinking" ? "Thinking" : "Ready";
    document.getElementById("state-label").textContent = label;
  }

  function syncControls() {
    var locked = busy || !ready;
    askBtn.disabled = locked;
    ingestBtn.disabled = locked;
    approveBtn.disabled = locked;
    micBtn.disabled = locked || micUnsupported;
    var chips = document.querySelectorAll("[data-ask]");
    for (var i = 0; i < chips.length; i++) chips[i].disabled = locked;
  }

  function showPanel(which) {
    var decision = document.getElementById("decision-list");
    var pending = document.getElementById("pending-view");
    var minutes = document.getElementById("minutes-view");
    decision.hidden = which !== "decision" && which !== "ingest";
    pending.hidden = which !== "pending" && which !== "ingest";
    minutes.hidden = which !== "minutes";
    if (!decision.hidden && !decision.childNodes.length) decision.hidden = true;
  }

  function hideApproved() {
    document.getElementById("approved-banner").hidden = true;
  }

  function showApproved() {
    document.getElementById("approved-banner").hidden = false;
    hideRefusal();
  }

  function hideRefusal() {
    var el = document.getElementById("refusal");
    el.hidden = true;
    el.textContent = "";
  }

  function showRefusal(message) {
    var el = document.getElementById("refusal");
    el.replaceChildren();
    var title = document.createElement("strong");
    title.textContent = "Not approved";
    var body = document.createElement("span");
    body.textContent = " " + message;
    el.appendChild(title);
    el.appendChild(body);
    el.hidden = false;
  }

  function clearMinutesStatus() {
    hideRefusal();
    hideApproved();
  }

  function elapsed(started) {
    var now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    return Math.max(0, Math.round(now - started));
  }

  function parseMcp(text) {
    var trimmed = String(text || "").trim();
    if (!trimmed) throw new Error("Empty MCP response");
    if (trimmed.charAt(0) === "{") return JSON.parse(trimmed);
    var last = null;
    var lines = trimmed.split("\\n");
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("data:") !== 0) continue;
      var payload = lines[i].slice(5).trim();
      if (!payload) continue;
      last = JSON.parse(payload);
    }
    if (!last) throw new Error("MCP response had no JSON");
    return last;
  }

  function parseTool(result) {
    var blocks = (result && result.content) || [];
    var text = blocks.map(function (block) { return block.text || ""; }).join("\\n");
    var line = text.split("\\n")[0] || text;
    var data = result && result.structuredContent ? result.structuredContent : null;
    if (!data) {
      var idx = text.indexOf("{");
      if (idx !== -1) {
        try { data = JSON.parse(text.slice(idx)); } catch (e) { data = null; }
      }
    }
    return { line: line, data: data, isError: !!(result && result.isError), raw: text };
  }

  function toolName(method, params) {
    if (method === "tools/call") return (params && params.name) || "";
    return "";
  }

  function argSource(method, params) {
    if (method === "tools/call") return (params && params.arguments) || {};
    return params || {};
  }

  function keyArgs(args) {
    if (!args || typeof args !== "object") return "(no key args)";
    var keys = ["protocolVersion", "uri", "board_id", "query", "topic", "meeting_id", "motion_id", "field", "value", "meeting_date", "approver_name", "approval_id", "confirmed_by", "title", "org"];
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (args[key] != null && String(args[key]) !== "") parts.push(key + ": " + args[key]);
    }
    if (typeof args.transcript === "string") parts.push("transcript: " + args.transcript.length + " characters");
    if (Array.isArray(args.roster)) parts.push("roster: " + args.roster.length + " people");
    return parts.join(" · ") || "(no key args)";
  }

  function scrub(body) {
    var copy;
    try { copy = JSON.parse(JSON.stringify(body)); } catch (e) { return body; }
    var args = copy && copy.params && copy.params.arguments;
    if (args && typeof args.transcript === "string" && args.transcript.length > 180) {
      args.transcript = "[transcript " + args.transcript.length + " characters]";
    }
    return copy;
  }

  function summarize(parsed, method) {
    if (!parsed) return "No JSON response";
    if (parsed.error) return parsed.error.message || "MCP error";
    var result = parsed.result || {};
    if (method === "initialize") return "Negotiated " + (result.protocolVersion || "protocol");
    if (method === "resources/read") {
      var uri = result.contents && result.contents[0] && result.contents[0].uri;
      return "Read " + (uri || "resource");
    }
    var blocks = result.content || [];
    var text = blocks.map(function (block) { return block.text || ""; }).join("\\n");
    var line = text.split("\\n")[0] || "OK";
    if (line.length > 240) line = line.slice(0, 237) + "...";
    return line;
  }

  function addTrace(entry) {
    var list = document.getElementById("trace");
    var empty = document.getElementById("trace-empty");
    if (empty) empty.remove();
    var li = document.createElement("li");
    li.className = "trace-item";
    li.setAttribute("data-testid", "trace-item");
    var head = document.createElement("div");
    head.className = "trace-head";
    var method = document.createElement("span");
    method.className = "method";
    method.setAttribute("data-testid", "trace-method");
    method.textContent = entry.method || "";
    var tool = document.createElement("span");
    tool.className = "tool";
    tool.setAttribute("data-testid", "trace-tool");
    tool.textContent = entry.tool || "";
    var latency = document.createElement("span");
    latency.className = "latency";
    latency.setAttribute("data-testid", "trace-latency");
    latency.textContent = String(entry.latency) + " ms";
    head.appendChild(method);
    head.appendChild(tool);
    head.appendChild(latency);
    li.appendChild(head);
    var args = document.createElement("p");
    args.className = "trace-args";
    args.setAttribute("data-testid", "trace-args");
    args.textContent = keyArgs(entry.args);
    li.appendChild(args);
    var summary = document.createElement("p");
    summary.className = "trace-summary";
    summary.setAttribute("data-testid", "trace-summary");
    summary.textContent = entry.summary || "";
    li.appendChild(summary);
    var details = document.createElement("details");
    var sum = document.createElement("summary");
    sum.textContent = "Raw JSON";
    var pre = document.createElement("pre");
    try { pre.textContent = JSON.stringify(entry.raw, null, 2); }
    catch (e) { pre.textContent = String(entry.raw); }
    details.appendChild(sum);
    details.appendChild(pre);
    li.appendChild(details);
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  }

  async function rpc(method, params) {
    var id = ++rpcId;
    var body = { jsonrpc: "2.0", id: id, method: method, params: params || {} };
    var started = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    var res;
    var text = "";
    var parsed = null;
    try {
      res = await fetch("/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream"
        },
        body: JSON.stringify(body)
      });
      text = await res.text();
      try { parsed = parseMcp(text); } catch (e) { parsed = null; }
    } catch (networkError) {
      addTrace({
        method: method,
        tool: toolName(method, params),
        args: argSource(method, params),
        latency: elapsed(started),
        summary: networkError && networkError.message ? networkError.message : "Network error",
        raw: { request: scrub(body), response: null }
      });
      throw networkError;
    }
    addTrace({
      method: method,
      tool: toolName(method, params),
      args: argSource(method, params),
      latency: elapsed(started),
      summary: summarize(parsed, method),
      raw: { request: scrub(body), response: parsed || text }
    });
    if (!res.ok) throw new Error("MCP request failed (" + res.status + ").");
    if (!parsed) throw new Error("MCP response was not JSON.");
    if (parsed.error) throw new Error(parsed.error.message || "MCP error");
    return parsed.result;
  }

  async function rpcTool(name, args) {
    var result = await rpc("tools/call", { name: name, arguments: args });
    return parseTool(result);
  }

  function makeId() {
    var bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    var hex = "";
    for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return "judge-" + hex;
  }

  function validId(id) {
    return /^[a-z0-9-]{3,40}$/.test(id || "");
  }

  function readStored() {
    try { return localStorage.getItem(STORAGE) || ""; } catch (e) { return ""; }
  }

  function writeStored(id) {
    try { localStorage.setItem(STORAGE, id); } catch (e) { /* private mode */ }
  }

  function formatDate(iso) {
    var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    var match = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(String(iso || ""));
    if (!match) return String(iso || "");
    var month = months[Number(match[2]) - 1];
    if (!month) return String(iso);
    return month + " " + Number(match[3]) + ", " + match[1];
  }

  function outcomeLabel(outcome) {
    if (outcome === "passed") return "Passed";
    if (outcome === "failed") return "Failed";
    if (outcome === "tabled") return "Tabled";
    if (!outcome) return "Unclear";
    return outcome.charAt(0).toUpperCase() + outcome.slice(1);
  }

  function statusLabel(status) {
    if (status === "SPOKEN") return "Spoken in recording";
    if (status === "CONFIRMED BY CLERK") return "Confirmed by clerk";
    if (status === "NEEDS CONFIRMATION") return "Needs confirmation";
    return "";
  }

  // The picker uses the roster of the pending item's own meeting (sent by the
  // server), then the active board's roster. It never falls back to the
  // Juniper Hollow default roster when the board has its own.
  function itemRoster(item) {
    if (item && Array.isArray(item.roster) && item.roster.length) return item.roster;
    return roster.length ? roster : DEFAULT_ROSTER;
  }

  function rosterMatch(suggestion, people) {
    var value = String(suggestion || "").trim().toLowerCase();
    if (!value || value === "unclear" || value === "unknown") return false;
    var hits = 0;
    for (var i = 0; i < people.length; i++) {
      var parts = String(people[i].name || "").toLowerCase().split(" ").filter(Boolean);
      if (!parts.length) continue;
      if (parts.join(" ") === value || parts[0] === value || parts[parts.length - 1] === value) hits++;
    }
    return hits === 1;
  }

  function personName(attr, fallback) {
    if (attr && attr.value) return attr.value;
    if (attr && attr.ai_suggestion) return attr.ai_suggestion;
    var text = String(fallback || "");
    if (!text || text.indexOf("needs confirm") !== -1) return "Unconfirmed";
    return text;
  }

  function cardFromMotion(motion, meetingDate) {
    var moverAttr = motion.attribution && motion.attribution.mover;
    var seconderAttr = motion.attribution && motion.attribution.seconder;
    return {
      motion_text: motion.motion_text || "",
      outcome: motion.outcome || "",
      tally: motion.tally || "",
      meeting_date: meetingDate || motion.meeting_date || "",
      motion_timestamp: motion.motion_timestamp || "",
      moverName: personName(moverAttr, motion.mover),
      moverStatus: (moverAttr && moverAttr.status) || "",
      seconderName: personName(seconderAttr, motion.seconder),
      seconderStatus: (seconderAttr && seconderAttr.status) || ""
    };
  }

  function cardFromHit(hit) {
    return {
      motion_text: hit.motion_text || "",
      outcome: hit.outcome || "",
      tally: hit.tally || "",
      meeting_date: hit.meeting_date || "",
      motion_timestamp: hit.motion_timestamp || "",
      moverName: personName(null, hit.mover),
      moverStatus: "",
      seconderName: personName(null, hit.seconder),
      seconderStatus: ""
    };
  }

  function personRow(role, name, status, key) {
    var wrap = document.createElement("div");
    wrap.className = "person";
    var roleEl = document.createElement("span");
    roleEl.className = "role";
    roleEl.textContent = role;
    var nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.setAttribute("data-testid", key + "-name");
    nameEl.textContent = name || "Unconfirmed";
    wrap.appendChild(roleEl);
    wrap.appendChild(nameEl);
    var label = statusLabel(status);
    if (label) {
      var chip = document.createElement("span");
      chip.className = "chip";
      chip.setAttribute("data-testid", key + "-status");
      chip.setAttribute("data-status", status);
      chip.textContent = label;
      wrap.appendChild(chip);
    }
    return wrap;
  }

  function decisionCard(card) {
    var article = document.createElement("article");
    article.className = "decision";
    article.setAttribute("data-testid", "motion-card");
    var text = document.createElement("p");
    text.className = "motion-text";
    text.setAttribute("data-testid", "motion-text");
    text.textContent = card.motion_text || "";
    article.appendChild(text);
    var meta = document.createElement("div");
    meta.className = "meta";
    var badge = document.createElement("span");
    badge.className = "badge";
    badge.setAttribute("data-testid", "outcome-badge");
    badge.setAttribute("data-outcome", card.outcome || "unclear");
    badge.textContent = outcomeLabel(card.outcome);
    meta.appendChild(badge);
    var tally = document.createElement("span");
    tally.className = "tally";
    tally.setAttribute("data-testid", "tally");
    tally.textContent = card.tally ? "Tally " + card.tally : "Tally unavailable";
    meta.appendChild(tally);
    var date = document.createElement("span");
    date.className = "date";
    date.setAttribute("data-testid", "meeting-date");
    date.textContent = formatDate(card.meeting_date);
    meta.appendChild(date);
    if (card.motion_timestamp) {
      var listen = document.createElement("span");
      listen.className = "listen";
      listen.setAttribute("data-testid", "listen-chip");
      listen.textContent = "Listen at " + card.motion_timestamp;
      meta.appendChild(listen);
    }
    article.appendChild(meta);
    var people = document.createElement("div");
    people.className = "people";
    people.appendChild(personRow("Mover", card.moverName, card.moverStatus, "mover"));
    people.appendChild(personRow("Seconder", card.seconderName, card.seconderStatus, "seconder"));
    article.appendChild(people);
    return article;
  }

  function renderDecisions(cards, extra, partialWords) {
    var host = document.getElementById("decision-list");
    host.replaceChildren();
    if (partialWords && partialWords.length) {
      var note = document.createElement("p");
      note.className = "partial";
      note.setAttribute("data-testid", "partial-match");
      note.textContent = "Partial match. No loaded motion mentions " + partialWords.join(", ") + ".";
      host.appendChild(note);
    }
    for (var i = 0; i < cards.length; i++) host.appendChild(decisionCard(cards[i]));
    if (extra > 0) {
      var more = document.createElement("p");
      more.className = "also";
      more.textContent = extra === 1 ? "Also matched 1 other motion." : "Also matched " + extra + " other motions.";
      host.appendChild(more);
    }
  }

  function pendingItem(item, index) {
    var li = document.createElement("li");
    li.className = "pending-item";
    var fieldLabel = item.field === "seconder" ? "Seconder" : "Mover";
    var title = document.createElement("p");
    title.className = "pending-title";
    title.textContent = item.motion_id + " " + fieldLabel + " · " + formatDate(item.meeting_date);
    li.appendChild(title);
    if (item.motion_text) {
      var motion = document.createElement("p");
      motion.textContent = item.motion_text;
      li.appendChild(motion);
    }
    var people = itemRoster(item);
    var suggestion = String(item.ai_suggestion || "").trim();
    if (suggestion && rosterMatch(suggestion, people)) {
      var one = document.createElement("button");
      one.type = "button";
      one.setAttribute("data-testid", "confirm-suggestion");
      one.textContent = "Confirm " + suggestion;
      one.addEventListener("click", function () { submitConfirm(item, suggestion); });
      li.appendChild(one);
    } else if (suggestion) {
      var guess = document.createElement("p");
      guess.textContent = "Suggested: " + suggestion + ". Choose a roster name.";
      li.appendChild(guess);
    }
    var selectId = "roster-" + index + "-" + item.motion_id + "-" + item.field;
    var label = document.createElement("label");
    label.setAttribute("for", selectId);
    label.textContent = "Roster for " + item.motion_id + " " + fieldLabel;
    var select = document.createElement("select");
    select.id = selectId;
    select.setAttribute("data-testid", "roster-select");
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a roster name";
    select.appendChild(placeholder);
    for (var p = 0; p < people.length; p++) {
      var opt = document.createElement("option");
      opt.value = people[p].name;
      opt.textContent = people[p].name + (people[p].role ? " (" + people[p].role + ")" : "");
      select.appendChild(opt);
    }
    var row = document.createElement("div");
    row.className = "roster-row";
    row.appendChild(label);
    row.appendChild(select);
    var go = document.createElement("button");
    go.type = "button";
    go.className = "quiet";
    go.setAttribute("data-testid", "confirm-roster");
    go.textContent = "Confirm roster name";
    go.addEventListener("click", function () {
      if (!select.value) {
        showAnswer("Choose a roster name first.", true);
        return;
      }
      submitConfirm(item, select.value);
    });
    row.appendChild(go);
    li.appendChild(row);
    return li;
  }

  function renderPending(items) {
    var host = document.getElementById("pending-view");
    host.replaceChildren();
    var heading = document.createElement("h2");
    heading.textContent = "Needs confirmation";
    host.appendChild(heading);
    if (!items.length) {
      var empty = document.createElement("p");
      empty.textContent = pendingMeetingId
        ? "Nothing in this meeting needs confirmation."
        : "Nothing on this board needs confirmation.";
      host.appendChild(empty);
      return;
    }
    var list = document.createElement("ul");
    list.className = "pending-items";
    for (var i = 0; i < items.length; i++) list.appendChild(pendingItem(items[i], i));
    host.appendChild(list);
  }

  function appendInline(parent, text) {
    var re = /\\*\\*([^*]+)\\*\\*/g;
    var last = 0;
    var match;
    var source = String(text || "");
    while ((match = re.exec(source))) {
      if (match.index > last) parent.appendChild(document.createTextNode(source.slice(last, match.index)));
      var strong = document.createElement("strong");
      strong.textContent = match[1];
      parent.appendChild(strong);
      last = match.index + match[0].length;
    }
    if (last < source.length) parent.appendChild(document.createTextNode(source.slice(last)));
  }

  function renderMarkdown(markdown) {
    var host = document.getElementById("minutes-body");
    host.replaceChildren();
    var lines = String(markdown || "").split("\\n");
    var list = null;
    function closeList() {
      if (list) {
        host.appendChild(list);
        list = null;
      }
    }
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (!trimmed) { closeList(); continue; }
      if (trimmed.charAt(0) === ">") {
        closeList();
        var quote = document.createElement("p");
        quote.className = "quote";
        appendInline(quote, trimmed.replace(/^>\\s?/, ""));
        host.appendChild(quote);
        continue;
      }
      var heading = /^(#{1,3})\\s+(.*)$/.exec(trimmed);
      if (heading) {
        closeList();
        var level = heading[1].length;
        var tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
        var h = document.createElement(tag);
        appendInline(h, heading[2]);
        host.appendChild(h);
        continue;
      }
      var bullet = /^[-*]\\s+(.*)$/.exec(trimmed);
      if (bullet) {
        if (!list) list = document.createElement("ul");
        var li = document.createElement("li");
        appendInline(li, bullet[1]);
        list.appendChild(li);
        continue;
      }
      closeList();
      var p = document.createElement("p");
      appendInline(p, trimmed.replace(/^\\*([^*]+)\\*/, "$1"));
      host.appendChild(p);
    }
    closeList();
  }

  async function loadRoster() {
    try {
      var result = await rpc("resources/read", { uri: "board://" + boardId + "/roster" });
      var contents = (result && result.contents) || [];
      var text = contents[0] && contents[0].text ? contents[0].text : "";
      var data = text ? JSON.parse(text) : {};
      roster = data.roster && data.roster.length ? data.roster : DEFAULT_ROSTER.slice();
    } catch (e) {
      if (!roster.length) roster = DEFAULT_ROSTER.slice();
    }
  }

  async function ensureSeeded(id) {
    if (id === "juniper-hollow-demo") return;
    var existing = await rpcTool("list_meetings", { board_id: id });
    var count = existing.data && existing.data.meetings ? existing.data.meetings.length : 0;
    if (existing.isError || count < 2) {
      var started = await rpcTool("start_demo_board", { board_id: id });
      if (started.isError) throw new Error(started.line);
    }
  }

  async function meetingFor(motionId, field) {
    var listed = await rpcTool("list_meetings", { board_id: boardId });
    if (listed.isError) throw new Error(listed.line);
    var meetings = ((listed.data && listed.data.meetings) || []).slice().reverse();
    var fallback = "";
    for (var i = 0; i < meetings.length; i++) {
      var motions = await rpcTool("list_motions", { board_id: boardId, meeting_id: meetings[i].meeting_id });
      if (motions.isError) continue;
      var found = null;
      var rows = (motions.data && motions.data.motions) || [];
      for (var j = 0; j < rows.length; j++) {
        if (String(rows[j].motion_id).toLowerCase() === motionId.toLowerCase()) found = rows[j];
      }
      if (!found) continue;
      fallback = meetings[i].meeting_id;
      var status = found.attribution && found.attribution[field] && found.attribution[field].status;
      if (status === "NEEDS CONFIRMATION") return meetings[i].meeting_id;
    }
    return fallback;
  }

  function route(text) {
    var t = text.trim();
    if (/what (still )?needs confirm/i.test(t) || /needs confirming/i.test(t)) return { kind: "pending" };
    var confirm = t.match(/^confirm\\s+(.+?)\\s+(moved|seconded)\\s+(m\\d+)\\b/i);
    if (confirm) {
      return {
        kind: "confirm",
        name: confirm[1].trim(),
        field: /moved/i.test(confirm[2]) ? "mover" : "seconder",
        motionId: confirm[3].toUpperCase()
      };
    }
    if (/draft( last night's)? minutes/i.test(t)) return { kind: "draft" };
    if (/\\b(do\\s*n[o']?t|don't|dont|never|not|no|stop|cancel|hold off on|refuse to)\\b[^.?!]*\\bapprov/i.test(t) && /minutes/i.test(t)) return { kind: "noapprove" };
    if (/^(please\\s+)?approve( the| last night's)? minutes[.!]?$/i.test(t)) return { kind: "approve" };
    var packet = t.match(/^board packet:?\\s*(.*)$/i);
    if (packet) return { kind: "packet", topic: (packet[1] || "").trim() || "roof" };
    return { kind: "decide", query: t };
  }

  function renderPacket(packet) {
    var host = document.getElementById("decision-list");
    host.replaceChildren();
    var wrap = document.createElement("section");
    wrap.setAttribute("data-testid", "board-packet");
    var heading = document.createElement("h2");
    heading.textContent = "Board packet: " + (packet.topic || "");
    wrap.appendChild(heading);
    if (packet.partial) {
      var partial = document.createElement("p");
      partial.className = "partial";
      partial.setAttribute("data-testid", "partial-match");
      var missed = packet.missed_terms || [];
      partial.textContent = missed.length
        ? "Partial match. No loaded motion mentions " + missed.join(", ") + "."
        : "Partial match.";
      wrap.appendChild(partial);
    }
    var total = document.createElement("p");
    total.className = "packet-total";
    total.setAttribute("data-testid", "packet-total");
    total.textContent = packet.approved_total_display
      ? "Approved total " + packet.approved_total_display
      : "No approved dollar amount parsed from the motion text.";
    wrap.appendChild(total);
    var open = document.createElement("p");
    open.className = "packet-note";
    open.setAttribute("data-testid", "packet-open");
    var openCount = (packet.open_confirmations || []).length;
    open.textContent = openCount
      ? openCount + " name(s) on this topic still need confirmation."
      : "No mover or seconder on this topic still needs confirmation.";
    wrap.appendChild(open);
    var held = document.createElement("p");
    held.className = "packet-note";
    held.setAttribute("data-testid", "packet-tabled");
    var tabled = packet.tabled || [];
    if (!tabled.length) held.textContent = "No tabled item on this topic to revisit.";
    else {
      held.textContent = tabled.map(function (item) {
        return (item.meeting_date || "") + " " + (item.motion_id || "") + ": " + (item.motion_text || "tabled");
      }).join(" ");
    }
    wrap.appendChild(held);
    host.appendChild(wrap);
    var motions = packet.motions || [];
    for (var i = 0; i < motions.length; i++) host.appendChild(decisionCard(cardFromMotion(motions[i], motions[i].meeting_date)));
  }

  async function showPacket(topic) {
    var result = await rpcTool("prepare_board_packet", { board_id: boardId, topic: topic });
    var line = result.line;
    if (!result.isError && result.data && result.data.partial) line = "Partial match. " + line;
    showAnswer(line, result.isError);
    if (result.isError || !result.data) {
      showPanel("none");
      return;
    }
    renderPacket(result.data);
    showPanel("decision");
  }

  async function showDecision(query) {
    var result = await rpcTool("what_did_we_decide", { board_id: boardId, query: query });
    showAnswer(result.line, result.isError);
    var hits = result.data && result.data.hits ? result.data.hits : [];
    if (result.isError || !hits.length) {
      showPanel("none");
      return;
    }
    var hit = hits[0];
    var missed = hit.missed || [];
    var motion = await rpcTool("get_motion", {
      board_id: boardId,
      meeting_id: hit.meeting_id,
      motion_id: hit.motion_id
    });
    var card = motion.isError ? cardFromHit(hit) : cardFromMotion(motion.data, hit.meeting_date);
    renderDecisions([card], hits.length - 1, missed);
    showPanel("decision");
  }

  async function refreshPending(panel) {
    var args = { board_id: boardId };
    if (pendingMeetingId) args.meeting_id = pendingMeetingId;
    var result = await rpcTool("list_pending_confirmations", args);
    if (!result.isError) renderPending((result.data && result.data.pending) || []);
    if (panel) showPanel(panel);
    return result;
  }

  async function showPending() {
    pendingMeetingId = "";
    var result = await refreshPending("pending");
    showAnswer(result.line, result.isError);
    if (result.isError) showPanel("none");
  }

  async function showDraft(utterance) {
    var result = await rpcTool("draft_minutes", { board_id: boardId });
    var line = result.line;
    var date = result.data && result.data.meeting_date;
    if (!date && result.data && result.data.markdown) {
      var dated = /\\*\\*Date:\\*\\*\\s*(\\d{4}-\\d{2}-\\d{2})/.exec(result.data.markdown);
      if (dated) date = dated[1];
    }
    if (!result.isError && /last night/i.test(utterance || "") && date && date !== "2026-10-15") {
      line = line + " That is the latest meeting already on this board (" + formatDate(date) + "), not the October 15 transcript. Ingest last night's meeting first if that is the one you meant.";
    }
    showAnswer(line, result.isError);
    if (result.isError) {
      showPanel("none");
      return;
    }
    clearMinutesStatus();
    renderMarkdown((result.data && result.data.markdown) || "");
    showPanel("minutes");
  }

  async function latestMeeting() {
    var listed = await rpcTool("list_meetings", { board_id: boardId });
    if (listed.isError) return { error: listed.line };
    var meetings = (listed.data && listed.data.meetings) || [];
    if (!meetings.length) return { error: "This board has no meetings to approve." };
    return { meeting: meetings[meetings.length - 1] };
  }

  async function runApprove() {
    var found = await latestMeeting();
    if (found.error) {
      showAnswer(found.error, true);
      showPanel("none");
      return;
    }
    var meetingId = found.meeting.meeting_id;
    var requested = await rpcTool("request_minutes_approval", {
      board_id: boardId,
      meeting_id: meetingId,
      approver_name: "Demo Judge"
    });
    if (requested.isError) {
      showAnswer(requested.line, true);
      showRefusal(requested.line);
      hideApproved();
      showPanel("minutes");
      return;
    }
    var approved = await rpcTool("approve_minutes", {
      board_id: boardId,
      meeting_id: meetingId,
      approval_id: requested.data && requested.data.id,
      approver_name: "Demo Judge"
    });
    if (approved.isError) {
      var drafted = await rpcTool("draft_minutes", { board_id: boardId, meeting_id: meetingId });
      if (!drafted.isError && drafted.data) renderMarkdown(drafted.data.markdown || "");
      showAnswer(approved.line, true);
      showRefusal(approved.line);
      hideApproved();
      showPanel("minutes");
      return;
    }
    if (approved.data && approved.data.markdown) renderMarkdown(approved.data.markdown);
    showAnswer(approved.line, false);
    showApproved();
    showPanel("minutes");
  }

  async function runTypedConfirm(plan) {
    var meetingId = await meetingFor(plan.motionId, plan.field);
    if (!meetingId) {
      showAnswer("I could not find motion " + plan.motionId + " on this board. Use a motion id such as M2.", true);
      showPanel("none");
      return;
    }
    var confirmed = await rpcTool("confirm_mover_seconder", {
      board_id: boardId,
      meeting_id: meetingId,
      motion_id: plan.motionId,
      field: plan.field,
      value: plan.name,
      confirmed_by: "Demo Judge"
    });
    showAnswer(confirmed.line, confirmed.isError);
    if (!confirmed.isError) {
      pendingMeetingId = "";
      var result = await refreshPending("pending");
      if (!result.isError) showAnswer(confirmed.line + " " + result.line, false);
    }
  }

  async function submitConfirm(item, value) {
    if (!ready || busy) return;
    busy = true;
    syncControls();
    setState("thinking");
    document.getElementById("question-echo").textContent = "Confirm " + value + " as " + item.field + " on " + item.motion_id;
    try {
      var confirmed = await rpcTool("confirm_mover_seconder", {
        board_id: boardId,
        meeting_id: item.meeting_id,
        motion_id: item.motion_id,
        field: item.field,
        value: value,
        confirmed_by: "Demo Judge"
      });
      if (confirmed.isError) {
        showAnswer(confirmed.line, true);
        return;
      }
      var panel = pendingMeetingId ? "ingest" : "pending";
      var result = await refreshPending(panel);
      if (result.isError) {
        showAnswer(confirmed.line, false);
        return;
      }
      showAnswer(confirmed.line + " " + result.line, false);
    } catch (error) {
      showAnswer(error && error.message ? error.message : "Confirm failed.", true);
    } finally {
      busy = false;
      syncControls();
      setState("ready");
    }
  }

  async function ask(text) {
    if (!ready || busy) return;
    var trimmed = String(text || "").trim();
    if (!trimmed) return;
    document.getElementById("question-echo").textContent = trimmed;
    busy = true;
    syncControls();
    setState("thinking");
    try {
      var plan = route(trimmed);
      if (plan.kind === "confirm") await runTypedConfirm(plan);
      else if (plan.kind === "pending") await showPending();
      else if (plan.kind === "draft") await showDraft(trimmed);
      else if (plan.kind === "approve") await runApprove();
      else if (plan.kind === "noapprove") showAnswer("Okay. I did not approve the minutes. Nothing was changed.", false);
      else if (plan.kind === "packet") await showPacket(plan.topic);
      else await showDecision(plan.query);
    } catch (error) {
      showAnswer(error && error.message ? error.message : "The request failed.", true);
    } finally {
      busy = false;
      syncControls();
      if (!micListening) setState("ready");
      input.focus();
    }
  }

  async function ingestLastNight() {
    if (!ready || busy) return;
    document.getElementById("question-echo").textContent = "Ingest last night's meeting";
    busy = true;
    syncControls();
    setState("thinking");
    try {
      var res = await fetch("/demo/transcript.txt");
      if (!res.ok) throw new Error("Could not load the fictional transcript.");
      var transcript = await res.text();
      var result = await rpcTool("ingest_meeting", {
        board_id: boardId,
        transcript: transcript,
        meeting_date: "2026-10-15",
        title: "Juniper Hollow regular board meeting",
        org: "Juniper Hollow Owners Association",
        roster: DEFAULT_ROSTER
      });
      showAnswer(result.line, result.isError);
      if (result.isError) {
        showPanel("none");
        return;
      }
      var motions = (result.data && result.data.motions) || [];
      var cards = motions.map(function (motion) {
        return cardFromMotion(motion, result.data.meeting_date);
      });
      renderDecisions(cards, 0);
      pendingMeetingId = (result.data && result.data.meeting_id) || "";
      renderPending((result.data && result.data.pending) || []);
      showPanel("ingest");
      await loadRoster();
    } catch (error) {
      showAnswer(error && error.message ? error.message : "Ingest failed.", true);
    } finally {
      busy = false;
      syncControls();
      setState("ready");
      input.focus();
    }
  }

  function wireMic() {
    var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      micUnsupported = true;
      micBtn.textContent = "Microphone unavailable";
      micBtn.disabled = true;
      return;
    }
    var rec = new Rec();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = function (event) {
      var said = event.results && event.results[0] && event.results[0][0] ? event.results[0][0].transcript : "";
      if (said) input.value = said;
      input.focus();
      showAnswer("Heard you. Press Ask to send it. Speech is input only and is not spoken back.", false);
    };
    rec.onerror = function () {
      micListening = false;
      showAnswer("Microphone did not catch that. Type the question instead.", true);
    };
    rec.onend = function () {
      micListening = false;
      if (!busy) setState(ready ? "ready" : "thinking");
      syncControls();
    };
    micBtn.addEventListener("click", function () {
      if (!ready || busy) return;
      try {
        micListening = true;
        setState("listening");
        rec.start();
        showAnswer("Listening. Speech is used for input only and will not be spoken back.", false);
      } catch (e) {
        micListening = false;
        setState("ready");
        showAnswer("Microphone is busy. Type the question instead.", true);
      }
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    ask(input.value);
  });
  var examples = document.querySelectorAll("[data-ask]");
  for (var n = 0; n < examples.length; n++) {
    examples[n].addEventListener("click", function (event) {
      var text = event.currentTarget.getAttribute("data-ask");
      input.value = text;
      ask(text);
    });
  }
  ingestBtn.addEventListener("click", function () { ingestLastNight(); });
  approveBtn.addEventListener("click", function () {
    document.getElementById("question-echo").textContent = "Approve the minutes";
    ask("Approve the minutes");
  });
  wireMic();
  syncControls();

  async function boot() {
    setState("thinking");
    await rpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "board-clerk-demo", version: "@@VERSION@@" }
    });
    var params = new URLSearchParams(window.location.search);
    var reset = params.get("reset") === "1";
    var fromUrl = (params.get("board") || "").trim();
    var stored = "";
    if (reset) {
      stored = makeId();
      writeStored(stored);
      var started = await rpcTool("start_demo_board", { board_id: stored });
      if (started.isError) throw new Error(started.line);
      try {
        params.delete("reset");
        var rest = params.toString();
        window.history.replaceState(null, "", window.location.pathname + (rest ? "?" + rest : "") + window.location.hash);
      } catch (e) {}
    } else if (validId(fromUrl)) {
      stored = fromUrl;
      writeStored(stored);
      await ensureSeeded(stored);
    } else {
      stored = readStored();
      if (!validId(stored)) {
        stored = makeId();
        writeStored(stored);
        var created = await rpcTool("start_demo_board", { board_id: stored });
        if (created.isError) throw new Error(created.line);
      } else {
        await ensureSeeded(stored);
      }
    }
    boardId = stored;
    document.getElementById("board-id").textContent = boardId;
    await loadRoster();
    ready = true;
    syncControls();
    setState("ready");
    if (boardId === "juniper-hollow-demo") {
      showAnswer("Ready. juniper-hollow-demo is read-only. Open ?reset=1 so start_demo_board can make a private board before any confirm, ingest, or approval. This page does not speak.", false);
    } else {
      showAnswer("Ready. Two fictional Juniper Hollow meetings are on this isolated board. Ask a question. This page does not speak.", false);
    }
    input.focus();
  }

  boot().catch(function (error) {
    ready = false;
    busy = false;
    syncControls();
    setState("ready");
    showAnswer(error && error.message ? error.message : "Could not start the demo board.", true);
  });
})();
</script>
</body>
</html>
`;

export const DEMO_HTML = PAGE.replaceAll("@@VERSION@@", SERVER_VERSION);

export default DEMO_HTML;
