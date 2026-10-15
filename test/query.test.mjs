import assert from "node:assert/strict";
import { describe, it } from "node:test";
import aug from "../src/fixtures/juniper-2026-08-20.js";
import sept from "../src/fixtures/juniper-2026-09-17.js";
import { whatDidWeDecide as wrapped } from "../src/engine.js";
import {
  confirmKey,
  confirmMoverSeconder,
  whatDidWeDecide,
} from "../src/engine/query.js";

const meetings = [aug, sept];

describe("whatDidWeDecide", () => {
  it("finds the August roof decision from a question that includes stopwords", () => {
    const roof = whatDidWeDecide(meetings, "what did we decide about the roof?");
    assert.ok(roof.hits.length >= 1);
    assert.ok(roof.hits.some((hit) => hit.meeting_id === "juniper-2026-08-20"));
    assert.match(roof.top_answer, /Summit Ridge|roof/i);
    const viaWrapper = wrapped("what did we decide about the roof?");
    assert.match(viaWrapper.top_answer, /Summit Ridge|roof/i);
  });

  it("does not match the stopword we by itself", () => {
    const onlyWe = whatDidWeDecide(meetings, "we");
    assert.equal(onlyWe.hits.length, 0);
    assert.match(onlyWe.top_answer, /No board decision matched/);
  });

  it("stems roofing and bids onto the August roof bid", () => {
    const roofing = whatDidWeDecide(meetings, "roofing");
    assert.ok(roofing.hits.some((hit) => hit.meeting_id === "juniper-2026-08-20" && /roof/i.test(hit.motion_text + hit.agenda_item)));
    const bids = whatDidWeDecide(meetings, "bids");
    assert.ok(bids.hits.some((hit) => hit.meeting_id === "juniper-2026-08-20"));
  });

  it("expands roof/reroof and pool/resurface synonyms", () => {
    const reroof = whatDidWeDecide(meetings, "reroof");
    assert.ok(reroof.hits.some((hit) => hit.meeting_id === "juniper-2026-08-20" && /roof/i.test(hit.agenda_item + hit.motion_text)));
    const pool = whatDidWeDecide(meetings, "pool");
    assert.ok(pool.hits.some((hit) => /resurf/i.test(hit.motion_text + hit.agenda_item)));
    const resurface = whatDidWeDecide(meetings, "resurface");
    assert.ok(resurface.hits.some((hit) => /pool/i.test(hit.motion_text + hit.agenda_item)));
  });

  it("filters by date_from and date_to across August and September", () => {
    const afterAugust = whatDidWeDecide(meetings, "roof", { date_from: "2026-09-01" });
    assert.equal(afterAugust.hits.length, 0);

    const throughAugust = whatDidWeDecide(meetings, "roof", { date_to: "2026-08-31" });
    assert.ok(throughAugust.hits.length >= 1);
    assert.ok(throughAugust.hits.every((hit) => hit.meeting_date <= "2026-08-31"));
    assert.ok(throughAugust.hits.every((hit) => hit.meeting_id === "juniper-2026-08-20"));

    const septemberAgenda = whatDidWeDecide(meetings, "agenda", { date_from: "2026-09-01", date_to: "2026-09-30" });
    assert.ok(septemberAgenda.hits.length >= 1);
    assert.ok(septemberAgenda.hits.every((hit) => hit.meeting_id === "juniper-2026-09-17"));
  });

  it("ranks the more recent meeting first when scores tie", () => {
    const agenda = whatDidWeDecide(meetings, "agenda");
    assert.ok(agenda.hits.length >= 2);
    assert.equal(agenda.hits[0].score, agenda.hits[1].score);
    assert.equal(agenda.hits[0].meeting_date, "2026-09-17");
    assert.equal(agenda.hits[1].meeting_date, "2026-08-20");
  });

  it("limits to one meeting_id", () => {
    const onlyAug = whatDidWeDecide(meetings, "agenda", { meeting_id: "juniper-2026-08-20" });
    assert.ok(onlyAug.hits.length >= 1);
    assert.ok(onlyAug.hits.every((hit) => hit.meeting_id === "juniper-2026-08-20"));
  });

  it("speaks two sentences, a natural date, the amount as written, and unconfirmed names", () => {
    const sentences = (text) => String(text).trim().split(/[.!?]+/).filter((part) => part.trim()).length;
    const roof = whatDidWeDecide(meetings, "what did we decide about the roof?");
    assert.match(roof.top_answer, /August 20th/);
    assert.doesNotMatch(roof.top_answer, /\d{4}-\d{2}-\d{2}/);
    assert.match(roof.top_answer, /forty-seven thousand nine hundred/);
    assert.doesNotMatch(roof.top_answer, /\$47,900/);
    assert.match(roof.top_answer, /Priya Raman moved/);
    assert.match(roof.top_answer, /passed, 4 to 1:/);
    assert.doesNotMatch(roof.top_answer, /Day passed/);
    assert.doesNotMatch(roof.top_answer, /No loaded motion mentions/);
    assert.ok(sentences(roof.top_answer) <= 2);

    const study = whatDidWeDecide(meetings, "Who seconded the reserve study?");
    assert.equal(study.hits[0].meeting_id, "juniper-2026-09-17");
    assert.equal(study.hits[0].motion_id, "M3");
    assert.match(study.top_answer, /No loaded motion mentions "study"/);
    assert.match(study.top_answer, /Blue Fern|pool resurfacing/i);
    assert.match(study.top_answer, /Mark Ellison seconded/);
    assert.doesNotMatch(study.top_answer, /reserve study vote/i);
    assert.ok(sentences(study.top_answer) <= 2);

    const pool = whatDidWeDecide(meetings, "pool resurfacing");
    assert.match(pool.top_answer, /eighteen thousand four hundred/);
    assert.ok(sentences(pool.top_answer) <= 2);

    const minutes = whatDidWeDecide(meetings, "August minutes", { meeting_id: "juniper-2026-09-17" });
    assert.match(minutes.top_answer, /September 17th/);
    assert.match(minutes.top_answer, /mover is not confirmed/i);
    assert.match(minutes.top_answer, /seconder is not confirmed/i);
    assert.match(minutes.top_answer, /Ellison/);
    assert.ok(sentences(minutes.top_answer) <= 2);
  });
});

