// A test that cannot fail is worse than no test: it reports green while nothing is checked. This ratchet reads every tests/**/*.test.mjs with acorn (no test is run) and
// refuses a NEW leaf test that
//   • "empty"         has an empty body,
//   • "skipped"       is skipped or todo through a LITERAL option or test.skip()/test.todo() (a conditional skip, `{ skip: cond ? "reason" : false }` or `t.skip(reason)`, is visible
//                     in the report and is fine),
//   • "no-assertion"  never asserts: no assert.* / t.assert.*, no helper that asserts (see below), no `throw`, no subtest, no t.skip/t.todo,
//   • "silent-return" returns early (bare `return`) before any assertion or t.skip: a precondition that passes silently. Use t.skip(reason) so the report shows it,
//   • "weak-only"     only asserts what cannot say much: assert.ok(x) on a bare variable, Array.isArray, typeof checks, doesNotThrow, notEqual(x, undefined).
// What counts as "asserts": a direct call on assert / strict / t.assert; a function whose name starts with assert / expect / must / ensure / verify; and, transitively, any
// function declared in the same test file or in a non-test file under tests/ or testsupport/ that calls one of those (a helper that asserts for the test).
// tests/assertion-baseline.json lists today's offenders as "file::test name". It can only SHRINK: a new offender fails, a fixed one must be removed from the list
// and the list is compared with the base branch (tests/helpers/baseRef.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readAtBase, settle } from "./helpers/baseRef.mjs";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
// This repository has no dependency of its own: the parser is the one of the core under test (the CI installs its dev dependencies: acorn comes with eslint).
const acorn = createRequire(path.join(path.resolve(process.env.CURIOSA_DIR ?? process.cwd()), "package.json"))("acorn");
const BASELINE_FILE = "tests/assertion-baseline.json";
const BASE_REFS = process.env.ASSERTION_BASE_REF ? [process.env.ASSERTION_BASE_REF] : ["origin/master"];

/* ───────────────────────────── the analysis (pure: sources in, offenders out) ───────────────────────────── */
const parse = (src) => {
  const o = { ecmaVersion: "latest", locations: true, ranges: true, allowHashBang: true, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true };
  try { return acorn.parse(src, { ...o, sourceType: "module" }); } catch { return acorn.parse(src, { ...o, sourceType: "script" }); }
};
const kids = (n) => {
  const r = [];
  for (const k in n) {
    if (k === "loc" || k === "range" || k === "type") continue;
    const v = n[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === "string") r.push(c); } else if (v && typeof v.type === "string") r.push(v);
  }
  return r;
};
const isFn = (n) => !!n && /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type);
const ASSERT_NAME = /^(assert|expect|must|ensure|verify)[A-Z_0-9]/;
const ASSERT_ROOTS = new Set(["assert", "strict", "assertStrict", "expect"]);
const TEST_NAMES = new Set(["test", "it", "describe", "suite"]);
// `console.log(x)` must not count as a call of a helper that happens to be called "log": a method of a built-in or of a Node module is never a test helper.
const NOT_HELPERS = new Set(["console", "JSON", "Math", "Object", "Array", "String", "Number", "Boolean", "Promise", "Reflect", "Date", "Symbol", "Buffer", "process", "globalThis", "fs", "path", "os", "util", "url", "crypto", "http", "https", "net", "zlib", "child_process", "assert", "t", "this", "mock", "Intl", "URL", "URLSearchParams", "Set", "Map", "RegExp", "Error"]);
/** The name of the helper a call reaches, or null when the call is a method of a built-in / Node module. */
const helperName = (ch) => (ch.length === 1 || (ch.length > 1 && !NOT_HELPERS.has(ch[0]) && ch[0] !== "()")) ? ch[ch.length - 1] : null;

