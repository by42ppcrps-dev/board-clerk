/**
 * Query / confirm over a meetings array (fixtures or ingested). No module-global meeting list.
 * Search drops stopwords (including "we") before scoring, stems roof/roofing and bid/bids,
 * and expands roof↔reroof and pool↔resurface. Ties break to the more recent meeting.
 */

const STOP = new Set([
  "a", "an", "the", "and", "or", "but", "did", "do", "we", "our", "about", "what",
  "for", "to", "of", "in", "on", "at", "by", "is", "was", "were", "be", "with",
  "from", "that", "this", "it", "as", "if", "so", "not",
]);

/** Question-frame words. They still rank hits, but they do not count as topic coverage. */
const QUESTION = new Set([
  "what", "who", "whom", "whose", "when", "where", "why", "how", "which",
  "decide", "decided", "decision", "second", "seconds", "seconded", "seconder",
  "move", "moved", "mover", "still", "need", "needs", "confirm", "confirmed", "confirming",
]);

/** Groups share a stem or a synonym. Matching any member counts as a hit for the query token. */
const SYNONYM_GROUPS = [
  ["roof", "reroof", "roofing"],
  ["pool", "resurface", "resurfacing"],
  ["bid", "bids"],
];

export function confirmKey(meetingId, motionId, field) {
  return `${meetingId}::${motionId}::${field}`;
}

export function stemToken(token) {
  const t = String(token || "").toLowerCase();
  if (t.length > 5 && t.endsWith("ing")) {
    const stem = t.slice(0, -3);
    if (stem.length >= 3) return stem;
  }
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) {
    const stem = t.slice(0, -1);
    if (stem.length >= 3) return stem;
  }
  return t;
}

export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[?!.,;:'"]+/g, " ")
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t && !STOP.has(t));
}

function expandToken(token) {
  const raw = token.toLowerCase();
  const stem = stemToken(raw);
  const set = new Set([raw, stem]);
  for (const group of SYNONYM_GROUPS) {
    const forms = new Set(group.flatMap((g) => [g, stemToken(g)]));
    if (forms.has(raw) || forms.has(stem)) {
      for (const g of forms) set.add(g);
    }
  }
  return set;
}

function sortMeetings(meetings) {
  return [...(meetings || [])].sort(
    (a, b) => a.meeting_date.localeCompare(b.meeting_date) || a.meeting_id.localeCompare(b.meeting_id),
  );
}

export function findMeeting(meetings, meetingId) {
  const list = sortMeetings(meetings);
  if (!meetingId) {
    if (!list.length) throw new Error("No meetings loaded");
    return list[list.length - 1];
  }
  const found = list.find((m) => m.meeting_id === meetingId);
  if (!found) {
    throw new Error(
      `Unknown meeting_id: ${meetingId}. Known: ${list.map((m) => m.meeting_id).join(", ") || "(none)"}`,
    );
  }
  return found;
}

export function fieldNeedsConfirm(attr) {
  if (!attr) return true;
  return attr.status !== "SPOKEN" && attr.status !== "CONFIRMED BY CLERK";
}

export function applyConfirms(meeting, confirms) {
  const motions = (meeting.motions || []).map((mot) => {
    const attribution = { ...(mot.attribution || {}) };
    let mover = mot.mover;
    let seconder = mot.seconder;
    for (const field of ["mover", "seconder"]) {
      const key = confirmKey(meeting.meeting_id, mot.id, field);
      const c = confirms[key];
      if (c) {
        attribution[field] = {
          status: "CONFIRMED BY CLERK",
          value: c.value,
          by: c.confirmed_by,
          at: c.confirmed_at,
        };
        if (field === "mover") mover = c.value;
        else seconder = c.value;
      }
    }
    return { ...mot, mover, seconder, attribution };
  });
  const resolved = [];
  for (const mot of meeting.motions || []) {
    for (const field of ["mover", "seconder"]) {
      if (confirms[confirmKey(meeting.meeting_id, mot.id, field)]) resolved.push(`Confirm ${field} for ${mot.id} (`);
    }
  }
  const open_questions = Array.isArray(meeting.open_questions)
    ? meeting.open_questions.filter((q) => !resolved.some((prefix) => String(q).startsWith(prefix)))
    : meeting.open_questions;
  return { ...meeting, motions, open_questions };
}

