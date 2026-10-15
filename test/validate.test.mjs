import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateMotions } from "../src/engine/validate.js";

function motion(overrides = {}) {
  return {
    agenda_item: "4. Roof",
    motion_text: "Accept the bid.",
    mover: "Raman",
    seconder: "Trevino",
    outcome: "passed",
    ayes: ["Raman"],
    nays: [],
    abstain: [],
    absent: [],
    vote_method: "voice",
    motion_timestamp: "00:22:10",
    vote_timestamp: "00:28:45",
    confidence: "high",
    uncertain_fields: [],
    evidence_quote: "Raman moves. Trevino seconds. Motion passes.",
    ...overrides,
  };
}

describe("validateMotions", () => {
  it("accepts a schema-complete motion", () => {
    const result = validateMotions({ motions: [motion()] });
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.motions[0].outcome, "passed");
    assert.equal(result.motions[0].motion_timestamp, "00:22:10");
  });

  it("defaults optional abstain, absent, and vote_method", () => {
    const raw = motion();
    delete raw.abstain;
    delete raw.absent;
    delete raw.vote_method;
    const result = validateMotions([raw]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.motions[0].abstain, []);
    assert.deepEqual(result.motions[0].absent, []);
    assert.equal(result.motions[0].vote_method, "");
  });

  it("rejects an unknown outcome", () => {
    const result = validateMotions({ motions: [motion({ outcome: "approved" })] });
    assert.equal(result.ok, false);
    assert.match(result.errors[0].message, /outcome|invalid|enum/i);
  });

  it("rejects bad timestamps", () => {
    for (const stamp of ["00:01", "1:02:03", "24:00:00", "00:60:00", "00:00:60", "noon"]) {
      const result = validateMotions({ motions: [motion({ motion_timestamp: stamp })] });
      assert.equal(result.ok, false, stamp);
      assert.match(result.errors[0].message, /timestamp|motion_timestamp/i, stamp);
    }
  });

  it("accepts the timestamp endpoints", () => {
    const result = validateMotions({
      motions: [motion({ motion_timestamp: "00:00:00", vote_timestamp: "23:59:59" })],
    });
    assert.equal(result.ok, true);
  });

  it("rejects a missing required field", () => {
    const raw = motion();
    delete raw.motion_text;
    const result = validateMotions({ motions: [raw] });
    assert.equal(result.ok, false);
    assert.match(result.errors[0].message, /motion_text/);
  });

  it("rejects a payload without a motions array", () => {
    const result = validateMotions({ motions: null });
    assert.equal(result.ok, false);
    assert.match(result.errors[0].message, /motions/);
  });
});
