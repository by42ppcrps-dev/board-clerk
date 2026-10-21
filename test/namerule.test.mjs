import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attribute } from "../src/engine/namerule.js";

const roster = [
  { name: "Priya Raman", role: "Treasurer" },
  { name: "Luis Trevino", role: "Vice President" },
  { name: "Mark Ellison", role: "Secretary" },
];

describe("attribute", () => {
  it("marks a surname spoken inside the window and keeps the roster full name", () => {
    const motion = { mover: "Raman", seconder: "Trevino", motion_timestamp: "00:10:00" };
    const lines = [
      "[00:09:20] Chair: Raman moves that we approve the bid.",
      "[00:10:10] Chair: Trevino seconds.",
    ];
    const attr = attribute(motion, lines, roster);
    assert.equal(attr.mover.status, "SPOKEN");
    assert.equal(attr.mover.value, "Priya Raman");
    assert.equal(attr.seconder.status, "SPOKEN");
    assert.equal(attr.seconder.value, "Luis Trevino");
    assert.equal(attr.mover.evidence.at, "00:09:20");
  });

  it("accepts a first name or the full name as an alias", () => {
    const motion = { mover: "Priya Raman", seconder: "Mark", motion_timestamp: "00:10:00" };
    const lines = [
      "[00:10:00] Chair: Priya asked for the vote.",
      "[00:10:20] Secretary: Mark is the seconder on my notes.",
    ];
    const attr = attribute(motion, lines, roster);
    assert.equal(attr.mover.status, "SPOKEN");
    assert.equal(attr.mover.value, "Priya Raman");
    assert.equal(attr.seconder.status, "SPOKEN");
    assert.equal(attr.seconder.value, "Mark Ellison");
  });

  it("needs confirmation when the name is outside -45s..+30s", () => {
    const motion = { mover: "Raman", seconder: "Ellison", motion_timestamp: "00:10:00" };
    const lines = [
      "[00:08:00] Priya Raman: talking much earlier.",
      "[00:12:00] Mark Ellison: talking much later.",
    ];
    const attr = attribute(motion, lines, roster);
    assert.equal(attr.mover.status, "NEEDS CONFIRMATION");
    assert.equal(attr.mover.ai_suggestion, "Raman");
    assert.match(attr.mover.reason, /not spoken/);
    assert.equal(attr.seconder.status, "NEEDS CONFIRMATION");
    assert.equal(attr.seconder.ai_suggestion, "Ellison");
  });

  it("includes the -45s and +30s boundaries and excludes one second outside", () => {
    const motion = { mover: "Raman", seconder: "Trevino", motion_timestamp: "00:10:00" };
    const inside = attribute(motion, [
      "[00:09:15] Someone: Raman is in.",
      "[00:10:30] Someone: Trevino is in.",
    ], roster);
    assert.equal(inside.mover.status, "SPOKEN");
    assert.equal(inside.seconder.status, "SPOKEN");

    const outside = attribute(motion, [
      "[00:09:14] Someone: Raman is out.",
      "[00:10:31] Someone: Trevino is out.",
    ], roster);
    assert.equal(outside.mover.status, "NEEDS CONFIRMATION");
    assert.equal(outside.seconder.status, "NEEDS CONFIRMATION");
  });

  it("needs confirmation when the extractor could not name the person", () => {
    const attr = attribute(
      { mover: "UNCLEAR", seconder: "", motion_timestamp: "00:04:52" },
      ["[00:04:52] Board Member: I move that we approve the lights."],
      roster,
    );
    assert.equal(attr.mover.status, "NEEDS CONFIRMATION");
    assert.equal(attr.mover.ai_suggestion, "UNCLEAR");
    assert.equal(attr.seconder.status, "NEEDS CONFIRMATION");
    assert.equal(attr.seconder.ai_suggestion, "UNCLEAR");
  });

  it("never counts a speaker label alone as SPOKEN", () => {
    const people = [{ name: "Maya Patel" }, { name: "Leo Chen" }];
    const lines = [
      "[00:01:00] Maya Patel: I move to approve the roof repair.",
      "[00:01:05] Leo Chen: Second.",
      "[00:01:10] Chair: The motion passes.",
    ];
    const attr = attribute({ mover: "Patel", seconder: "Chen", motion_timestamp: "00:01:00" }, lines, people);
    assert.equal(attr.mover.status, "NEEDS CONFIRMATION");
    assert.equal(attr.mover.ai_suggestion, "Patel");
    assert.match(attr.mover.reason, /speaker label alone/);
    assert.equal(attr.seconder.status, "NEEDS CONFIRMATION");

    const said = attribute(
      { mover: "Patel", seconder: "Chen", motion_timestamp: "00:01:00" },
      [...lines, "[00:01:12] Chair: Moved by Patel, seconded by Chen."],
      people,
    );
    assert.equal(said.mover.status, "SPOKEN");
    assert.equal(said.mover.evidence.at, "00:01:12");
    assert.equal(said.seconder.status, "SPOKEN");
  });

  it("holds a name shared by two roster members, whatever the roster order", () => {
    const danas = [{ name: "Dana Smith" }, { name: "Dana Jones" }, { name: "Lee Park" }];
    const lines = ["[00:01:00] Chair: Dana moved it and Park seconded."];
    const motion = { mover: "Dana", seconder: "Park", motion_timestamp: "00:01:00" };
    const a = attribute(motion, lines, danas);
    const b = attribute(motion, lines, [...danas].reverse());
    assert.deepEqual(a, b);
    assert.equal(a.mover.status, "NEEDS CONFIRMATION");
    assert.deepEqual(a.mover.candidates, ["Dana Jones", "Dana Smith"]);
    assert.match(a.mover.reason, /more than one roster member/);
    assert.equal(a.seconder.status, "SPOKEN");
    assert.equal(a.seconder.value, "Lee Park");
  });

  it("does not let a shared first name prove a unique surname was spoken", () => {
    const danas = [{ name: "Dana Smith" }, { name: "Dana Jones" }];
    const motion = { mover: "Smith", seconder: "UNCLEAR", motion_timestamp: "00:01:00" };
    const onlyFirst = attribute(motion, ["[00:01:00] Chair: Dana has the motion."], danas);
    assert.equal(onlyFirst.mover.status, "NEEDS CONFIRMATION");
    const surname = attribute(motion, ["[00:01:00] Chair: Director Smith has the motion."], danas);
    assert.equal(surname.mover.status, "SPOKEN");
    assert.equal(surname.mover.value, "Dana Smith");
  });
});