function countPending(meeting) {
  let n = 0;
  for (const mot of meeting.motions || []) {
    for (const field of ["mover", "seconder"]) {
      if (fieldNeedsConfirm(mot.attribution?.[field])) n++;
    }
  }
  return n;
}

export function displayName(m, field) {
  const attr = m.attribution?.[field];
  if (attr?.status === "CONFIRMED BY CLERK" || attr?.status === "SPOKEN") {
    return attr.value || m[field];
  }
  if (attr?.status === "NEEDS CONFIRMATION") {
    return `(needs confirm; suggested ${attr.ai_suggestion || m[field]})`;
  }
  return m[field];
}

export function summarizeMotion(meetingId, m) {
  return {
    meeting_id: meetingId,
    motion_id: m.id,
    agenda_item: m.agenda_item,
    motion_text: m.motion_text,
    mover: displayName(m, "mover"),
    seconder: displayName(m, "seconder"),
    outcome: m.outcome,
    tally: `${(m.ayes || []).length}-${(m.nays || []).length}`,
    vote_method: m.vote_method,
    motion_timestamp: m.motion_timestamp,
    vote_timestamp: m.vote_timestamp,
    confidence: m.confidence,
    flags: m.flags || [],
    attribution: {
      mover: m.attribution?.mover || null,
      seconder: m.attribution?.seconder || null,
    },
  };
}

export function listMeetings(meetings, confirms = {}) {
  return sortMeetings(meetings).map((raw) => {
    const meeting = applyConfirms(raw, confirms);
    return {
      meeting_id: meeting.meeting_id,
      org: meeting.org,
      meeting_date: meeting.meeting_date,
      meeting_type: meeting.meeting_type,
      title: meeting.title,
      motion_count: meeting.motions.length,
      pending_confirmations: countPending(meeting),
      synthetic: true,
    };
  });
}

export function listMotions(meetings, meetingId, confirms = {}) {
  const raw = findMeeting(meetings, meetingId);
  const meeting = applyConfirms(raw, confirms);
  return {
    meeting_id: meeting.meeting_id,
    meeting_date: meeting.meeting_date,
    org: meeting.org,
    motions: meeting.motions.map((m) => summarizeMotion(meeting.meeting_id, m)),
  };
}

export function getMotion(meetings, meetingId, motionId, confirms = {}) {
  const raw = findMeeting(meetings, meetingId);
  const meeting = applyConfirms(raw, confirms);
  const mot = meeting.motions.find(
    (x) => x.id === motionId || String(x.id).toLowerCase() === String(motionId).toLowerCase(),
  );
  if (!mot) {
    throw new Error(
      `Motion ${motionId} not found in ${meeting.meeting_id}. Ids: ${meeting.motions.map((x) => x.id).join(", ")}`,
    );
  }
  return {
    ...summarizeMotion(meeting.meeting_id, mot),
    ayes: mot.ayes,
    nays: mot.nays,
    abstain: mot.abstain,
    absent: mot.absent,
    evidence_quote: mot.evidence_quote,
    uncertain_fields: mot.uncertain_fields,
  };
}

export function getDecision(meetings, meetingId, motionId, confirms = {}) {
  const mot = getMotion(meetings, meetingId, motionId, confirms);
  const meeting = findMeeting(meetings, mot.meeting_id);
  return {
    decision: `${mot.motion_text}: ${mot.outcome} (${mot.tally})`,
    meeting_id: mot.meeting_id,
    meeting_date: meeting.meeting_date,
    motion_id: mot.motion_id,
    agenda_item: mot.agenda_item,
    mover: mot.mover,
    seconder: mot.seconder,
    outcome: mot.outcome,
    tally: mot.tally,
    motion_timestamp: mot.motion_timestamp,
    vote_timestamp: mot.vote_timestamp,
    evidence_quote: mot.evidence_quote,
    attribution: mot.attribution,
  };
}

function rosterChoices(meeting, fallbackRoster) {
  const source = meeting.roster?.length ? meeting.roster : fallbackRoster || [];
  return source
    .map((person) => (typeof person === "string" ? { name: person } : person))
    .filter((person) => person && String(person.name || "").trim())
    .map((person) => (person.role ? { name: person.name, role: person.role } : { name: person.name }));
}