describe("confirmMoverSeconder", () => {
  it("layers a clerk confirmation without mutating the fixture", () => {
    const before = sept.motions.find((motion) => motion.id === "M2").attribution.mover.status;
    const { confirmation, motion } = confirmMoverSeconder(
      meetings,
      {
        meeting_id: "juniper-2026-09-17",
        motion_id: "M2",
        field: "mover",
        value: "Ellison",
        confirmed_by: "Synthetic Clerk",
      },
      {},
    );
    assert.equal(motion.attribution.mover.status, "CONFIRMED BY CLERK");
    assert.equal(motion.attribution.mover.value, "Ellison");
    assert.equal(confirmation.value, "Ellison");
    const again = whatDidWeDecide(
      meetings,
      "August minutes",
      { meeting_id: "juniper-2026-09-17" },
      { [confirmKey(confirmation.meeting_id, confirmation.motion_id, confirmation.field)]: confirmation },
    );
    const hit = again.hits.find((item) => item.motion_id === "M2");
    assert.ok(hit);
    assert.match(hit.mover, /Ellison/);
    assert.equal(sept.motions.find((item) => item.id === "M2").attribution.mover.status, before);
  });

  it("rejects a confirmation longer than 80 characters", () => {
    assert.throws(
      () =>
        confirmMoverSeconder(meetings, {
          meeting_id: "juniper-2026-09-17",
          motion_id: "M2",
          field: "mover",
          value: "E".repeat(81),
        }),
      /80/,
    );
  });
});
