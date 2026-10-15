/**
 * Faithful port of norm, tsec, and crosscheck from minutes-test/scripts/pipeline.py.
 * Pairs draft motions with an independent pass by timestamp (<= 120s) and flags disagreements.
 */

export function tsec(s) {
  try {
    const p = String(s ?? "")
      .trim()
      .split(":")
      .map((x) => Number.parseInt(x, 10));
    if (!p.length || p.some((n) => Number.isNaN(n))) return null;
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    if (p.length === 2) return p[0] * 60 + p[1];
    return null;
  } catch {
    return null;
  }
}

/** Python list/None rendering for flag strings. */
function py(v) {
  if (v == null) return "None";
  if (Array.isArray(v)) return `[${v.map((x) => `'${x}'`).join(", ")}]`;
  return String(v);
}

export function norm(n) {
  let s = (n || "").toLowerCase();
  s = s.replace(
    /\b(commissioner|director|trustee|chair|vice chair|mr|ms|mrs|dr|board president|president)\.?\b/g,
    "",
  );
  const toks = s.match(/[a-z]+/g) || [];
  return toks.length ? toks[toks.length - 1] : "";
}

/**
 * Mutates and returns draft, matching pipeline.py crosscheck.
 * @param {{ motions: object[] }} draft
 * @param {{ motions: object[] }} verify
 */
export function crosscheck(draft, verify) {
  const used = new Set();
  const verifyMotions = verify?.motions || [];
  draft.motions = draft.motions || [];
  for (const dm of draft.motions) {
    if (!Array.isArray(dm.flags)) dm.flags = [];
    if (dm.uncertain_fields?.length) {
      dm.flags.push("model unsure: " + dm.uncertain_fields.join(", "));
    }
    if (dm.confidence === "medium" || dm.confidence === "low") {
      dm.flags.push(`confidence ${dm.confidence}`);
    }
    const t = tsec(dm.motion_timestamp ?? "") ?? tsec(dm.vote_timestamp ?? "");
    let best = null;
    let bd = 1e9;
    for (let j = 0; j < verifyMotions.length; j++) {
      if (used.has(j)) continue;
      const vm = verifyMotions[j];
      const tv = tsec(vm.motion_timestamp ?? "") ?? tsec(vm.vote_timestamp ?? "");
      if (t == null || tv == null) continue;
      const dist = Math.abs(t - tv);
      if (dist < bd) {
        best = j;
        bd = dist;
      }
    }
    if (best == null || bd > 120) {
      dm.flags.push("second pass did not find this motion");
      continue;
    }
    used.add(best);
    const vm = verifyMotions[best];
    for (const f of ["mover", "seconder"]) {
      if (norm(dm[f]) !== norm(vm[f])) {
        dm.flags.push(`passes disagree on ${f}: '${py(dm[f])}' vs '${py(vm[f])}'`);
      }
    }
    if (dm.outcome !== vm.outcome) {
      dm.flags.push(`passes disagree on outcome: ${py(dm.outcome)} vs ${py(vm.outcome)}`);
    }
    if ((dm.nays || []).length !== (vm.nays || []).length) {
      dm.flags.push(`passes disagree on nays: ${py(dm.nays || [])} vs ${py(vm.nays || [])}`);
    }
    if (`${dm.mover || ""}${dm.seconder || ""}`.toUpperCase().includes("UNCLEAR")) {
      dm.flags.push("mover/seconder unclear");
    }
  }
  for (let j = 0; j < verifyMotions.length; j++) {
    if (used.has(j)) continue;
    const vm = verifyMotions[j];
    vm.flags = ["found only by second pass: CHECK whether this motion was made"];
    draft.motions.push(vm);
  }
  draft.motions.sort((a, b) => (tsec(a.motion_timestamp ?? "") || 0) - (tsec(b.motion_timestamp ?? "") || 0));
  return draft;
}