// Each pending item carries the roster of its own meeting, so a confirmation
// picker offers exactly the names confirm_mover_seconder will accept for it.
export function listPendingConfirmations(meetings, meetingId, confirms = {}, fallbackRoster = []) {
  const list = meetingId ? [findMeeting(meetings, meetingId)] : sortMeetings(meetings);
  const pending = [];
  for (const raw of list) {
    const meeting = applyConfirms(raw, confirms);
    for (const mot of meeting.motions) {
      for (const field of ["mover", "seconder"]) {
        const attr = mot.attribution?.[field];
        if (!fieldNeedsConfirm(attr)) continue;
        pending.push({
          meeting_id: meeting.meeting_id,
          meeting_date: meeting.meeting_date,
          motion_id: mot.id,
          field,
          agenda_item: mot.agenda_item,
          motion_text: mot.motion_text,
          listen_at: mot.motion_timestamp,
          vote_at: mot.vote_timestamp,
          status: attr?.status || "NEEDS CONFIRMATION",
          reason: attr?.reason || "needs human confirm",
          ai_suggestion: attr?.ai_suggestion || mot[field],
          roster: rosterChoices(meeting, fallbackRoster),
        });
      }
    }
  }
  return { pending, count: pending.length };
}

export function confirmMoverSeconder(
  meetings,
  { meeting_id, motion_id, field, value, confirmed_by },
  confirms = {},
) {
  if (!["mover", "seconder"].includes(field)) throw new Error('field must be "mover" or "seconder"');
  if (!value || !String(value).trim()) throw new Error("value is required");
  const trimmed = String(value).trim();
  if (trimmed.length > 80) throw new Error("confirmation value exceeds 80 characters");
  const meeting = findMeeting(meetings, meeting_id);
  const mot = meeting.motions.find((x) => x.id === motion_id);
  if (!mot) throw new Error(`Motion ${motion_id} not found`);
  const attr = mot.attribution?.[field];
  const rec = {
    meeting_id,
    motion_id,
    field,
    value: trimmed,
    confirmed_by: confirmed_by || "Board Clerk (demo)",
    confirmed_at: new Date().toISOString(),
    ai_suggestion: attr?.ai_suggestion || mot[field],
    status_before: attr?.status || "unknown",
  };
  const next = { ...confirms, [confirmKey(meeting_id, motion_id, field)]: rec };
  return { confirmation: rec, motion: getMotion(meetings, meeting_id, motion_id, next) };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function ordinal(day) {
  const n = Number(day);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function naturalDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return String(iso || "an unknown date");
  const month = MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  if (!month || day < 1 || day > 31) return String(iso);
  return `${month} ${ordinal(day)}`;
}

function guessClause(mot, field) {
  const guess = mot.attribution?.[field]?.ai_suggestion || mot[field];
  if (!guess || String(guess).trim().toUpperCase() === "UNCLEAR") return "";
  return ` (the notes guessed ${guess})`;
}

function motionClause(mot) {
  const raw = String(mot.motion_text || "take action")
    .replace(/[.?!]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const text = raw ? raw.charAt(0).toLowerCase() + raw.slice(1) : "take action";
  return text;
}

function outcomeVerb(mot) {
  if (mot.outcome === "passed") return "passed";
  if (mot.outcome === "failed") return "failed";
  if (mot.outcome === "tabled") return "was tabled";
  if (mot.outcome === "withdrawn") return "was withdrawn";
  return "was left unclear";
}

/** No trailing period. Amounts stay as written in the motion. */
function peopleClause(mot) {
  const moverUnconfirmed = fieldNeedsConfirm(mot.attribution?.mover);
  const seconderUnconfirmed = fieldNeedsConfirm(mot.attribution?.seconder);
  const moverName = mot.attribution?.mover?.value || mot.mover;
  const seconderName = mot.attribution?.seconder?.value || mot.seconder;
  if (!moverUnconfirmed && !seconderUnconfirmed) {
    return `${moverName} moved and ${seconderName} seconded`;
  }
  if (moverUnconfirmed && seconderUnconfirmed) {
    return `the mover is not confirmed${guessClause(mot, "mover")}, and the seconder is not confirmed${guessClause(mot, "seconder")}`;
  }
  if (moverUnconfirmed) {
    return `the mover is not confirmed${guessClause(mot, "mover")}, and ${seconderName} seconded`;
  }
  return `${moverName} moved, and the seconder is not confirmed${guessClause(mot, "seconder")}`;
}

/**
 * Two sentences a voice assistant can read.
 * The outcome verb is not glued onto the last clause of the motion text.
 * If a topic word is missing, sentence 1 says so instead of answering as if the question matched.
 */
function buildSpokenAnswer(meeting, mot, missed = []) {
  const text = motionClause(mot);
  const ayes = (mot.ayes || []).length;
  const nays = (mot.nays || []).length;
  const verb = outcomeVerb(mot);
  const people = peopleClause(mot);
  const date = naturalDate(meeting.meeting_date);
  if (missed.length) {
    const quoted = missed.map((word) => `"${word}"`);
    const list = quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
    return `No loaded motion mentions ${list}. The closest match ${verb}, ${ayes} to ${nays}, on ${date}: ${text}; ${people}.`;
  }
  return `On ${date}, the motion ${verb}, ${ayes} to ${nays}: ${text}. ${people.charAt(0).toUpperCase()}${people.slice(1)}.`;
}

function inDateRange(meeting, dateFrom, dateTo) {
  if (dateFrom && meeting.meeting_date < dateFrom) return false;
  if (dateTo && meeting.meeting_date > dateTo) return false;
  return true;
}

/** How many query tokens a motion covers, and which topic words it misses. */
export function topicScore(query, mot) {
  const tokens = tokenize(query);
  const contentTokens = tokens.filter((token) => !QUESTION.has(token) && !QUESTION.has(stemToken(token)));
  const hayTokens = tokenize(
    [mot.agenda_item, mot.motion_text, mot.outcome, mot.evidence_quote, ...(mot.flags || [])].join(" "),
  ).map((rawToken) => ({ raw: rawToken, stem: stemToken(rawToken) }));
  const covers = (token) => {
    const exp = expandToken(token);
    return hayTokens.some((hit) => exp.has(hit.raw) || exp.has(hit.stem));
  };
  let score = 0;
  for (const token of tokens) {
    if (covers(token)) score++;
  }
  return {
    score,
    missed: contentTokens.filter((token) => !covers(token)),
    tokens,
    contentTokens,
  };
}

export function whatDidWeDecide(meetings, query, { date_from, date_to, meeting_id } = {}, confirms = {}) {
  const q = (query || "").trim();
  if (!q) throw new Error("query is required");
  let list = meeting_id ? [findMeeting(meetings, meeting_id)] : sortMeetings(meetings);
  list = list.filter((m) => inDateRange(m, date_from, date_to));

  const tokens = tokenize(q);
  const hits = [];
  if (tokens.length) {
    for (const raw of list) {
      const meeting = applyConfirms(raw, confirms);
      for (const mot of meeting.motions) {
        const scored = topicScore(q, mot);
        if (scored.score > 0) {
          hits.push({
            score: scored.score,
            meeting_id: meeting.meeting_id,
            meeting_date: meeting.meeting_date,
            motion_id: mot.id,
            agenda_item: mot.agenda_item,
            motion_text: mot.motion_text,
            outcome: mot.outcome,
            mover: displayName(mot, "mover"),
            seconder: displayName(mot, "seconder"),
            tally: `${(mot.ayes || []).length}-${(mot.nays || []).length}`,
            motion_timestamp: mot.motion_timestamp,
            evidence_quote: mot.evidence_quote,
            missed: scored.missed,
            spoken_answer: buildSpokenAnswer(meeting, mot, scored.missed),
          });
        }
      }
    }
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      b.meeting_date.localeCompare(a.meeting_date) ||
      String(b.motion_timestamp || "").localeCompare(String(a.motion_timestamp || "")),
  );
  return {
    query,
    hits,
    top_answer: hits[0]
      ? hits[0].spoken_answer
      : `No board decision matched "${query}" in the loaded synthetic meetings.`,
  };
}
