/**
 * Spoken-name attribution. Mover/seconder is SPOKEN only when that person's
 * surname, first name, or full name appears in what someone said (the transcript
 * text after the speaker label) within -45s..+30s of the motion timestamp.
 * A speaker label alone never counts: labels come from diarization or a
 * transcriber, not from words said in the meeting.
 * An alias only counts when it belongs to exactly one roster member. If a name
 * matches more than one roster member (two people named Dana), the field stays
 * NEEDS CONFIRMATION with the candidates listed, sorted by name, so roster order
 * can never pick the person. Otherwise NEEDS CONFIRMATION (AI suggestion kept).
 * Aliases come from the roster (first, last, full). Port of minutes-test namerule.py.
 */
import { tsec } from "./crosscheck.js";

const LINE = /^\[(\d{2}:\d{2}:\d{2})\]\s*(.*)$/;

export function parseTranscriptLines(transcript) {
  const lines = [];
  for (const raw of String(transcript ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(LINE);
    if (!m) continue;
    const t = tsec(m[1]);
    if (t == null) continue;
    lines.push({ timestamp: m[1], t, text: m[2], raw: line });
  }
  return lines;
}

export function rosterPeople(roster) {
  const people = [];
  for (const entry of roster || []) {
    const name = String(entry?.name || entry || "").trim();
    if (!name) continue;
    const parts = name.split(/\s+/);
    const first = parts[0];
    const last = parts[parts.length - 1];
    const aliases = new Set(
      [name, first, last]
        .map((s) => s.toLowerCase())
        .filter((s) => s && s.length >= 2),
    );
    people.push({ name, first, last, role: entry?.role || "", aliases });
  }
  return people;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordIn(text, alias) {
  if (!alias) return false;
  return new RegExp(`\\b${escapeRe(alias)}\\b`, "i").test(text);
}

/** Split "Speaker Name: words" into the label and what was said. */
export function splitSpeakerLabel(text) {
  const value = String(text ?? "");
  const m = value.match(/^([^:]{1,80}):\s*(.*)$/);
  if (!m) return { speaker: "", utterance: value };
  return { speaker: m[1].trim(), utterance: m[2] };
}

/** alias -> number of roster members who share it. */
function aliasCounts(people) {
  const counts = new Map();
  for (const person of people) {
    for (const alias of person.aliases) counts.set(alias, (counts.get(alias) || 0) + 1);
  }
  return counts;
}

function normalizeLines(transcriptLines) {
  if (typeof transcriptLines === "string") return parseTranscriptLines(transcriptLines);
  if (!Array.isArray(transcriptLines)) return [];
  const out = [];
  for (const line of transcriptLines) {
    if (line == null) continue;
    if (typeof line === "string") {
      const parsed = parseTranscriptLines(line);
      if (parsed[0]) out.push(parsed[0]);
      continue;
    }
    if (line.t != null && line.text != null) {
      out.push({
        timestamp: line.timestamp || "",
        t: line.t,
        text: line.text,
        raw: line.raw || line.text,
      });
      continue;
    }
    if (line.timestamp && line.text != null) {
      const t = tsec(line.timestamp);
      if (t == null) continue;
      out.push({ timestamp: line.timestamp, t, text: line.text, raw: line.raw || line.text });
    }
  }
  return out;
}

/**
 * Roster members a raw name could refer to. Exact full-name matches win.
 * Returns every candidate so callers can refuse to choose between them.
 */
export function rosterCandidates(raw, people) {
  const value = String(raw || "").trim();
  if (!value || value.toLowerCase() === "unclear") return [];
  const lower = value.toLowerCase().replace(/\s+/g, " ");
  const exact = people.filter((p) => p.name.toLowerCase() === lower);
  if (exact.length) return exact;
  const parts = lower.split(" ").filter(Boolean);
  const last = parts[parts.length - 1] || "";
  return people.filter(
    (p) =>
      p.first.toLowerCase() === lower ||
      p.last.toLowerCase() === lower ||
      p.last.toLowerCase() === last ||
      p.aliases.has(lower) ||
      p.aliases.has(last),
  );
}

function sortedNames(people) {
  return [...new Set(people.map((p) => p.name))].sort((a, b) => a.localeCompare(b));
}

/**
 * @returns {{ mover: object, seconder: object }}
 */
export function attribute(motion, transcriptLines, roster) {
  const lines = normalizeLines(transcriptLines);
  const people = rosterPeople(roster);
  const shared = aliasCounts(people);
  const t = tsec(motion?.motion_timestamp ?? "");
  const windowLines =
    t == null ? [] : lines.filter((line) => line.t >= t - 45 && line.t <= t + 30);
  const spokenLines = windowLines.map((line) => ({ ...line, said: splitSpeakerLabel(line.text).utterance }));
  const win = spokenLines.map((line) => line.said).join(" ");
  const notSpoken = "name not spoken within -45s..+30s of the motion timestamp (a speaker label alone does not count)";

  function fieldAttr(field) {
    const raw = String(motion?.[field] ?? "").trim();
    const suggestion = raw || "UNCLEAR";
    if (!raw || raw.toLowerCase() === "unclear") {
      return {
        status: "NEEDS CONFIRMATION",
        reason: notSpoken,
        ai_suggestion: suggestion,
      };
    }
    const candidates = rosterCandidates(raw, people);
    if (candidates.length > 1) {
      const names = sortedNames(candidates);
      return {
        status: "NEEDS CONFIRMATION",
        reason: `"${raw}" matches more than one roster member (${names.join(", ")})`,
        ai_suggestion: raw,
        candidates: names,
      };
    }
    const person = candidates[0] || null;
    const aliases = person
      ? [...person.aliases].filter((alias) => (shared.get(alias) || 0) === 1)
      : [raw.toLowerCase().split(/\s+/).pop()].filter((alias) => alias && !shared.has(alias));
    const hitAlias = aliases.find((alias) => wordIn(win, alias));
    if (hitAlias) {
      const evidenceLine = spokenLines.find((line) => wordIn(line.said, hitAlias)) || null;
      const spoken = {
        status: "SPOKEN",
        value: person ? person.name : raw,
      };
      if (evidenceLine) {
        spoken.evidence = { at: evidenceLine.timestamp, quote: String(evidenceLine.text).slice(0, 180) };
      }
      return spoken;
    }
    return {
      status: "NEEDS CONFIRMATION",
      reason: notSpoken,
      ai_suggestion: raw,
    };
  }

  return { mover: fieldAttr("mover"), seconder: fieldAttr("seconder") };
}
