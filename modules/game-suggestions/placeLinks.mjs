// Place pages (core 0.34.0): several modules can share one admin page (here "community.games"), so the core gives each module its own URL namespace
// (`<instance>.edit=3`) and reads unprefixed parameters for nobody. It rewrites the `?...` links written in block keys such as `href` and `cancelHref`, but never the
// links inside a raw `html` block. So every `href="?..."` of our html blocks carries the namespace itself, and the panel reads both forms (`unscopeQuery`): the prefixed
// one (what our html links produce, on the module's own page too) and the plain one (bookmarks, other modules' links). The core leaves an already prefixed link
// untouched, so this keeps working if the core rewrites html links one day.
const NS_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PARAM_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** `href="?a=1&amp;b=2"` -> `href="?<key>.a=1&amp;<key>.b=2"` in every `html` block (nested blocks too). Anything else is returned untouched. */
export function scopeHtmlLinks(node, key) {
  if (!NS_RE.test(String(key ?? ""))) return node;
  const scope = (q) => q.split(/(&amp;|&)/).map((part) => (part === "&amp;" || part === "&" || !part ? part : PARAM_RE.test(part.split("=")[0]) ? `${key}.${part}` : part)).join("");
  const rewrite = (h) => h.replace(/href=(["'])\?([^"'#]*)/g, (_m, quote, q) => `href=${quote}?${scope(q)}`);
  const walk = (b) => (Array.isArray(b) ? b.map(walk) : b && typeof b === "object" ? (b.type === "html" && typeof b.html === "string" ? { ...b, html: rewrite(b.html) } : Object.fromEntries(Object.entries(b).map(([k, x]) => [k, walk(x)]))) : b);
  return walk(node);
}

/** The parameters as the panel reads them: `<key>.edit` and `edit` both give `edit` (the prefixed one wins). */
export function unscopeQuery(query, key) {
  const prefix = `${key}.`;
  const out = {};
  for (const [k, v] of Object.entries(query ?? {})) if (!k.startsWith(prefix)) out[k] = v;
  for (const [k, v] of Object.entries(query ?? {})) if (k.startsWith(prefix) && PARAM_RE.test(k.slice(prefix.length))) out[k.slice(prefix.length)] = v;
  return out;
}
