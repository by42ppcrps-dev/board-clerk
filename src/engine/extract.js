/**
 * Deterministic $0 extractor for clean transcripts in the form
 * `[HH:MM:SS] Speaker Name: text`. Ignores lines starting with #.
 * Baseline for clean synthetic transcripts only. This file does not call a model.
 */
import { tsec } from "./crosscheck.js";
import { attribute, parseTranscriptLines, rosterPeople } from "./namerule.js";
import { validateMotions } from "./validate.js";

const MOTION_START = /\b(i move|i'll move|i will move|move that|motion to)\b/i;

function isMotionStart(text) {
  return MOTION_START.test(String(text || ""));
}

function isSecondLine(text) {
  const t = String(text || "").trim();
  if (/^(i'll|i will|i)\s+second\b/i.test(t)) return true;
  if (/^second(ed)?\b/i.test(t)) return true;
  return false;
}

function classifyLine(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(is withdrawn|motion is withdrawn|withdraw the motion|motion withdrawn)\b/.test(t)) return "withdrawn";
  if (/\b(is tabled|motion is tabled|motion tabled|remains tabled)\b/.test(t)) return "tabled";
  if (
    /\b(motion fails|the motion fails|motion failed|is defeated|does not pass|did not pass|motion does not carry)\b/.test(
      t,
    )
  ) {
    return "failed";
  }
  if (
    /\b(motion carries|the motion carries|motion passes|the motion passes|is approved|motion is approved|is passed|we are adjourned|we're adjourned|meeting is adjourned|stands adjourned)\b/.test(
      t,
    )
  ) {
    return "passed";
  }
  return null;
}

function motionTextFrom(utterance) {
  const patterns = [
    /\bi move that\s+(.+)/i,
    /\bi'll move that\s+(.+)/i,
    /\bi will move that\s+(.+)/i,
    /\bi move to\s+(.+)/i,
    /\bi'll move to\s+(.+)/i,
    /\bmotion to\s+(.+)/i,
    /\bmove that\s+(.+)/i,
    /\bi move\s+(.+)/i,
  ];
  let text = String(utterance || "").trim();
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      text = m[1];
      break;
    }
  }
  text = text.replace(/^(that\s+)?(we\s+)?/i, "").replace(/\s+/g, " ").trim();
  text = text.replace(/[.]+$/, "").trim();
  if (!text) return "Motion text unclear.";
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

function matchPerson(speaker, people) {
  if (!speaker) return null;
  const s = String(speaker).trim().toLowerCase().replace(/\s+/g, " ");
  for (const p of people) {
    if (s === p.name.toLowerCase() || s === p.first.toLowerCase() || s === p.last.toLowerCase()) return p;
  }
  for (const p of people) {
    if (s.endsWith(" " + p.name.toLowerCase()) || s.endsWith(" " + p.last.toLowerCase())) return p;
  }
  return null;
}

function grabName(text, label) {
  const re = new RegExp(`\\b${label}\\s+([A-Za-z][A-Za-z.'-]*)(?:\\s+([A-Za-z][A-Za-z.'-]*))?`, "i");
  const m = String(text || "").match(re);
  if (!m) return null;
  return m[2] ? `${m[1]} ${m[2]}` : m[1];
}

function splitSpeaker(text) {
  const m = String(text || "").match(/^([^:]+):\s*(.*)$/);
  if (!m) return { speaker: "", utterance: String(text || "") };
  return { speaker: m[1].trim(), utterance: m[2] };
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanLabel(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:—–-]+|[\s,;:—–.-]+$/g, "")
    .trim()
    .slice(0, 200);
}

