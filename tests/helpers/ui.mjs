// Lire les listes HTML de l'administration du Bot Twitch (tableau unique, recherche en direct) sans navigateur : de quoi vérifier lignes, attributs et textes.
export const htmlOf = (blocks, id) => (blocks.find((b) => b.type === "html" && b.html.includes(`data-ck-list="${id}"`)) ?? { html: "" }).html;
const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** Les lignes d'une liste : { attrs: { origin, state, hay, … }, cells: { name, ans, … } (texte seul), html }. */
export function rowsOf(html) {
  return [...String(html).matchAll(/<tr (data-ck-row[^>]*)>([\s\S]*?)<\/tr>/g)].map((m) => {
    const attrs = Object.fromEntries([...m[1].matchAll(/data-([\w-]+)="([^"]*)"/g)].map((a) => [a[1], decode(a[2])]));
    const cells = Object.fromEntries([...m[2].matchAll(/<td class="(c-\w+)">([\s\S]*?)<\/td>/g)].map((c) => [c[1].slice(2), decode(c[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())]));
    return { attrs, cells, html: m[2] };
  });
}
export const byName = (rows, name) => rows.find((r) => r.cells.name.split(" ")[0] === name);
export const pills = (html) => [...String(html).matchAll(/data-ck-key="(\w+)" data-ck-val="(\w+)" aria-pressed="(\w+)">([^<]*?)(?: <b>(\d+)<\/b>)?<\/button>/g)].map((m) => ({ key: m[1], val: m[2], pressed: m[3] === "true", label: decode(m[4]), count: m[5] === undefined ? undefined : Number(m[5]) }));
export const formOfBlocks = (blocks, action) => blocks.find((b) => b.type === "adminForm" && b.action === action);
export const configOf = (blocks) => { const b = blocks.find((x) => x.type === "html" && x.html.includes("data-ck-config=")); const m = b && /data-ck-json="([^"]*)"/.exec(b.html); return m ? JSON.parse(decode(m[1])) : null; };
export const plain = (html) => decode(String(html).replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
