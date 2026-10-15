import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import aug from "../src/fixtures/juniper-2026-08-20.js";
import sept from "../src/fixtures/juniper-2026-09-17.js";
import { extractMeeting } from "../src/engine/extract.js";
import { formatDollars, parseDollarAmounts, prepareBoardPacket } from "../src/engine/packet.js";

const transcript = readFileSync(new URL("../demo/juniper-2026-10-15-transcript.txt", import.meta.url), "utf8");

describe("parseDollarAmounts", () => {
  it("reads dollar signs, written English, and digit-word amounts", () => {
    assert.deepEqual(
      parseDollarAmounts("forty-seven thousand nine hundred dollars").map((item) => item.dollars),
      [47900],
    );
    assert.deepEqual(
      parseDollarAmounts("a change order of two thousand four hundred dollars").map((item) => item.dollars),
      [2400],
    );
    assert.deepEqual(parseDollarAmounts("bid of $12,345 and 18 dollars").map((item) => item.dollars), [12345, 18]);
    assert.equal(formatDollars(50300), "$50,300");
  });
});

describe("prepareBoardPacket", () => {
  it("totals the August roof bid and leaves the tabled landscaping motion out of that spend", () => {
    const packet = prepareBoardPacket([aug, sept], "roof");
    assert.equal(packet.approved_total_dollars, 47900);
    assert.equal(packet.approved_total_display, "$47,900");
    assert.equal(packet.partial, false);
    assert.ok(packet.motions.some((motion) => motion.meeting_id === "juniper-2026-08-20"));
    assert.equal(
      packet.motions.some((motion) => /landscaping/i.test(motion.motion_text)),
      false,
    );
    assert.match(packet.spoken_summary, /\$47,900/);
  });

  it("adds the October change order, skips the failed assessment, and treats a passed table motion as tabled", () => {
    const october = extractMeeting({
      transcript,
      roster: sept.roster,
      meeting_id: "juniper-2026-10-15",
      meeting_date: "2026-10-15",
      org: sept.org,
      title: sept.title,
    });
    const packet = prepareBoardPacket([aug, sept, october], "roof");
    assert.equal(packet.motion_count, 2);
    assert.equal(packet.approved_total_dollars, 50300);
    assert.equal(packet.approved_total_display, "$50,300");
    assert.equal(
      packet.motions.some((motion) => /three hundred/i.test(motion.motion_text)),
      false,
    );
    assert.match(packet.spoken_summary, /\$50,300/);

    const held = prepareBoardPacket(
      [
        {
          meeting_id: "sample",
          meeting_date: "2026-11-01",
          motions: [
            {
              id: "M1",
              agenda_item: "Roof",
              motion_text: "Accept the roof bid of forty-seven thousand nine hundred dollars.",
              outcome: "passed",
              mover: "Ada",
              seconder: "Bea",
              attribution: {
                mover: { status: "SPOKEN", value: "Ada" },
                seconder: { status: "NEEDS CONFIRMATION", ai_suggestion: "Bea" },
              },
            },
            {
              id: "M2",
              agenda_item: "Roof warranty",
              motion_text: "Table the roof warranty discussion. The quote was nine hundred dollars.",
              outcome: "passed",
              attribution: {
                mover: { status: "SPOKEN", value: "Ada" },
                seconder: { status: "SPOKEN", value: "Bea" },
              },
            },
            {
              id: "M3",
              agenda_item: "Roof assessment",
              motion_text: "Impose a special assessment of three hundred dollars per lot for the roof.",
              outcome: "failed",
              attribution: {
                mover: { status: "SPOKEN", value: "Ada" },
                seconder: { status: "SPOKEN", value: "Bea" },
              },
            },
          ],
        },
      ],
      "roof",
    );
    assert.equal(held.approved_total_dollars, 47900);
    assert.equal(held.tabled.length, 1);
    assert.equal(held.open_confirmations.length, 1);
    assert.equal(held.open_confirmations[0].field, "seconder");
  });

  it("says when a topic word is missing from every chosen motion", () => {
    const packet = prepareBoardPacket([aug, sept], "reserve study");
    assert.equal(packet.partial, true);
    assert.ok(packet.missed_terms.includes("study"));
    assert.match(packet.spoken_summary, /No loaded motion mentions "study"/);
  });
});