/** Org and title from args are preferred. # lines fill them in when the caller omits them. */
export function transcriptMeta(transcript) {
  let org = "";
  let title = "";
  for (const raw of String(transcript ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("#")) continue;
    const body = line.replace(/^#+\s*/, "").trim();
    if (!body) continue;
    const labeledOrg = body.match(/^(?:org|organization)\s*:\s*(.+)$/i);
    const labeledTitle = body.match(/^title\s*:\s*(.+)$/i);
    if (labeledOrg) {
      org = cleanLabel(labeledOrg[1].replace(/\s*\([^)]*\)\s*/g, " "));
      continue;
    }
    if (labeledTitle) {
      title = cleanLabel(labeledTitle[1]);
      continue;
    }
    if (/^extractor\b/i.test(body) || /\bnot a motion\b/i.test(body)) continue;
    if (/^\[[0-9]/.test(body)) continue;
    if (!/^fictional\b/i.test(body) && !/[—–]/.test(body) && !/\bmeeting\b/i.test(body)) continue;
    const text = body.replace(/^fictional\b[\s—–:-]*/i, "").trim();
    const pieces = text
      .split(/\.\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (!org && pieces[0]) org = cleanLabel(pieces[0].replace(/\s*\([^)]*\)\s*/g, " "));
    if (!title && pieces[1]) title = cleanLabel(pieces[1].replace(/\b\d{4}-\d{2}-\d{2}\b/g, ""));
  }
  return { org, title };
}

function cleanCue(text) {
  let cue = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.?!]+$/, "")
    .trim();
  if (cue.length > 140) cue = cue.slice(0, 140).replace(/\s+\S*$/, "").trim();
  if (cue.length < 3) return null;
  return cue.charAt(0).toUpperCase() + cue.slice(1);
}

/** Chair cues that name the agenda item. Returns null when the line is not one. */
export function matchChairCue(utterance) {
  const text = String(utterance || "").trim();
  const patterns = [
    /\bnew business\s*:\s*([^.!\n]+)/i,
    /\bold business\s*:\s*([^.!\n]+)/i,
    /\bmoving on to\s+([^.!\n]+)/i,
    /\bnext item(?:\s+is|\s*:)?\s+([^.!\n]+)/i,
    /\b(?:the\s+)?(?:first|second|third|fourth|fifth|next|final)\s+item\s+is\s+([^.!\n]+)/i,
    /\bitem\s+\d+\s*(?::|-|—|is)\s+([^.!\n]+)/i,
    /\bnext,\s+([^.!\n]+)/i,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (!match) continue;
    const cleaned = cleanCue(match[match.length - 1]);
    if (cleaned) return cleaned;
  }
  return null;
}

function agendaFor(lines, motionLineIndex, motionText, index) {
  for (let k = motionLineIndex - 1; k >= 0; k--) {
    const { utterance } = splitSpeaker(lines[k].text);
    if (isMotionStart(utterance)) break;
    const cue = matchChairCue(utterance);
    if (cue) return cue;
  }
  return agendaLabel(motionText, index);
}

function isVotingMember(person) {
  const role = String(person.role || "");
  if (!role.trim()) return true;
  if (/\b(president|vice|director|secretary|treasurer|trustee|chair|member)\b/i.test(role)) return true;
  if (/\b(staff|manager|counsel|attorney|guest|recording)\b/i.test(role)) return false;
  return true;
}

function peopleNamedIn(clause, people) {
  const strong = [];
  const firstOnly = [];
  for (const person of people) {
    if (new RegExp(`\\b${escapeRe(person.name)}\\b`, "i").test(clause)) {
      strong.push(person);
      continue;
    }
    if (person.last.length >= 2 && new RegExp(`\\b${escapeRe(person.last)}\\b`, "i").test(clause)) {
      strong.push(person);
      continue;
    }
    if (person.first.length >= 3 && new RegExp(`\\b${escapeRe(person.first)}\\b`, "i").test(clause)) {
      firstOnly.push(person);
    }
  }
  if (strong.length) return strong;
  if (firstOnly.length === 1) return firstOnly;
  return [];
}

function agendaLabel(text, index) {
  const t = text.toLowerCase();
  if (/\badjourn\b/.test(t)) return "Adjournment";
  if (/\bagenda\b/.test(t)) return "Approval of agenda";
  if (/\bminutes\b/.test(t)) return "Approval of minutes";
  if (/\btable\b/.test(t)) return "Motion to table";
  if (/\broof\b/.test(t)) return "Roof contract follow-up";
  if (/\bassessment\b/.test(t)) return "Special assessment";
  return `Business item ${index + 1}`;
}

