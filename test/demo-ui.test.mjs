// Drives the real /demo page (HTML, inline script, fetch to /mcp) in jsdom
// against the in-process worker. Covers the confirmation dropdown after the
// page switches to a board whose roster is not the Juniper Hollow default.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import worker from "../src/index.js";

const ORIGIN = "http://127.0.0.1:8787";

function workerFetch(input, init) {
  const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
  const headers = new Headers(init?.headers || {});
  if (url.pathname === "/mcp") headers.set("origin", ORIGIN);
  return worker.fetch(new Request(url, { ...init, headers }));
}

let rpcSeq = 0;
async function mcpTool(name, args) {
  const res = await workerFetch("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcSeq, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const msg = JSON.parse(line ? line.slice(5) : text);
  return msg.result.structuredContent || JSON.parse(msg.result.content[0].text);
}

async function openDemo(query) {
  const page = await workerFetch(`/demo${query}`);
  assert.equal(page.status, 200);
  const dom = new JSDOM(await page.text(), {
    url: `${ORIGIN}/demo${query}`,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = workerFetch;
    },
  });
  await waitFor(dom, () => /^Ready\./.test(dom.window.document.getElementById("answer").textContent));
  return dom;
}

async function waitFor(dom, check, label = "condition") {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}: ${dom.window.document.getElementById("answer").textContent}`);
}

async function askPending(dom, text) {
  const doc = dom.window.document;
  doc.getElementById("pending-view").replaceChildren();
  const chip = [...doc.querySelectorAll("[data-ask]")].find((b) => b.getAttribute("data-ask") === "What still needs confirming?");
  chip.click();
  await waitFor(
    dom,
    () =>
      doc.querySelectorAll("#pending-view [data-testid=roster-select]").length > 0 &&
      (!text || text.test(doc.getElementById("pending-view").textContent)),
    "roster dropdown",
  );
  return doc;
}

function optionNames(select) {
  return [...select.options].map((o) => o.value).filter(Boolean);
}

const DANA_ROSTER = [
  { name: "Dana Smith", role: "Director" },
  { name: "Dana Jones", role: "Director" },
  { name: "Lee Park", role: "Director" },
];

describe("demo page confirmation dropdown", () => {
  const DANA_TRANSCRIPT = [
    "[00:01:00] Dana: I move to approve the roof repair.",
    "[00:01:05] Lee Park: Second.",
    "[00:01:10] Chair: Moved by Dana, seconded by Park. The motion passes.",
  ].join("\n");

  async function ingestDana(board_id) {
    const ingested = await mcpTool("ingest_meeting", {
      board_id,
      transcript: DANA_TRANSCRIPT,
      meeting_date: "2026-08-01",
      roster: DANA_ROSTER,
    });
    assert.ok(ingested.meeting_id, JSON.stringify(ingested));
    const before = await mcpTool("list_pending_confirmations", { board_id, meeting_id: ingested.meeting_id });
    assert.equal(before.count, 1, JSON.stringify(before.pending));
    assert.deepEqual(before.pending[0].roster.map((p) => p.name), ["Dana Smith", "Dana Jones", "Lee Park"]);
    return { meeting_id: ingested.meeting_id, motion_id: before.pending[0].motion_id };
  }

  function danaItemOf(doc) {
    const items = [...doc.querySelectorAll("#pending-view .pending-item")];
    const item = items.find((li) => /approve the roof repair/i.test(li.textContent));
    assert.ok(item, "Dana motion is pending: " + items.map((li) => li.textContent).join(" | "));
    return item;
  }

  async function confirmThroughDropdown(dom, item, name) {
    const doc = dom.window.document;
    assert.equal(item.querySelector("[data-testid=confirm-suggestion]"), null, "ambiguous Dana has no one-click confirm");
    const select = item.querySelector("[data-testid=roster-select]");
    assert.deepEqual(optionNames(select), ["Dana Smith", "Dana Jones", "Lee Park"]);
    select.value = name;
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    item.querySelector("[data-testid=confirm-roster]").click();
    await waitFor(dom, () => new RegExp("Confirmed mover as " + name).test(doc.getElementById("answer").textContent), "confirm answer");
  }

  async function assertConfirmed(board_id, ids, name) {
    const after = await mcpTool("list_pending_confirmations", { board_id, meeting_id: ids.meeting_id });
    assert.equal(after.count, 0, JSON.stringify(after.pending));
    const motion = await mcpTool("get_motion", { board_id, meeting_id: ids.meeting_id, motion_id: ids.motion_id });
    assert.equal(motion.attribution.mover.status, "CONFIRMED BY CLERK");
    assert.equal(motion.attribution.mover.value, name);
  }

  it("offers a meeting's own roster when another client adds it to the open board, and confirms Dana Jones through the dropdown", async () => {
    const dom = await openDemo("?reset=1");
    const doc = dom.window.document;
    const board_id = doc.getElementById("board-id").textContent;
    await askPending(dom);
    const juniperNames = optionNames(doc.querySelector("[data-testid=roster-select]"));
    assert.deepEqual(juniperNames, ["Dana Okafor", "Luis Trevino", "Priya Raman", "Mark Ellison", "Grace Lindqvist"]);

    // The roster changes under the open page (command path from another client).
    const ids = await ingestDana(board_id);
    await askPending(dom, /approve the roof repair/i);
    await confirmThroughDropdown(dom, danaItemOf(doc), "Dana Jones");
    await assertConfirmed(board_id, ids, "Dana Jones");
    dom.window.close();
  });

  it("offers the active board's roster after switching boards, then the Juniper roster again after switching back", async () => {
    const board_id = `dana-ui-${Date.now()}`;
    const ids = await ingestDana(board_id);
    // Opening the page on the Dana board seeds the later-dated Juniper
    // fixtures onto it; the Dana item must still offer its own roster.
    const dana = await openDemo(`?board=${board_id}`);
    await askPending(dana);
    await confirmThroughDropdown(dana, danaItemOf(dana.window.document), "Dana Smith");
    await assertConfirmed(board_id, ids, "Dana Smith");
    dana.window.close();

    const juniper = await openDemo("?reset=1");
    const doc = await askPending(juniper);
    for (const select of doc.querySelectorAll("[data-testid=roster-select]")) {
      assert.deepEqual(optionNames(select), ["Dana Okafor", "Luis Trevino", "Priya Raman", "Mark Ellison", "Grace Lindqvist"]);
    }
    juniper.window.close();
  });

  async function askTyped(dom, text) {
    const doc = dom.window.document;
    const input = doc.querySelector("#ask-form input[type=text]");
    input.value = text;
    doc.getElementById("answer").textContent = "";
    doc.getElementById("ask-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(dom, () => doc.getElementById("answer").textContent.trim().length > 0 && !doc.getElementById("ask-btn").disabled, "answer");
    return doc.getElementById("answer").textContent;
  }

  it("never approves minutes on a negated command such as 'Do not approve the minutes'", async () => {
    const dom = await openDemo("?reset=1");
    const doc = dom.window.document;
    const board_id = doc.getElementById("board-id").textContent;
    for (const text of [
      "Do not approve the minutes",
      "Don't approve the minutes",
      "do not approve the minutes yet.",
      "Never approve the minutes without me",
      "Please don't approve last night's minutes",
      "Hold off on approving the minutes",
    ]) {
      const answer = await askTyped(dom, text);
      assert.match(answer, /did not approve/i, text);
      assert.equal(doc.getElementById("approved-banner").hidden, true, text);
      const approvals = await mcpTool("list_approvals", { board_id });
      assert.equal(approvals.approvals.length, 0, `${text}: ${JSON.stringify(approvals.approvals)}`);
    }
    // Unrelated sentences that merely contain the phrase are not approval commands.
    await askTyped(dom, "Who said we should approve the minutes?");
    assert.equal((await mcpTool("list_approvals", { board_id })).approvals.length, 0);
    dom.window.close();
  });

  it("does not duplicate the meeting or roof spend when 'Ingest last night's meeting' is pressed twice", async () => {
    const dom = await openDemo("?reset=1");
    const doc = dom.window.document;
    const board_id = doc.getElementById("board-id").textContent;
    const ingestOnce = async () => {
      doc.getElementById("answer").textContent = "";
      doc.getElementById("ingest-meeting").click();
      await waitFor(dom, () => /Ingested|already ingested/i.test(doc.getElementById("answer").textContent) && !doc.getElementById("ingest-meeting").disabled, "ingest");
      return doc.getElementById("answer").textContent;
    };
    await ingestOnce();
    const once = await mcpTool("prepare_board_packet", { board_id, topic: "roof" });
    const meetingsOnce = (await mcpTool("list_meetings", { board_id })).meetings.length;
    const second = await ingestOnce();
    assert.match(second, /already ingested/i);
    const twice = await mcpTool("prepare_board_packet", { board_id, topic: "roof" });
    assert.equal(twice.approved_total_dollars, once.approved_total_dollars);
    assert.equal(twice.approved_total_dollars, 50300);
    assert.equal(twice.motion_count, once.motion_count);
    assert.equal((await mcpTool("list_meetings", { board_id })).meetings.length, meetingsOnce);
    dom.window.close();
  });

  it("keeps the question field one line tall in the mobile layout", async () => {
    const res = await workerFetch("/demo");
    const html = await res.text();
    const mobile = html.slice(html.indexOf("@media (max-width: 899px)"));
    assert.match(mobile.slice(0, mobile.indexOf("}\n  }") + 4), /\.controls input\[type="text"\] \{ flex: 0 0 auto; \}/);
  });
});
