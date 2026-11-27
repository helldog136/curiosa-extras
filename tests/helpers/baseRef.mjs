// Reading a file as it is on the BASE branch, for the "this list only shrinks" checks (ergonomics, translations, assertions).
// The old checks did `if (git show … failed) return;`: on a shallow or detached checkout they passed without comparing anything, and nobody could tell.
// Now the three outcomes are explicit:
//   { found: true, ref, text }   the file exists on the base branch: compare;
//   { found: false, missing }    the base branch is there but does not have the file yet (this change introduces it): nothing to compare, say so;
//   an unreachable base branch   FAILS when the check is required (CI, or BASE_REF_REQUIRED=1: the CI checks out the whole history, so a missing ref is a broken CI),
//                                and is a visible t.skip(reason) on a developer machine, never a silent pass.
import { spawnSync } from "node:child_process";

/** @param {string} root @param {string} file path inside the repository @param {string[]} refs candidates, first reachable wins */
export function readAtBase(root, file, refs) {
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const ref = refs.find((r) => git("rev-parse", "--verify", "--quiet", `${r}^{commit}`).status === 0);
  if (!ref) return { found: false, unreachable: true, tried: refs };
  const shown = git("show", `${ref}:${file}`);
  if (shown.status !== 0) return { found: false, unreachable: false, ref, missing: file };
  return { found: true, ref, text: shown.stdout };
}

export const baseRequired = () => process.env.BASE_REF_REQUIRED === "1" || (process.env.CI === "true" && process.env.BASE_REF_REQUIRED !== "0");

/**
 * Turns "not found" into a visible outcome. Returns true when the caller can compare (`r.found`); otherwise it has already failed or skipped the test (the caller returns).
 * @param {import("node:test").TestContext} t @param {object} r result of readAtBase @param {(msg: string) => never} fail assert.fail
 */
export function settle(t, r, fail, what) {
  if (r.found) return true;
  if (r.unreachable) {
    const why = `${what}: the base branch (${r.tried.join(" or ")}) is not reachable here (shallow or detached checkout?). Fetch it (git fetch origin master dev), then run again.`;
    if (baseRequired()) fail(`${why} This check is required here (CI): the workflow must fetch the whole history.`);
    t.skip(`${why} The comparison with the base branch did NOT run.`);
  } else t.skip(`${what}: ${r.missing} does not exist on ${r.ref} yet (this change introduces it): nothing to compare with.`);
  return false;
}