function collectAttendance(lines, people) {
  const present = new Set();
  const absent = new Set();
  const sawRoll = lines.some((line) => /\broll call\b/i.test(line.text));
  for (const line of lines) {
    const { speaker, utterance } = splitSpeaker(line.text);
    const speakerPerson = matchPerson(speaker, people);
    // Match the subject of each clause, not "any surname within N characters of absent".
    // That window marked the chair absent for reporting someone else, and treated
    // "was present ... but is absent" as present when the gap exceeded 40 characters.
    if (speakerPerson && /^(present|here|yes)[.!]?$/i.test(utterance.trim()) && !absent.has(speakerPerson.name)) {
      present.add(speakerPerson.name);
    }
    for (const clause of String(utterance || "").split(/[.;]+/)) {
      const isAbsent = /\b(absent|excused|not present)\b/i.test(clause);
      const isPresent = /\b(present|here)\b/i.test(clause);
      if (!isAbsent && !isPresent) continue;
      const named = peopleNamedIn(clause, people);
      if (!named.length) continue;
      for (const person of named) {
        if (isAbsent) {
          absent.add(person.name);
          present.delete(person.name);
        } else if (!absent.has(person.name)) {
          present.add(person.name);
        }
      }
    }
  }
  for (const name of absent) present.delete(name);
  if (sawRoll) {
    for (const person of people) {
      if (!present.has(person.name)) absent.add(person.name);
    }
  }
  const presentList = [];
  const absentList = [];
  for (const person of people) {
    if (present.has(person.name)) presentList.push(person.name);
    else if (absent.has(person.name)) absentList.push(person.name);
  }
  return { present: presentList, absent: absentList, sawRoll };
}

function voiceAyeSurnames(people, attendance) {
  const absent = new Set(attendance.absent);
  const present = new Set(attendance.present);
  const voting = people.filter((person) => isVotingMember(person) && !absent.has(person.name));
  const pool =
    attendance.sawRoll || present.size > 0
      ? voting.filter((person) => present.has(person.name))
      : voting;
  return pool.map((person) => person.last);
}

const VOTE_LINE = /^(aye|yea|yes|nay|no|abstain)[.!]?$/i;

function buildMotion(segment, people, index, attendance, allLines, startIndex) {
  const first = segment[0];
  const { speaker, utterance } = splitSpeaker(first.text);
  const joined = segment.map((line) => line.text).join(" ");
  let moverPerson = matchPerson(speaker, people);
  let seconderPerson = null;
  const statedMover = matchPerson(grabName(joined, "moved by"), people);
  const statedSeconder = matchPerson(grabName(joined, "seconded by"), people);
  if (statedMover) moverPerson = statedMover;
  const secondLine = segment.slice(1).find((line) => isSecondLine(splitSpeaker(line.text).utterance));
  if (secondLine) seconderPerson = matchPerson(splitSpeaker(secondLine.text).speaker, people);
  if (statedSeconder) seconderPerson = statedSeconder;

  const mover = moverPerson ? moverPerson.last : "UNCLEAR";
  const seconder = seconderPerson ? seconderPerson.last : "UNCLEAR";
  const motion_text = motionTextFrom(utterance);

  let outcome = "unclear";
  let outcomeLine = null;
  for (const line of segment.slice(1)) {
    const kind = classifyLine(splitSpeaker(line.text).utterance);
    if (kind) {
      outcome = kind;
      outcomeLine = line;
    }
  }

  const ayes = [];
  const nays = [];
  const abstain = [];
  let rollCall = false;
  for (const line of segment.slice(1)) {
    const parts = splitSpeaker(line.text);
    if (!VOTE_LINE.test(parts.utterance.trim())) continue;
    const voter = matchPerson(parts.speaker, people);
    if (!voter) continue;
    rollCall = true;
    const word = parts.utterance.trim().toLowerCase().replace(/[.!]/g, "");
    const bucket = word === "nay" || word === "no" ? nays : word === "abstain" ? abstain : ayes;
    if (!bucket.includes(voter.last)) bucket.push(voter.last);
  }

  const ayePool = voiceAyeSurnames(people, attendance);
  let vote_method = "voice";
  if (rollCall) vote_method = "roll call";
  else if (outcome === "passed" && nays.length === 0) {
    vote_method = "voice, no audible nays";
    for (const last of ayePool) if (!ayes.includes(last)) ayes.push(last);
  } else if (outcome === "tabled" && nays.length === 0) {
    for (const last of ayePool) if (!ayes.includes(last)) ayes.push(last);
  }
  const absentLasts = new Set(
    attendance.absent.map((name) => people.find((person) => person.name === name)?.last || name),
  );
  const dropAbsent = (list) => list.filter((name) => !absentLasts.has(name));
  ayes.splice(0, ayes.length, ...dropAbsent(ayes));
  nays.splice(0, nays.length, ...dropAbsent(nays));
  abstain.splice(0, abstain.length, ...dropAbsent(abstain));

  const uncertain = [];
  let confidence = "high";
  if (mover === "UNCLEAR") {
    uncertain.push("mover");
    confidence = "medium";
  }
  if (seconder === "UNCLEAR") {
    uncertain.push("seconder");
    confidence = "medium";
  }
  if (outcome === "unclear") {
    uncertain.push("outcome");
    confidence = "low";
  }
  if (!rollCall && outcome === "failed" && ayes.length === 0 && nays.length === 0) {
    uncertain.push("tally");
    if (confidence === "high") confidence = "medium";
  }

  const evidenceBits = [utterance];
  if (secondLine) evidenceBits.push(splitSpeaker(secondLine.text).utterance);
  if (outcomeLine) evidenceBits.push(splitSpeaker(outcomeLine.text).utterance);
  const vote_timestamp = (outcomeLine || segment[segment.length - 1]).timestamp;

  return {
    agenda_item: agendaFor(allLines, startIndex, motion_text, index),
    motion_text,
    mover,
    seconder,
    outcome,
    ayes,
    nays,
    abstain,
    absent: attendance.absent.map((name) => people.find((person) => person.name === name)?.last || name),
    vote_method,
    motion_timestamp: first.timestamp,
    vote_timestamp,
    confidence,
    uncertain_fields: uncertain,
    evidence_quote: evidenceBits.join(" ").slice(0, 500),
  };
}

