import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import sept from "../src/fixtures/juniper-2026-09-17.js";
import { extractMeeting, matchChairCue } from "../src/engine/extract.js";
import { validateMotions } from "../src/engine/validate.js";

const transcript = readFileSync(new URL("../demo/juniper-2026-10-15-transcript.txt", import.meta.url), "utf8");

describe("extractMeeting demo transcript", () => {
  const meeting = extractMeeting({
    transcript,
    roster: sept.roster,
    meeting_id: "juniper-2026-10-15",
    meeting_date: "2026-10-15",
    org: sept.org,
    title: "Juniper Hollow Owners Association Board of Directors Regular Meeting",
  });

  it("finds the six scripted motions and ignores # comment lines", () => {
    assert.equal(meeting.motions.length, 6);
    assert.deepEqual(
      meeting.motions.map((motion) => motion.id),
      ["M1", "M2", "M3", "M4", "M5", "M6"],
    );
    assert.equal(meeting.motions.some((motion) => /million|private jet/i.test(motion.motion_text)), false);
  });

  it("keeps outcomes in agenda, roof, unnamed, failed, tabled, adjourn order", () => {
    assert.deepEqual(
      meeting.motions.map((motion) => motion.outcome),
      ["passed", "passed", "passed", "failed", "tabled", "passed"],
    );
    assert.match(meeting.motions[1].motion_text, /Summit Ridge|roof|flashing/i);
    assert.equal(meeting.motions[3].outcome, "failed");
    assert.equal(meeting.motions[4].outcome, "tabled");
    assert.match(meeting.motions[5].motion_text, /adjourn/i);
  });

  it("leaves at least one mover or seconder needing confirmation", () => {
    const needs = meeting.motions.filter(
      (motion) =>
        motion.attribution.mover.status === "NEEDS CONFIRMATION" ||
        motion.attribution.seconder.status === "NEEDS CONFIRMATION",
    );
    assert.ok(needs.length >= 1);
    const unnamed = meeting.motions[2];
    assert.equal(unnamed.attribution.mover.status, "NEEDS CONFIRMATION");
    assert.equal(unnamed.attribution.seconder.status, "NEEDS CONFIRMATION");
    assert.equal(unnamed.attribution.mover.ai_suggestion, "UNCLEAR");
  });

  it("emits timestamps that validate against the motion schema", () => {
    const result = validateMotions({ motions: meeting.motions });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    for (const motion of meeting.motions) {
      assert.match(motion.motion_timestamp, /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);
      assert.match(motion.vote_timestamp, /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);
    }
  });

  it("records the fictional October roster roll call", () => {
    assert.equal(meeting.meeting_date, "2026-10-15");
    assert.equal(meeting.synthetic, true);
    assert.match(meeting.note, /FICTIONAL/);
    for (const person of sept.roster) {
      assert.ok(meeting.present.includes(person.name), person.name);
    }
    assert.equal(meeting.absent.length, 0);
  });
});

