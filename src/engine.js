/**
 * Thin compatibility wrapper. Query functions keep the original signatures and
 * run on the seeded fixtures. New code should pass a meetings array into src/engine/query.js.
 */
import aug from "./fixtures/juniper-2026-08-20.js";
import sept from "./fixtures/juniper-2026-09-17.js";
import { draftMinutes as draftMinutesOn } from "./engine/minutes.js";
import * as query from "./engine/query.js";

export const FIXTURES = [aug, sept];

export function listMeetings() {
  return query.listMeetings(FIXTURES, {});
}

export function listMotions(meetingId, confirms = {}) {
  return query.listMotions(FIXTURES, meetingId, confirms);
}

export function getMotion(meetingId, motionId, confirms = {}) {
  return query.getMotion(FIXTURES, meetingId, motionId, confirms);
}

export function getDecision(meetingId, motionId, confirms = {}) {
  return query.getDecision(FIXTURES, meetingId, motionId, confirms);
}

export function listPendingConfirmations(meetingId, confirms = {}) {
  return query.listPendingConfirmations(FIXTURES, meetingId, confirms);
}

export function confirmMoverSeconder(args, confirms = {}) {
  return query.confirmMoverSeconder(FIXTURES, args, confirms);
}

export function whatDidWeDecide(queryText, opts = {}, confirms = {}) {
  return query.whatDidWeDecide(FIXTURES, queryText, opts || {}, confirms);
}

export function draftMinutes(meetingId, confirms = {}) {
  return draftMinutesOn(FIXTURES, meetingId, confirms);
}

export function confirmKey(meetingId, motionId, field) {
  return query.confirmKey(meetingId, motionId, field);
}

export { validateMotions } from "./engine/validate.js";
export { crosscheck, norm, tsec } from "./engine/crosscheck.js";
export { attribute } from "./engine/namerule.js";
export { extractMeeting } from "./engine/extract.js";