function chainOf(c) {
  const parts = [];
  while (c) {
    if (c.type === "Identifier") { parts.unshift(c.name); break; }
    if (c.type === "MemberExpression") { parts.unshift(c.computed ? "[]" : c.property.name); c = c.object; continue; }
    if (c.type === "ChainExpression") { c = c.expression; continue; }
    if (c.type === "CallExpression") { c = c.callee; parts.unshift("()"); continue; }
    break;
  }
  return parts;
}
function isDirectAssert(call) {
  const ch = chainOf(call.callee);
  if (!ch.length) return false;
  if (ASSERT_ROOTS.has(ch[0])) return true;
  if (ch[0] === "t" && ch[1] === "assert") return true;
  if (ch.length === 1 && ASSERT_NAME.test(ch[0])) return true;
  return ch.length === 2 && ASSERT_NAME.test(ch[1]);
}
/** A bare variable: `assert.ok(value)` only says "something truthy". A property or a call (`r.ok`, `parse(x).ok`, `list.includes(y)`) is an answer the code computed. */
const plainRead = (x) => x.type === "Identifier";
function isWeak(call) {
  const ch = chainOf(call.callee); const m = ch[ch.length - 1]; const a = call.arguments;
  if (m === "doesNotThrow" || m === "doesNotReject") return true;
  if ((m === "ok" || (ch.length === 1 && ch[0] === "assert")) && a[0]) {
    const x = a[0];
    return plainRead(x) || (x.type === "CallExpression" && /^(Array\.isArray|isArray)$/.test(chainOf(x.callee).join(".")));
  }
  if (/^(equal|strictEqual)$/.test(m) && a[0] && a[0].type === "UnaryExpression" && a[0].operator === "typeof") return true;
  if (/^(notEqual|notStrictEqual)$/.test(m) && a[1] && ((a[1].type === "Identifier" && a[1].name === "undefined") || (a[1].type === "Literal" && a[1].value === null))) return true;
  return false;
}

/** Names of the functions that assert, per file: a test file only sees its own functions plus those of the non-test files (helpers). */
function assertingFunctions(parsed) {
  const table = []; // { file, isTest, name, calls:Set, direct }
  for (const [file, { ast, isTest }] of parsed) {
    (function rec(n) {
      let name = null, fnode = null;
      if (n.type === "FunctionDeclaration" && n.id) { name = n.id.name; fnode = n; }
      else if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && isFn(n.init)) { name = n.id.name; fnode = n.init; }
      else if (n.type === "Property" && n.key.type === "Identifier" && isFn(n.value)) { name = n.key.name; fnode = n.value; }
      else if (n.type === "MethodDefinition" && n.key.type === "Identifier") { name = n.key.name; fnode = n.value; }
      if (name && fnode) {
        const calls = new Set(); let direct = false;
        (function inner(m) {
          if (m.type === "CallExpression") { if (isDirectAssert(m)) direct = true; const name2 = helperName(chainOf(m.callee)); if (name2) calls.add(name2); }
          if (m.type === "ThrowStatement") direct = true;
          for (const c of kids(m)) inner(c);
        })(fnode.body);
        table.push({ file, isTest, name, calls, direct });
      }
      for (const c of kids(n)) rec(c);
    })(ast);
  }
  const perFile = new Map();
  for (const [file, { isTest }] of parsed) {
    if (!isTest) continue;
    const visible = (d) => d.file === file || !d.isTest;
    const set = new Set(table.filter((d) => visible(d) && d.direct).map((d) => d.name));
    for (let changed = true; changed;) {
      changed = false;
      for (const d of table) if (visible(d) && !set.has(d.name) && [...d.calls].some((c) => set.has(c))) { set.add(d.name); changed = true; }
    }
    perFile.set(file, set);
  }
  return perFile;
}

function testCall(n, imported) {
  if (n.type !== "CallExpression") return null;
  const c = n.callee;
  if (c.type === "Identifier" && TEST_NAMES.has(c.name) && imported.has(c.name)) return { base: c.name, mod: null };
  if (c.type === "MemberExpression" && !c.computed) {
    if (c.object.type === "Identifier" && TEST_NAMES.has(c.object.name) && imported.has(c.object.name) && /^(skip|todo|only)$/.test(c.property.name)) return { base: c.object.name, mod: c.property.name };
    if (c.property.name === "test" && c.object.type === "Identifier" && /^(t|ctx|tc|subtest)$/.test(c.object.name)) return { base: "subtest", mod: null };
  }
  return null;
}
const literalSkip = (args) => args.some((a) => a.type === "ObjectExpression" && a.properties.some((p) => p.type === "Property" && p.key.type === "Identifier" && /^(skip|todo)$/.test(p.key.name) && p.value.type === "Literal" && !!p.value.value));

