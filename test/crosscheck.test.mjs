import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crosscheck, norm, tsec } from "../src/engine/crosscheck.js";

function motion(overrides = {}) {
  return {
    agenda_item: "item",
    motion_text: "Do the thing.",
    mover: "Weber",
    seconder: "Matz",
    outcome: "passed",
    ayes: ["Weber"],
    nays: ["Schmidt"],
    motion_timestamp: "00:01:00",
    vote_timestamp: "00:01:20",
    confidence: "high",
    uncertain_fields: [],
    evidence_quote: "moved and passed",
    ...overrides,
  };
}

describe("norm and tsec", () => {
  it("strips titles and keeps the surname", () => {
    assert.equal(norm("Commissioner Weber"), "weber");
    assert.equal(norm("Board President Okafor"), "okafor");
    assert.equal(norm("Vice Chair Matz"), "matz");
    assert.equal(norm("Dr. Schmidt"), "schmidt");
    assert.equal(norm(""), "");
    assert.equal(norm(null), "");
  });

  it("parses HH:MM:SS and MM:SS", () => {
    assert.equal(tsec("00:01:02"), 62);
    assert.equal(tsec("01:00:00"), 3600);
    assert.equal(tsec("01:00"), 60);
    assert.equal(tsec("bad"), null);
    assert.equal(tsec(""), null);
  });
});

describe("crosscheck", () => {
  it("pairs within 120 seconds and stays quiet when the passes agree", () => {
    const draft = { motions: [motion()] };
    const verify = {
      motions: [motion({ mover: "Commissioner Weber", motion_timestamp: "00:02:00" })],
    };
    crosscheck(draft, verify);
    assert.deepEqual(draft.motions[0].flags, []);
    assert.equal(draft.motions.length, 1);
  });

  it("treats a 120 second gap as a pair and 121 seconds as a miss", () => {
    const paired = { motions: [motion({ motion_timestamp: "00:00:00" })] };
    crosscheck(paired, { motions: [motion({ motion_timestamp: "00:02:00" })] });
    assert.equal(paired.motions[0].flags.includes("second pass did not find this motion"), false);

    const missed = { motions: [motion({ motion_timestamp: "00:00:00" })] };
    crosscheck(missed, { motions: [motion({ motion_timestamp: "00:02:01", agenda_item: "only on pass 2" })] });
    assert.ok(missed.motions[0].flags.includes("second pass did not find this motion"));
    assert.equal(missed.motions[1].agenda_item, "only on pass 2");
    assert.deepEqual(missed.motions[1].flags, [
      "found only by second pass: CHECK whether this motion was made",
    ]);
  });

  it("flags mover, seconder, outcome, and nays disagreements", () => {
    const draft = { motions: [motion()] };
    crosscheck(draft, {
      motions: [
        motion({
          mover: "Schmidt",
          seconder: "Director Evans",
          outcome: "failed",
          nays: [],
          motion_timestamp: "00:01:10",
        }),
      ],
    });
    const flags = draft.motions[0].flags;
    assert.ok(flags.includes("passes disagree on mover: 'Weber' vs 'Schmidt'"));
    assert.ok(flags.includes("passes disagree on seconder: 'Matz' vs 'Director Evans'"));
    assert.ok(flags.includes("passes disagree on outcome: passed vs failed"));
    assert.ok(flags.includes("passes disagree on nays: ['Schmidt'] vs []"));
  });

  it("does not flag nays when only the names differ", () => {
    const draft = { motions: [motion({ nays: ["A"] })] };
    crosscheck(draft, { motions: [motion({ nays: ["B"], motion_timestamp: "00:01:05" })] });
    assert.equal(draft.motions[0].flags.some((flag) => flag.startsWith("passes disagree on nays")), false);
  });

  it("flags uncertainty, low confidence, and UNCLEAR names on a paired motion", () => {
    const draft = {
      motions: [
        motion({
          mover: "UNCLEAR",
          confidence: "medium",
          uncertain_fields: ["mover", "tally"],
        }),
      ],
    };
    crosscheck(draft, { motions: [motion({ mover: "UNCLEAR" })] });
    assert.deepEqual(draft.motions[0].flags, [
      "model unsure: mover, tally",
      "confidence medium",
      "mover/seconder unclear",
    ]);
  });

  it("sorts by motion timestamp after appending a second-pass-only motion", () => {
    const draft = { motions: [motion({ motion_timestamp: "00:10:00", agenda_item: "later" })] };
    crosscheck(draft, {
      motions: [motion({ motion_timestamp: "00:01:00", agenda_item: "earlier extra" })],
    });
    assert.deepEqual(
      draft.motions.map((item) => item.agenda_item),
      ["earlier extra", "later"],
    );
  });
});