/**
 * @returns meeting object in the fixture shape
 */
export function extractMeeting({ transcript, roster, meeting_id, meeting_date, org, title }) {
  if (!meeting_id) throw new Error("meeting_id is required");
  if (!meeting_date) throw new Error("meeting_date is required");
  const meta = transcriptMeta(transcript);
  const resolvedOrg = String(org || "").trim() || meta.org || "Board (FICTIONAL)";
  const resolvedTitle =
    String(title || "").trim() ||
    meta.title ||
    `${resolvedOrg === "Board (FICTIONAL)" ? "Board" : resolvedOrg} meeting ${meeting_date}`;
  const people = rosterPeople(roster);
  const lines = parseTranscriptLines(transcript).map((line) => {
    const sec = tsec(line.timestamp);
    return { ...line, t: sec };
  });
  const attendance = collectAttendance(lines, people);

  const segments = [];
  let i = 0;
  while (i < lines.length) {
    const { utterance } = splitSpeaker(lines[i].text);
    if (!isMotionStart(utterance)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && !isMotionStart(splitSpeaker(lines[j].text).utterance)) j++;
    segments.push({ start: i, lines: lines.slice(i, j) });
    i = j;
  }

  const cores = segments.map((segment, index) =>
    buildMotion(segment.lines, people, index, attendance, lines, segment.start),
  );
  const checked = validateMotions({ motions: cores });
  if (!checked.ok) {
    throw new Error(`extractor produced invalid motions: ${JSON.stringify(checked.errors)}`);
  }

  const motions = checked.motions.map((core, index) => {
    const attribution = attribute(core, transcript, roster || []);
    return {
      ...core,
      id: `M${index + 1}`,
      flags: [],
      attribution,
    };
  });

  const open_questions = [];
  for (const mot of motions) {
    for (const field of ["mover", "seconder"]) {
      const attr = mot.attribution[field];
      if (attr?.status === "NEEDS CONFIRMATION") {
        open_questions.push(
          `Confirm ${field} for ${mot.id} (${mot.agenda_item}). AI suggestion: ${attr.ai_suggestion}.`,
        );
      }
    }
  }

  const call_to_order = lines[0]?.timestamp || "00:00:00";
  const adjournMotion = [...motions].reverse().find((m) => /adjourn/i.test(m.motion_text));
  const adjourned = adjournMotion?.vote_timestamp || lines[lines.length - 1]?.timestamp || call_to_order;

  const items = [
    {
      agenda_item: "1. Call to order and roll call",
      timestamp: call_to_order,
      summary: `Roll call. Present: ${attendance.present.join(", ") || "not recorded"}.`,
    },
  ];
  for (const mot of motions) {
    items.push({
      agenda_item: mot.agenda_item,
      timestamp: mot.motion_timestamp,
      summary: mot.motion_text,
    });
  }

  return {
    meeting_id,
    synthetic: true,
    note: "FICTIONAL. Rule-based extract for clean synthetic transcripts. This server does not call a model.",
    org: resolvedOrg,
    meeting_date,
    meeting_type: "Regular board meeting",
    title: resolvedTitle,
    call_to_order,
    adjourned,
    present: attendance.present,
    absent: attendance.absent,
    roster: (roster || []).map((r) => ({ name: r.name, role: r.role || "" })),
    items,
    motions,
    open_questions,
  };
}