/** Offenders of one file: [{ key, kind }] ("file::title", "file::title #2" for a repeated title, "A > B" for a subtest). */
export function offendersOf(file, src, asserting) {
  const ast = parse(src);
  const imported = new Set();
  for (const n of ast.body) {
    if (n.type === "ImportDeclaration" && n.source.value === "node:test") for (const s of n.specifiers) imported.add(s.local.name);
    if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.init && /require\(["']node:test["']\)/.test(src.slice(d.init.range[0], d.init.range[1]))) {
      if (d.id.type === "Identifier") imported.add(d.id.name);
      else if (d.id.type === "ObjectPattern") for (const p of d.id.properties) if (p.value?.type === "Identifier") imported.add(p.value.name);
    }
  }
  const localFns = new Map();
  (function rec(n) {
    if (n.type === "FunctionDeclaration" && n.id) localFns.set(n.id.name, n);
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && isFn(n.init)) localFns.set(n.id.name, n.init);
    for (const c of kids(n)) rec(c);
  })(ast);

  const out = []; const seen = new Map();
  const titleOf = (call, fn) => {
    const a = call.arguments.find((x) => (x.type === "Literal" && typeof x.value === "string") || x.type === "TemplateLiteral");
    if (a) return a.type === "Literal" ? a.value : src.slice(a.range[0] + 1, a.range[1] - 1);
    return fn?.id?.name ?? "(anonymous)";
  };
  function visit(n, trail) {
    const info = testCall(n, imported);
    if (info) {
      const args = n.arguments;
      let body = null, fn = [...args].reverse().find(isFn);
      if (fn) body = fn.body;
      else {
        const last = [...args].reverse().find((a) => a.type !== "Literal" && a.type !== "TemplateLiteral" && a.type !== "ObjectExpression");
        if (last?.type === "Identifier" && localFns.has(last.name)) { fn = localFns.get(last.name); body = fn.body; } else if (last) body = last; // e.g. test(name, quiet(async () => …))
      }
      const title = [...trail, titleOf(n, fn)].join(" > ");
      const container = info.base === "describe" || info.base === "suite";
      let subtests = 0, asserts = 0, helper = 0, weak = 0, throws = 0, skipCall = false, firstProof = Infinity; const bareReturns = [];
      if (body) {
        (function inner(m, own) {
          if (m.type === "CallExpression") {
            if (testCall(m, imported)) { subtests++; visit(m, [...trail, titleOf(n, fn)]); return; }
            const ch = chainOf(m.callee); const last = helperName(ch);
            if (isDirectAssert(m)) { asserts++; if (isWeak(m)) weak++; firstProof = Math.min(firstProof, m.range[0]); }
            else if (last && asserting.has(last)) { helper++; firstProof = Math.min(firstProof, m.range[0]); }
            if (ch[0] === "t" && /^(skip|todo)$/.test(ch[1] ?? "")) { skipCall = true; firstProof = Math.min(firstProof, m.range[0]); }
          }
          if (m.type === "ThrowStatement") throws++;
          if (m.type === "ReturnStatement" && !m.argument && own) bareReturns.push(m.range[0]);
          for (const c of kids(m)) inner(c, own && !isFn(c));
        })(body, true);
      }
      if (!container) {
        const literal = info.mod === "skip" || info.mod === "todo" || literalSkip(args);
        const empty = !!body && body.type === "BlockStatement" && body.body.length === 0;
        const kinds = [];
        if (literal) kinds.push("skipped");
        else if (empty) kinds.push("empty");
        else if (subtests === 0 && !skipCall && asserts + helper === 0 && throws === 0) kinds.push("no-assertion");
        else if (asserts > 0 && helper === 0 && weak === asserts) kinds.push("weak-only");
        if (!literal && !empty && bareReturns.some((p) => p < firstProof)) kinds.push("silent-return");
        for (const kind of kinds) {
          const base = `${file}::${title}`; const k = (seen.get(base) ?? 0) + 1; seen.set(base, k);
          out.push({ key: k === 1 ? base : `${base} #${k}`, kind });
        }
      }
      return;
    }
    for (const c of kids(n)) visit(c, trail);
  }
  visit(ast, []);
  // a title that offends twice for two kinds keeps one entry per kind with the same key: collapse
  return [...new Map(out.map((o) => [o.key, o])).values()];
}

