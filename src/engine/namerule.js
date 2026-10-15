/**
 * Spoken-name attribution. Mover/seconder is SPOKEN only when that person's
 * surname, first name, or alias appears in transcript lines within -45s..+30s
 * of the motion timestamp. Otherwise NEEDS CONFIRMATION (AI suggestion kept).
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

function identify(raw, people) {
  const value = String(raw || "").trim();
  if (!value || value.toLowerCase() === "unclear") return null;
  const lower = value.toLowerCase();
  const parts = lower.split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  return (
    people.find(
      (p) =>
        p.name.toLowerCase() === lower ||
        p.first.toLowerCase() === lower ||
        p.last.toLowerCase() === lower ||
        p.last.toLowerCase() === last ||
        p.aliases.has(lower) ||
        p.aliases.has(last),
    ) || null
  );
}

/**
 * @returns {{ mover: object, seconder: object }}
 */
export function attribute(motion, transcriptLines, roster) {
  const lines = normalizeLines(transcriptLines);
  const people = rosterPeople(roster);
  const t = tsec(motion?.motion_timestamp ?? "");
  const windowLines =
    t == null ? [] : lines.filter((line) => line.t >= t - 45 && line.t <= t + 30);
  const win = windowLines.map((line) => line.text).join(" ");

  function fieldAttr(field) {
    const raw = String(motion?.[field] ?? "").trim();
    const suggestion = raw || "UNCLEAR";
    if (!raw || raw.toLowerCase() === "unclear") {
      return {
        status: "NEEDS CONFIRMATION",
        reason: "name not spoken within -45s..+30s of the motion timestamp",
        ai_suggestion: suggestion,
      };
    }
    const person = identify(raw, people);
    const aliases = person ? [...person.aliases] : [raw.toLowerCase().split(/\s+/).pop()].filter(Boolean);
    const hitAlias = aliases.find((alias) => wordIn(win, alias));
    if (hitAlias) {
      const evidenceLine =
        windowLines.find((line) => wordIn(line.text, hitAlias)) || windowLines[0] || null;
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
      reason: "name not spoken within -45s..+30s of the motion timestamp",
      ai_suggestion: raw,
    };
  }

  return { mover: fieldAttr("mover"), seconder: fieldAttr("seconder") };
}