describe("extractMeeting agenda, header, and tallies", () => {
  it("reads chair cues and the # header when org and title are omitted", () => {
    assert.equal(matchChairCue("Moving on to the roof bid."), "The roof bid");
    assert.equal(matchChairCue("New business: holiday lights"), "Holiday lights");
    assert.equal(matchChairCue("Old business: gate repair"), "Gate repair");
    assert.equal(matchChairCue("Item 4: pool resurfacing"), "Pool resurfacing");
    assert.equal(matchChairCue("Next item is a special assessment proposal."), "A special assessment proposal");

    const bare = extractMeeting({
      transcript,
      roster: sept.roster,
      meeting_id: "from-header",
      meeting_date: "2026-10-15",
    });
    assert.match(bare.org, /Juniper Hollow Owners Association/);
    assert.doesNotMatch(bare.org, /^Board \(FICTIONAL\)$/);
    assert.match(bare.title, /Regular board meeting/);
    assert.match(bare.motions[0].agenda_item, /agenda/i);
    assert.match(bare.motions[1].agenda_item, /roof/i);
    assert.match(bare.motions[3].agenda_item, /assessment/i);
    assert.equal(
      bare.motions.some((motion) => /^Business item \d+$/.test(motion.agenda_item)),
      false,
    );
  });

  it("does not count a director who is absent at roll call as an aye", () => {
    const transcript = `
[00:00:10] Dana Okafor: Roll call.
[00:00:20] Dana Okafor: Grace Lindqvist was present earlier this year for the budget workshop and the reserve study kickoff but is absent today.
[00:00:30] Dana Okafor: Present.
[00:00:34] Luis Trevino: Present.
[00:00:38] Priya Raman: Present.
[00:00:42] Mark Ellison: Present.
[00:01:00] Luis Trevino: I move that we approve the newsletter budget of five hundred dollars.
[00:01:08] Priya Raman: Second.
[00:01:16] Dana Okafor: All in favor? The motion carries.
`;
    const meeting = extractMeeting({
      transcript,
      roster: sept.roster,
      meeting_id: "tally-long",
      meeting_date: "2026-11-01",
      org: "Juniper Hollow Owners Association (FICTIONAL)",
      title: "Tally check",
    });
    const motion = meeting.motions[0];
    assert.ok(meeting.absent.includes("Grace Lindqvist"));
    assert.equal(meeting.present.includes("Grace Lindqvist"), false);
    assert.deepEqual(motion.ayes, ["Okafor", "Trevino", "Raman", "Ellison"]);
    assert.equal(motion.ayes.includes("Lindqvist"), false);
  });

  it("keeps the chair who reports an absence, and does not aye the absent member", () => {
    const transcript = `
[00:00:10] Dana Okafor: Roll call.
[00:00:20] Dana Okafor: Present.
[00:00:24] Luis Trevino: Present.
[00:00:28] Priya Raman: Present.
[00:00:32] Mark Ellison: Present.
[00:00:40] Dana Okafor: Grace is absent.
[00:01:00] Luis Trevino: I move that we approve the newsletter.
[00:01:08] Priya Raman: I'll second.
[00:01:16] Dana Okafor: All in favor? The motion carries.
`;
    const meeting = extractMeeting({
      transcript,
      roster: sept.roster,
      meeting_id: "tally-first",
      meeting_date: "2026-11-02",
      org: "Juniper Hollow Owners Association (FICTIONAL)",
      title: "Tally check",
    });
    const motion = meeting.motions[0];
    assert.ok(meeting.absent.includes("Grace Lindqvist"));
    assert.ok(meeting.present.includes("Dana Okafor"));
    assert.ok(motion.ayes.includes("Okafor"));
    assert.equal(motion.ayes.includes("Lindqvist"), false);
    assert.equal(motion.ayes.length, 4);
  });

  it("does not give a non-voting manager an aye on a voice vote", () => {
    const transcript = `
[00:00:10] Dana Okafor: Roll call.
[00:00:20] Dana Okafor: Present.
[00:00:24] Luis Trevino: Present.
[00:00:28] Priya Raman: Present.
[00:00:32] Mark Ellison: Present.
[00:00:36] Grace Lindqvist: Present.
[00:00:42] Tom Becker: Present.
[00:01:00] Luis Trevino: I move that we approve the newsletter.
[00:01:08] Priya Raman: Second.
[00:01:16] Dana Okafor: All in favor? The motion carries.
`;
    const meeting = extractMeeting({
      transcript,
      roster: [
        ...sept.roster,
        { name: "Tom Becker", role: "Community Manager, Cascade Community Management (FICTIONAL)" },
      ],
      meeting_id: "tally-staff",
      meeting_date: "2026-11-03",
      org: "Juniper Hollow Owners Association (FICTIONAL)",
      title: "Tally check",
    });
    assert.deepEqual(meeting.motions[0].ayes, ["Okafor", "Trevino", "Raman", "Ellison", "Lindqvist"]);
    assert.equal(meeting.motions[0].ayes.includes("Becker"), false);
  });
});

