// Le petit évaluateur de calcul de `{calcul …}` : des nombres, + - * / % ^, des parenthèses et quelques fonctions. Aucun JavaScript n'est jamais exécuté :
// le texte est découpé en jetons d'une liste fermée, puis lu par une grammaire fixe. Tout ce qui n'est pas dans la liste est refusé.
// Bornes : 100 caractères, 30 niveaux de parenthèses, résultat fini et inférieur à un million de milliards.

export const MAX_EXPR = 100;
const MAX_DEPTH = 30;
const MAX_ABS = 1e15;
export const FUNCTIONS = { abs: [1, 1, Math.abs], round: [1, 1, Math.round], floor: [1, 1, Math.floor], ceil: [1, 1, Math.ceil], sqrt: [1, 1, Math.sqrt], min: [2, 6, Math.min], max: [2, 6, Math.max] };
const CONSTANTS = { pi: Math.PI };
const fail = (code) => { throw Object.assign(new Error(code), { calc: code }); };

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " ") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(src.slice(i));
      if (!m) fail("syntax");
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (/[a-z]/i.test(c)) {
      const m = /^[a-z]+/i.exec(src.slice(i))[0].toLowerCase();
      if (Object.hasOwn(FUNCTIONS, m)) out.push({ t: "fn", v: m });
      else if (Object.hasOwn(CONSTANTS, m)) out.push({ t: "num", v: CONSTANTS[m] });
      else fail("word");
      i += m.length;
    } else if ("+-*/%^(),×÷".includes(c)) { out.push({ t: "op", v: c === "×" ? "*" : c === "÷" ? "/" : c }); i++; }
    else fail("char");
  }
  return out;
}

/** Évalue une expression. Rend un nombre fini ; lève une erreur `{ calc: code }` (« syntax », « char », « word », « range », « long », « deep », « div »). */
export function evaluate(expr) {
  const src = String(expr ?? "").trim();
  if (!src) fail("syntax");
  if (src.length > MAX_EXPR) fail("long");
  const tok = tokenize(src);
  let p = 0;
  const peek = () => tok[p], isOp = (v) => tok[p]?.t === "op" && tok[p].v === v;
  const check = (n) => { if (!Number.isFinite(n) || Math.abs(n) > MAX_ABS) fail("range"); return n; };
  function expression(depth) {
    let v = term(depth);
    while (isOp("+") || isOp("-")) { const op = tok[p++].v; const r = term(depth); v = check(op === "+" ? v + r : v - r); }
    return v;
  }
  function term(depth) {
    let v = unary(depth);
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = tok[p++].v, r = unary(depth);
      if ((op === "/" || op === "%") && r === 0) fail("div");
      v = check(op === "*" ? v * r : op === "/" ? v / r : v % r);
    }
    return v;
  }
  function unary(depth) {
    if (isOp("-")) { p++; return -unary(depth); }
    if (isOp("+")) { p++; return unary(depth); }
    return power(depth);
  }
  function power(depth) {
    const base = atom(depth);
    if (isOp("^")) { p++; const e = unary(depth); return check(Math.pow(base, e)); }   // « 2^3^2 » : de droite à gauche
    return base;
  }
  function atom(depth) {
    if (depth > MAX_DEPTH) fail("deep");
    const t = peek();
    if (!t) fail("syntax");
    if (t.t === "num") { p++; return t.v; }
    if (t.t === "op" && t.v === "(") { p++; const v = expression(depth + 1); if (!isOp(")")) fail("syntax"); p++; return v; }
    if (t.t === "fn") {
      p++;
      if (!isOp("(")) fail("syntax");
      p++;
      const args = [expression(depth + 1)];
      while (isOp(",")) { p++; args.push(expression(depth + 1)); }
      if (!isOp(")")) fail("syntax");
      p++;
      const [min, max, f] = FUNCTIONS[t.v];
      if (args.length < min || args.length > max) fail("syntax");
      return check(f(...args));
    }
    return fail("syntax");
  }
  const v = expression(0);
  if (p !== tok.length) fail("syntax");
  return v;
}

/** Le résultat en texte : jusqu'à 6 décimales, sans zéros inutiles. */
export function formatNumber(n) {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? "0" : String(r);
}

/** Calcule et met en forme ; rend { ok: true, text } ou { ok: false, code }. Ne lève jamais. */
export function calc(expr) {
  try { return { ok: true, text: formatNumber(evaluate(expr)) }; } catch (e) { return { ok: false, code: e?.calc ?? "syntax" }; }
}
