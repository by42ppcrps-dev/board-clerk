/**
 * Deterministic board packet. No model call.
 * Amounts are parsed from motion text only (digits or written English).
 */
import {
  applyConfirms,
  fieldNeedsConfirm,
  naturalDate,
  summarizeMotion,
  topicScore,
} from "./query.js";

const SMALL = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const NUMBER_WORD =
  "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|and";

const WRITTEN = new RegExp(`\\b((?:(?:${NUMBER_WORD})(?:-|\\s+))+)dollars\\b`, "gi");
const NUMERIC = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/g;
const DIGIT_DOLLARS = /\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?\s+dollars\b/gi;

function parseNumberWords(phrase) {
  const words = String(phrase || "")
    .toLowerCase()
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return null;
  let total = 0;
  let current = 0;
  for (const word of words) {
    if (word === "and") continue;
    if (Object.hasOwn(SMALL, word)) current += SMALL[word];
    else if (Object.hasOwn(TENS, word)) current += TENS[word];
    else if (word === "hundred") current = (current || 1) * 100;
    else if (word === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
    } else if (word === "million") {
      total += (current || 1) * 1_000_000;
      current = 0;
    } else return null;
  }
  const value = total + current;
  return value > 0 ? value : null;
}

function pushAmount(found, raw, dollars) {
  if (!Number.isFinite(dollars) || dollars <= 0) return;
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return;
  if (found.some((item) => item.raw.toLowerCase() === text.toLowerCase())) return;
  found.push({ raw: text, dollars });
}

/** Dollar amounts written in one motion's text. Order follows the text. */
export function parseDollarAmounts(text) {
  const source = String(text || "");
  const found = [];
  for (const match of source.matchAll(NUMERIC)) {
    const dollars = Number(match[1].replace(/,/g, "")) + (match[2] ? Number(match[2]) / 100 : 0);
    pushAmount(found, match[0], dollars);
  }
  for (const match of source.matchAll(WRITTEN)) {
    const phrase = match[1].trim();
    const dollars = parseNumberWords(phrase);
    if (dollars == null) continue;
    pushAmount(found, `${phrase} dollars`, dollars);
  }
  for (const match of source.matchAll(DIGIT_DOLLARS)) {
    const dollars = Number(match[1].replace(/,/g, "")) + (match[2] ? Number(match[2]) / 100 : 0);
    pushAmount(found, match[0], dollars);
  }
  return found;
}

export function formatDollars(amount) {
  const n = Number(amount);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const fixed = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  const [whole, frac] = fixed.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${sign}$${withCommas}.${frac}` : `${sign}$${withCommas}`;
}

function quoteList(words) {
  const quoted = words.map((word) => `"${word}"`);
  if (quoted.length === 1) return quoted[0];
  return `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
}

function isTabling(mot) {
  if (mot.outcome === "tabled") return true;
  return mot.outcome === "passed" && /\btable\b/i.test(String(mot.motion_text || ""));
}

function sortMeetings(meetings) {
  return [...(meetings || [])].sort(
    (a, b) => a.meeting_date.localeCompare(b.meeting_date) || a.meeting_id.localeCompare(b.meeting_id),
  );
}

function missedByAll(rows) {
  if (!rows.length) return [];
  return rows[0].missed.filter((word) => rows.every((row) => row.missed.includes(word)));
}

function spokenSummary({ topic, motions, missed, approvedTotal, openCount, tabledCount }) {
  if (!motions.length) {
    if (missed.length) {
      return `No loaded motion mentions ${quoteList(missed)}. There is no board packet for that topic.`;
    }
    return `No loaded motion matches "${topic}". There is no board packet for that topic.`;
  }
  const dates = [];
  for (const motion of motions) {
    const label = naturalDate(motion.meeting_date);
    if (!dates.includes(label)) dates.push(label);
  }
  const dateList = dates.length === 1 ? dates[0] : `${dates.slice(0, -1).join(", ")} and ${dates[dates.length - 1]}`;
  const lead = missed.length
    ? `No loaded motion mentions ${quoteList(missed)}. The closest packet has ${motions.length} motion${motions.length === 1 ? "" : "s"}, on ${dateList}.`
    : `The ${topic} packet has ${motions.length} motion${motions.length === 1 ? "" : "s"}, on ${dateList}.`;
  const money =
    approvedTotal == null
      ? "No approved dollar amount was parsed from the motion text."
      : `Approved amounts parsed from the motion text total ${formatDollars(approvedTotal)}.`;
  const names =
    openCount === 0
      ? "No mover or seconder on this topic still needs confirmation."
      : `${openCount} name${openCount === 1 ? "" : "s"} on this topic still need confirmation.`;
  const held =
    tabledCount === 0
      ? "No tabled item on this topic to revisit."
      : `${tabledCount} tabled item${tabledCount === 1 ? "" : "s"} to revisit.`;
  return `${lead} ${money} ${names} ${held}`;
}