export function collect(repo) {
  const parsed = new Map(); const errors = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|cjs|js)$/.test(e.name)) {
        const rel = path.relative(repo, p).split(path.sep).join("/"); const isTest = /\.test\.(mjs|cjs|js)$/.test(e.name);
        try { parsed.set(rel, { ast: parse(fs.readFileSync(p, "utf8")), isTest, src: fs.readFileSync(p, "utf8") }); } catch (e2) { if (isTest) errors.push(`${rel}: ${e2.message}`); }
      }
    }
  };
  walk(path.join(repo, "tests")); walk(path.join(repo, "testsupport"));
  const asserting = assertingFunctions(parsed);
  const offenders = [];
  for (const [rel, { isTest, src }] of parsed) if (isTest) offenders.push(...offendersOf(rel, src, asserting.get(rel)));
  return { offenders: offenders.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)), errors, files: [...parsed.values()].filter((p) => p.isTest).length };
}

/* ───────────────────────────── the guard on this repository ───────────────────────────── */
const baseline = JSON.parse(fs.readFileSync(path.join(root, BASELINE_FILE), "utf8"));
const current = collect(root);

test("every test file parses (a file the guard cannot read is a file it cannot guard)", () => {
  assert.deepEqual(current.errors, []);
  assert.ok(current.files > 100, `only ${current.files} test files found: is the analysis looking in the right place?`);
});

test("the assertion baseline is well formed and sorted", () => {
  assert.equal(baseline.version, 1);
  assert.ok(Array.isArray(baseline.tests));
  assert.deepEqual([...baseline.tests].sort(), baseline.tests, "keep the list sorted");
  assert.equal(new Set(baseline.tests).size, baseline.tests.length, "no duplicate line");
});

test("no NEW test that cannot fail: every leaf test asserts, runs, and skips visibly", () => {
  const known = new Set(baseline.tests);
  const fresh = current.offenders.filter((o) => !known.has(o.key));
  assert.deepEqual(fresh.map((o) => `${o.key}  [${o.kind}]`), [],
    `\nThese tests can pass without checking anything. Add a real assertion (assert.equal/deepEqual on the result), or, for a precondition, call t.skip("reason") instead of a bare return.\n`
    + `Kinds: empty body · skipped (literal skip/todo: use { skip: cond ? "reason" : false }) · no-assertion · silent-return (bare return before any assertion) · weak-only (only assert.ok(variable) / Array.isArray / typeof / doesNotThrow).\n`);
});

test("no baseline line is left over: a fixed test must leave the list (the list only shrinks)", () => {
  const now = new Set(current.offenders.map((o) => o.key));
  assert.deepEqual(baseline.tests.filter((k) => !now.has(k)), [], `remove these lines from ${BASELINE_FILE}: the tests were fixed, renamed or deleted`);
});

test("the baseline never grows: compared with the base branch", (t) => {
  // An unreachable base branch FAILS in CI (the workflow fetches the whole history) and is a visible skip on a developer machine; "no baseline there yet" is a visible skip.
  const base = readAtBase(root, BASELINE_FILE, BASE_REFS);
  if (!settle(t, base, assert.fail, "assertion baseline")) return;
  const before = new Set(JSON.parse(base.text).tests ?? []);
  assert.deepEqual(baseline.tests.filter((k) => !before.has(k)), [], `the assertion baseline can only shrink (compared with ${base.ref}): add an assertion to the test instead of listing it`);
});

