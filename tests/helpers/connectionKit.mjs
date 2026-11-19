// The R33 check of a connection page in its three states (core 0.36.0): `assertConnectionStates({ notConfigured, configured, degraded })`.
// It comes from the core's own kit (testsupport/ergonomics.mjs), so the test always applies the rules of the core under test.
import path from "node:path";
import { pathToFileURL } from "node:url";

const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/ergonomics.mjs")).href);
export const assertConnectionStates = kit.assertConnectionStates;
export const adminPageErgonomicsProblems = kit.adminPageErgonomicsProblems;
