/**
 * Draft minutes markdown. Board approval is still required; this does not send anything.
 */
import { applyConfirms, findMeeting } from "./query.js";

export function renderMinutes(meeting) {
  const lines = [];
  lines.push(`# ${meeting.title}`);
  lines.push(`**Date:** ${meeting.meeting_date}`);
  lines.push(`**Org:** ${meeting.org}`);
  lines.push(`**Call to order:** ${meeting.call_to_order} · **Adjourned:** ${meeting.adjourned}`);
  lines.push(`**Present:** ${(meeting.present || []).join(", ")}`);
  if (meeting.absent?.length) lines.push(`**Absent:** ${meeting.absent.join(", ")}`);
  lines.push("");
  lines.push("> Draft for board approval. Synthetic demo data. Mover/seconder require spoken name or clerk confirm.");
  lines.push("");
  for (const item of meeting.items || []) {
    lines.push(`## ${item.agenda_item}`);
    lines.push(`*@${item.timestamp}* — ${item.summary}`);
    lines.push("");
  }
  lines.push("## Motions");
  for (const mot of meeting.motions || []) {
    lines.push(`### ${mot.id} — ${mot.agenda_item}`);
    lines.push(`- **Motion:** ${mot.motion_text}`);
    lines.push(`- **Mover:** ${displayName(mot, "mover")}`);
    lines.push(`- **Seconder:** ${displayName(mot, "seconder")}`);
    lines.push(
      `- **Outcome:** ${mot.outcome} (${(mot.ayes || []).length}-${(mot.nays || []).length}) @${mot.vote_timestamp}`,
    );
    if (mot.flags?.length) lines.push(`- **Flags:** ${mot.flags.join("; ")}`);
    lines.push(`- **Evidence:** ${mot.evidence_quote}`);
    lines.push("");
  }
  if (meeting.open_questions?.length) {
    lines.push("## Open questions");
    for (const q of meeting.open_questions) lines.push(`- ${q}`);
  }
  return lines.join("\n");
}

function displayName(m, field) {
  const attr = m.attribution?.[field];
  if (attr?.status === "CONFIRMED BY CLERK" || attr?.status === "SPOKEN") {
    return attr.value || m[field];
  }
  if (attr?.status === "NEEDS CONFIRMATION") {
    return `(needs confirm; AI guessed ${attr.ai_suggestion || m[field]})`;
  }
  return m[field];
}

export function draftMinutes(meetings, meetingId, confirms = {}) {
  const raw = findMeeting(meetings, meetingId);
  const meeting = applyConfirms(raw, confirms);
  return {
    meeting_id: meeting.meeting_id,
    meeting_date: meeting.meeting_date,
    markdown: renderMinutes(meeting),
  };
}