describe("extractMeeting ambiguous and label-only names", () => {
  const danaTranscript = [
    "[00:01:00] Dana: I move to approve the roof repair.",
    "[00:01:05] Lee Park: Second.",
    "[00:01:10] Chair: The motion passes.",
  ].join("\n");
  const danaRoster = [{ name: "Dana Smith" }, { name: "Dana Jones" }, { name: "Lee Park" }];
  const run = (transcript, roster) =>
    extractMeeting({ transcript, roster, meeting_id: "amb", meeting_date: "2026-10-01" });

  it("leaves an ambiguous mover as an open question instead of picking the first roster match", () => {
    const meeting = run(danaTranscript, danaRoster);
    const mover = meeting.motions[0].attribution.mover;
    assert.equal(meeting.motions[0].mover, "UNCLEAR");
    assert.equal(mover.status, "NEEDS CONFIRMATION");
    assert.deepEqual(mover.candidates, ["Dana Jones", "Dana Smith"]);
    assert.ok(meeting.open_questions.some((q) => /mover for M1/.test(q) && /Dana Jones, Dana Smith/.test(q)));
    assert.notEqual(mover.value, "Dana Smith");
  });

  it("gives the same motions and open questions when the roster order is reversed", () => {
    const a = run(danaTranscript, danaRoster);
    const b = run(danaTranscript, [...danaRoster].reverse());
    const people = (m) => m.motions.map((mot) => ({ mover: mot.mover, seconder: mot.seconder, attribution: mot.attribution }));
    assert.deepEqual(people(b), people(a));
    assert.deepEqual(b.open_questions, a.open_questions);
  });

  it("holds an ambiguous stated name too", () => {
    const meeting = run(
      [
        "[00:01:00] Chair: Motion to approve the roof repair.",
        "[00:01:10] Chair: Moved by Dana, seconded by Park. The motion passes.",
      ].join("\n"),
      danaRoster,
    );
    assert.equal(meeting.motions[0].attribution.mover.status, "NEEDS CONFIRMATION");
    assert.deepEqual(meeting.motions[0].attribution.mover.candidates, ["Dana Jones", "Dana Smith"]);
    assert.equal(meeting.motions[0].attribution.seconder.status, "SPOKEN");
  });

  it("flags the tally when a roll-call voter label is ambiguous", () => {
    const meeting = run(
      [
        "[00:01:00] Lee Park: I move to approve the roof repair.",
        "[00:01:05] Dana Smith: Second.",
        "[00:01:10] Dana: Aye.",
        "[00:01:12] Lee Park: Aye.",
        "[00:01:20] Chair: The motion passes.",
      ].join("\n"),
      danaRoster,
    );
    assert.ok(meeting.motions[0].uncertain_fields.includes("tally"));
    assert.deepEqual(meeting.motions[0].ayes, ["Park"]);
  });

  it("does not mark names SPOKEN from speaker labels alone", () => {
    const roster = [{ name: "Maya Patel" }, { name: "Leo Chen" }];
    const labelsOnly = [
      "[00:01:00] Maya Patel: I move to approve the roof repair.",
      "[00:01:05] Leo Chen: Second.",
      "[00:01:10] Chair: The motion passes.",
    ].join("\n");
    const meeting = run(labelsOnly, roster);
    assert.equal(meeting.motions[0].attribution.mover.status, "NEEDS CONFIRMATION");
    assert.equal(meeting.motions[0].attribution.seconder.status, "NEEDS CONFIRMATION");
    assert.equal(meeting.open_questions.length, 2);

    const restated = run(labelsOnly + "\n[00:01:12] Chair: Moved by Patel, seconded by Chen.", roster);
    assert.equal(restated.motions[0].attribution.mover.status, "SPOKEN");
    assert.equal(restated.motions[0].attribution.seconder.status, "SPOKEN");
    assert.equal(restated.open_questions.length, 0);
  });
});

