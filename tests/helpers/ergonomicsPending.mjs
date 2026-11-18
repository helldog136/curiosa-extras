// R33 (docs/ERGONOMIE-ADMIN.md) page checks that were introduced with kit 0.36.0 and that the pages below do not pass YET: R33a (an internal word as a state chip: "Prête",
// "Pas vérifié") and R33d (a good-news banner with no action). The page checks have no baseline file; these pages are listed here and are cleaned by the R33 batches
// (connection modules E2, E3). A batch that fixes a page switches its test back to "./ergonomics.mjs" (this list only shrinks, never grows: do not import this file in a new test).
import * as kit from "./ergonomics.mjs";

export * from "./ergonomics.mjs";
const PENDING = ["R33a", "R33d"];
const withPending = (opts = {}) => ({ ...opts, skip: [...new Set([...(opts.skip ?? []), ...PENDING])] });
export const assertAdminPageErgonomics = (blocks, opts) => kit.assertAdminPageErgonomics(blocks, withPending(opts));
export const adminPageErgonomicsProblems = (blocks, opts) => kit.adminPageErgonomicsProblems(blocks, withPending(opts));
