/**
 * MCP Apps view for one decision.
 * Field names follow the ext-apps spec dated 2026-01-26:
 * ui:// resource, mimeType text/html;profile=mcp-app, tool _meta.ui.resourceUri,
 * View handshake ui/initialize + appInfo + appCapabilities, then ui/notifications/initialized,
 * and ui/notifications/tool-result carrying structuredContent.
 * @modelcontextprotocol/server 2.3.1 has registerResource and tool _meta. It does not ship
 * registerAppTool, and this server does not advertise io.modelcontextprotocol/ui.
 */
export const DECISION_CARD_URI = "ui://board-clerk/decision-card";
export const DECISION_CARD_MIME = "text/html;profile=mcp-app";

export const DECISION_CARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Board Clerk decision card</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", system-ui, sans-serif;
    background: var(--color-background-primary, #f7f4ef);
    color: var(--color-text-primary, #1b1916);
    line-height: 1.4;
  }
  main { padding: 14px 16px 16px; }
  h1 { font-size: 1rem; margin: 0 0 8px; }
  .spoken { font-size: 1.05rem; font-weight: 650; margin: 0 0 10px; }
  .partial { background: #ffe6ad; color: #3d2800; border-radius: 10px; padding: 8px 10px; font-weight: 700; margin: 0 0 10px; }
  .motion { margin: 0 0 8px; }
  .meta, .people { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 8px; }
  .pill { border-radius: 999px; padding: 3px 10px; background: #e7e1d6; font-size: 0.875rem; }
  .pill.passed { background: #c8efd8; }
  .pill.failed { background: #ffd4ce; }
  .pill.needs { background: #ffe0c2; }
  button { font: inherit; border-radius: 999px; border: 2px solid #1b1916; background: #fffdf8; padding: 6px 12px; cursor: pointer; }
  #evidence { margin: 8px 0 0; }
  #status { margin: 8px 0 0; }
  .wait { color: #3e3a34; }
</style>
</head>
<body>
<main id="card">
  <h1>Board Clerk decision</h1>
  <p id="wait" class="wait">Waiting for the tool result.</p>
</main>
<script>
(function () {
  var nextId = 1;
  var waiters = {};
  var ready = false;
  var queued = null;
  var model = null;

  function sendRequest(method, params) {
    var id = nextId++;
    window.parent.postMessage({ jsonrpc: "2.0", id: id, method: method, params: params || {} }, "*");
    return new Promise(function (resolve, reject) {
      waiters[id] = { resolve: resolve, reject: reject };
    });
  }

  function sendNotification(method, params) {
    window.parent.postMessage({ jsonrpc: "2.0", method: method, params: params || {} }, "*");
  }

  function textOf(result) {
    var blocks = (result && result.content) || [];
    return blocks.map(function (block) { return block.text || ""; }).join("\\n");
  }

  function dataOf(result) {
    if (result && result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
    var text = textOf(result);
    var idx = text.indexOf("{");
    if (idx === -1) return null;
    try { return JSON.parse(text.slice(idx)); } catch (e) { return null; }
  }

  function person(attr, fallback) {
    if (attr && (attr.value || attr.ai_suggestion)) return attr.value || attr.ai_suggestion;
    return fallback || "";
  }

  function pick(data) {
    if (!data || typeof data !== "object") return null;
    if (Array.isArray(data.hits) && data.hits.length) {
      var hit = data.hits[0];
      return {
        headline: data.top_answer || hit.spoken_answer || "",
        partial: hit.missed || [],
        motion: hit.motion_text || "",
        outcome: hit.outcome || "",
        tally: hit.tally || "",
        date: hit.meeting_date || "",
        timestamp: hit.motion_timestamp || "",
        mover: hit.mover || "",
        seconder: hit.seconder || "",
        evidence: hit.evidence_quote || "",
        meetingId: hit.meeting_id || "",
        motionId: hit.motion_id || "",
        boardId: data.board_id || ""
      };
    }
    if (data.motion_text || data.decision) {
      var mover = data.attribution && data.attribution.mover;
      var seconder = data.attribution && data.attribution.seconder;
      return {
        headline: data.decision || "",
        partial: [],
        motion: data.motion_text || data.decision || "",
        outcome: data.outcome || "",
        tally: data.tally || "",
        date: data.meeting_date || "",
        timestamp: data.motion_timestamp || "",
        mover: person(mover, data.mover),
        seconder: person(seconder, data.seconder),
        moverStatus: mover && mover.status,
        seconderStatus: seconder && seconder.status,
        evidence: data.evidence_quote || "",
        meetingId: data.meeting_id || "",
        motionId: data.motion_id || "",
        boardId: data.board_id || ""
      };
    }
    return null;
  }

  function pill(text, kind) {
    var span = document.createElement("span");
    span.className = "pill" + (kind ? " " + kind : "");
    span.textContent = text;
    return span;
  }

  function render(result) {
    var data = dataOf(result);
    model = pick(data);
    var host = document.getElementById("card");
    host.replaceChildren();
    var title = document.createElement("h1");
    title.textContent = "Board Clerk decision";
    host.appendChild(title);
    if (!model) {
      var empty = document.createElement("p");
      empty.textContent = textOf(result) || "This tool result had no decision to draw.";
      host.appendChild(empty);
      return;
    }
    if (model.partial && model.partial.length) {
      var partial = document.createElement("p");
      partial.className = "partial";
      partial.textContent = "Partial match. No loaded motion mentions " + model.partial.join(", ") + ".";
      host.appendChild(partial);
    }
    if (model.headline) {
      var spoken = document.createElement("p");
      spoken.className = "spoken";
      spoken.textContent = model.headline;
      host.appendChild(spoken);
    }
    var motion = document.createElement("p");
    motion.className = "motion";
    motion.textContent = model.motion;
    host.appendChild(motion);
    var meta = document.createElement("div");
    meta.className = "meta";
    if (model.outcome) meta.appendChild(pill(model.outcome, model.outcome));
    if (model.tally) meta.appendChild(pill("Tally " + model.tally));
    if (model.date) meta.appendChild(pill(model.date));
    if (model.timestamp) meta.appendChild(pill("Listen at " + model.timestamp));
    host.appendChild(meta);
    var people = document.createElement("div");
    people.className = "people";
    people.appendChild(pill("Mover " + (model.mover || "unconfirmed"), model.moverStatus === "NEEDS CONFIRMATION" ? "needs" : ""));
    people.appendChild(pill("Seconder " + (model.seconder || "unconfirmed"), model.seconderStatus === "NEEDS CONFIRMATION" ? "needs" : ""));
    host.appendChild(people);
    if (model.moverStatus === "NEEDS CONFIRMATION" || model.seconderStatus === "NEEDS CONFIRMATION") {
      var warn = document.createElement("p");
      warn.textContent = "A name is unconfirmed. Do not guess it. Confirm it from the roster before approving minutes.";
      host.appendChild(warn);
    }
    if (model.evidence) {
      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = "Show evidence";
      var quote = document.createElement("p");
      quote.id = "evidence";
      quote.hidden = true;
      quote.textContent = model.evidence;
      toggle.addEventListener("click", function () {
        quote.hidden = !quote.hidden;
        toggle.textContent = quote.hidden ? "Show evidence" : "Hide evidence";
      });
      host.appendChild(toggle);
      host.appendChild(quote);
    }
    if (model.boardId && model.meetingId) {
      var pending = document.createElement("button");
      pending.type = "button";
      pending.textContent = "List names that still need confirmation";
      var status = document.createElement("p");
      status.id = "status";
      pending.addEventListener("click", function () {
        status.textContent = "Asking the server…";
        sendRequest("tools/call", {
          name: "list_pending_confirmations",
          arguments: { board_id: model.boardId, meeting_id: model.meetingId }
        }).then(function (toolResult) {
          var body = dataOf(toolResult) || {};
          var count = typeof body.count === "number" ? body.count : (body.pending || []).length;
          status.textContent = count + " mover or seconder field(s) still need confirmation on this meeting.";
        }).catch(function (error) {
          status.textContent = "The host did not run that tool. " + (error && error.message ? error.message : "");
        });
      });
      host.appendChild(pending);
      host.appendChild(status);
    }
  }

  function onToolResult(params) {
    queued = params || {};
    if (ready) render(queued);
  }

  function applyHost(ctx) {
    var vars = ctx && ctx.styles && ctx.styles.variables;
    if (!vars) return;
    Object.keys(vars).forEach(function (key) {
      if (typeof vars[key] === "string" && vars[key]) document.documentElement.style.setProperty(key, vars[key]);
    });
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.jsonrpc !== "2.0") return;
    if (data.id != null && waiters[data.id]) {
      var waiter = waiters[data.id];
      delete waiters[data.id];
      if (data.error) waiter.reject(new Error(data.error.message || "host error"));
      else waiter.resolve(data.result);
      return;
    }
    if (data.method === "ui/notifications/tool-result") onToolResult(data.params);
  });

  sendRequest("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "Board Clerk decision card", version: "0.4.1" },
    appCapabilities: { availableDisplayModes: ["inline"] }
  }).then(function (result) {
    applyHost(result && result.hostContext);
    sendNotification("ui/notifications/initialized", {});
    ready = true;
    if (queued) render(queued);
  }).catch(function () {
    ready = true;
    if (queued) render(queued);
  });
})();
</script>
</body>
</html>`;
