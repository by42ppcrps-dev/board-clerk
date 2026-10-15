/**
 * Zod port of MOTION_SCHEMA from minutes-test/scripts/pipeline.py.
 * validateMotions(json) -> { ok, motions, errors }.
 */
import { z } from "zod";

const HHMMSS = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

export const motionSchema = z.object({
  agenda_item: z.string(),
  motion_text: z.string(),
  mover: z.string(),
  seconder: z.string(),
  outcome: z.enum(["passed", "failed", "withdrawn", "tabled", "unclear"]),
  ayes: z.array(z.string()),
  nays: z.array(z.string()),
  abstain: z.array(z.string()).optional().default([]),
  absent: z.array(z.string()).optional().default([]),
  vote_method: z.string().optional().default(""),
  motion_timestamp: z.string().regex(HHMMSS, "bad timestamp"),
  vote_timestamp: z.string().regex(HHMMSS, "bad timestamp"),
  confidence: z.enum(["high", "medium", "low"]),
  uncertain_fields: z.array(z.string()),
  evidence_quote: z.string(),
});

function issueText(error) {
  const issues = error?.issues || error?.errors || [];
  if (!issues.length) return String(error?.message || error);
  return issues
    .map((issue) => {
      const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/**
 * @param {{ motions?: unknown[] } | unknown[]} json
 * @returns {{ ok: boolean, motions: object[], errors: { index: number, message: string }[] }}
 */
export function validateMotions(json) {
  const motions = Array.isArray(json) ? json : json?.motions;
  if (!Array.isArray(motions)) {
    return { ok: false, motions: [], errors: [{ index: -1, message: "motions array required" }] };
  }
  const errors = [];
  const okMotions = [];
  for (let i = 0; i < motions.length; i++) {
    const parsed = motionSchema.safeParse(motions[i]);
    if (!parsed.success) errors.push({ index: i, message: issueText(parsed.error) });
    else okMotions.push(parsed.data);
  }
  return { ok: errors.length === 0, motions: errors.length === 0 ? okMotions : okMotions, errors };
}