/* ───────────────────────────── the analysis itself: one bad and one good case per rule ───────────────────────────── */
const kindsOf = (src, extra = "") => {
  const parsed = new Map([["t.test.mjs", { ast: parse(src + extra), isTest: true }]]);
  return offendersOf("t.test.mjs", src + extra, assertingFunctions(parsed).get("t.test.mjs")).map((o) => `${o.kind}:${o.key.replace("t.test.mjs::", "")}`);
};
const HEAD = `import test, { describe } from "node:test"; import assert from "node:assert/strict";\n`;

test("the analysis flags a test that asserts nothing, an empty one, a literal skip, a silent return and a weak-only test", () => {
  assert.deepEqual(kindsOf(HEAD + `test("a", () => { const x = 1; console.log(x); });`), ["no-assertion:a"]);
  assert.deepEqual(kindsOf(HEAD + `test("b", () => {});`), ["empty:b"]);
  assert.deepEqual(kindsOf(HEAD + `test("c", { skip: "later" }, () => { assert.equal(1, 1); });`), ["skipped:c"]);
  assert.deepEqual(kindsOf(HEAD + `test.todo("d");`), ["skipped:d"]);
  assert.deepEqual(kindsOf(HEAD + `test("e", () => { if (!process.env.NOPE_NOPE) return; assert.equal(1, 1); });`), ["silent-return:e"]);
  assert.deepEqual(kindsOf(HEAD + `test("f", () => { const r = [1]; assert.ok(Array.isArray(r)); assert.ok(r); });`), ["weak-only:f"]);
  assert.deepEqual(kindsOf(HEAD + `test("g", async (t) => { await t.test("inner", () => { console.log(1); }); });`), ["no-assertion:g > inner"]);
  assert.deepEqual(kindsOf(HEAD + `test("h", () => {}); test("h", () => {});`), ["empty:h", "empty:h #2"]);
});

test("the analysis accepts what really checks something", () => {
  assert.deepEqual(kindsOf(HEAD + `test("a", () => { assert.equal(1, 1); });`), []);
  assert.deepEqual(kindsOf(HEAD + `test("b", (t) => { t.assert.equal(1, 1); });`), []);
  assert.deepEqual(kindsOf(HEAD + `test("c", () => { if (1 > 2) throw new Error("no"); });`), []);
  assert.deepEqual(kindsOf(HEAD + `test("d", (t) => { if (process.arch === "nope") { t.skip("not here"); return; } assert.equal(1, 1); });`), []);
  assert.deepEqual(kindsOf(HEAD + `test("e", { skip: process.env.X ? "reason" : false }, () => { assert.equal(1, 1); });`), []);
  assert.deepEqual(kindsOf(HEAD + `test("f", () => { assert.equal(1, 1); if (process.env.X) return; assert.equal(2, 2); });`), [], "a return AFTER an assertion is not a silent guard");
  assert.deepEqual(kindsOf(HEAD + `test("g", () => { const run = () => { return; }; run(); assert.equal(1, 1); });`), [], "a return inside a nested function is not the test's return");
  assert.deepEqual(kindsOf(HEAD + `describe("d", () => { test("inner", () => { assert.equal(1, 1); }); });`), []);
  assert.deepEqual(kindsOf(HEAD + `const quiet = (fn) => fn; test("h", quiet(async () => { assert.equal(1, 1); }));`), [], "a test body wrapped by a helper is still read");
});

test("the analysis follows a helper that asserts, even through another helper, in the same file", () => {
  const helpers = `function check(x) { assert.equal(x, 1); } function checkTwice(x) { check(x); check(x); } function plain(x) { return x + 1; }\n`;
  assert.deepEqual(kindsOf(HEAD + helpers + `test("a", () => { checkTwice(1); });`), []);
  assert.deepEqual(kindsOf(HEAD + helpers + `test("b", () => { plain(1); });`), ["no-assertion:b"]);
  assert.deepEqual(kindsOf(HEAD + `test("c", () => { assertNothingHere(1); });`), [], "a name that starts with assert counts, as in assertSafeOutput(...)");
});