/**
 * Every best-matching motion on a topic, approved dollar total, open names, and tabled items.
 * @param {object[]} meetings
 * @param {string} topic
 * @param {Record<string, object>} [confirms]
 */
export function prepareBoardPacket(meetings, topic, confirms = {}) {
  const q = String(topic || "").trim();
  if (!q) throw new Error("topic is required");
  const scored = [];
  for (const raw of sortMeetings(meetings)) {
    const meeting = applyConfirms(raw, confirms);
    for (const mot of meeting.motions || []) {
      const { score, missed, contentTokens } = topicScore(q, mot);
      if (score > 0) scored.push({ meeting, mot, score, missed, contentTokens });
    }
  }
  const max = scored.reduce((best, row) => Math.max(best, row.score), 0);
  const chosen = scored
    .filter((row) => row.score === max && max > 0)
    .sort(
      (a, b) =>
        a.meeting.meeting_date.localeCompare(b.meeting.meeting_date) ||
        String(a.mot.motion_timestamp || "").localeCompare(String(b.mot.motion_timestamp || "")) ||
        String(a.mot.id).localeCompare(String(b.mot.id)),
    );

  const missed = chosen.length
    ? missedByAll(chosen)
    : (scored[0]?.contentTokens || topicScore(q, { agenda_item: "", motion_text: "" }).contentTokens);

  const motions = [];
  const openConfirmations = [];
  const tabled = [];
  let approvedTotal = null;

  for (const row of chosen) {
    const amounts = parseDollarAmounts(row.mot.motion_text);
    const tabling = isTabling(row.mot);
    const summary = {
      ...summarizeMotion(row.meeting.meeting_id, row.mot),
      meeting_date: row.meeting.meeting_date,
      amounts,
      tabled: tabling,
    };
    motions.push(summary);
    if (row.mot.outcome === "passed" && !tabling && amounts.length) {
      const sum = amounts.reduce((total, amount) => total + amount.dollars, 0);
      approvedTotal = (approvedTotal || 0) + sum;
    }
    for (const field of ["mover", "seconder"]) {
      const attr = row.mot.attribution?.[field];
      if (!fieldNeedsConfirm(attr)) continue;
      openConfirmations.push({
        meeting_id: row.meeting.meeting_id,
        meeting_date: row.meeting.meeting_date,
        motion_id: row.mot.id,
        field,
        status: attr?.status || "NEEDS CONFIRMATION",
        ai_suggestion: attr?.ai_suggestion || row.mot[field] || "",
        motion_text: row.mot.motion_text,
      });
    }
    if (tabling) {
      tabled.push({
        meeting_id: row.meeting.meeting_id,
        meeting_date: row.meeting.meeting_date,
        motion_id: row.mot.id,
        agenda_item: row.mot.agenda_item,
        motion_text: row.mot.motion_text,
        outcome: row.mot.outcome,
        motion_timestamp: row.mot.motion_timestamp,
      });
    }
  }

  const partial = missed.length > 0 && motions.length > 0;
  return {
    topic: q,
    spoken_summary: spokenSummary({
      topic: q,
      motions,
      missed,
      approvedTotal,
      openCount: openConfirmations.length,
      tabledCount: tabled.length,
    }),
    partial,
    missed_terms: missed,
    motion_count: motions.length,
    approved_total_dollars: approvedTotal,
    approved_total_display: approvedTotal == null ? null : formatDollars(approvedTotal),
    motions,
    open_confirmations: openConfirmations,
    tabled,
  };
}
