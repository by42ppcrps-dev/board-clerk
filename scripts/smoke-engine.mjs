#!/usr/bin/env node
/** Offline smoke test for engine (no network, $0 Gemini). */
import {
  listMeetings,
  listMotions,
  getDecision,
  whatDidWeDecide,
  listPendingConfirmations,
  confirmMoverSeconder,
  draftMinutes,
  FIXTURES,
} from "../src/engine.js";
import { prepareBoardPacket } from "../src/engine/packet.js";

let fails = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    fails++;
  } else {
    console.log("ok:", msg);
  }
}

const meetings = listMeetings();
assert(meetings.length === 2, `2 meetings (got ${meetings.length})`);

const roof = whatDidWeDecide("what did we decide about the roof?");
assert(roof.hits.length >= 1, "roof query hits");
assert(/Summit Ridge|roof/i.test(roof.top_answer), "roof answer mentions roof/Summit");
console.log("  top:", roof.top_answer.slice(0, 120) + "...");

const pool = whatDidWeDecide("pool resurfacing");
assert(pool.hits.length >= 1, "pool query hits");

const motions = listMotions("juniper-2026-09-17");
assert(motions.motions.length === 5, `Sept has 5 motions (got ${motions.motions.length})`);

const pending = listPendingConfirmations("juniper-2026-09-17");
assert(pending.count >= 2, `pending confirms >=2 (got ${pending.count})`);

let confirms = {};
const { confirmation, motion } = confirmMoverSeconder(
  {
    meeting_id: "juniper-2026-09-17",
    motion_id: "M2",
    field: "mover",
    value: "Ellison",
    confirmed_by: "Synthetic Clerk",
  },
  confirms,
);
confirms[`${confirmation.meeting_id}::${confirmation.motion_id}::${confirmation.field}`] = confirmation;
assert(motion.attribution.mover.status === "CONFIRMED BY CLERK", "mover confirmed");

const dec = getDecision("juniper-2026-08-20", "M2", confirms);
assert(/passed/i.test(dec.outcome), "Aug roof motion passed");
assert(/47|forty/i.test(dec.decision), "roof amount in decision");

const draft = draftMinutes("juniper-2026-09-17", confirms);
assert(draft.markdown.includes("Juniper Hollow"), "draft has org");
assert(draft.markdown.includes("## Motions"), "draft has motions");

const packet = prepareBoardPacket(FIXTURES, "roof");
assert(packet.approved_total_dollars === 47900, `roof packet total 47900 (got ${packet.approved_total_dollars})`);
assert(packet.tabled.length === 0, "roof packet has no tabled landscaping motion");

if (fails) {
  console.error(`\n${fails} failure(s)`);
  process.exit(1);
}
console.log("\nAll engine smoke checks passed. Gemini $ spent: 0");
