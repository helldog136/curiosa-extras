// Suggestions de jeux — module communautaire de Curiosa. Porté de l'ancien site.
//
// Le public propose un jeu (liste publique, statut « proposé ») ; l'administrateur le fait avancer (planifié, accepté, déjà joué, fini…).
// Sur les jeux « déjà joués », le public vote « rejoue-le » : N votes par mois et par visiteur (un cookie + une mémoire côté serveur).
// La jaquette vient de RAWG si une clé est réglée — au mieux : sans elle, la suggestion n'a simplement pas d'image.
const COLLECTION = "games";
const STATUSES = ["proposed", "planned", "accepted", "rejected", "already_played", "finished"];
const PUBLIC = ["proposed", "planned", "accepted", "already_played", "finished"];   // « rejeté » n'est pas public
const MAX_STORED = 2000;
const HOUR = 3_600_000;
const MONTH = 30 * 24 * HOUR;
const COOKIE = "vh_gs_votes";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clean = (v, max, multiline = false) => {
  let t = String(v ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029‪-‮⁦-⁩]/g, "");
  t = multiline ? t.replace(/\n{3,}/g, "\n\n") : t.replace(/\s+/g, " ");
  return t.trim().slice(0, max);
};
const num = (v, def, min, max) => { const n = Number(v); return v === undefined || v === null || v === "" || !Number.isFinite(n) ? def : Math.min(max, Math.max(min, Math.trunc(n))); };
const safeHttps = (v) => (typeof v === "string" && /^https:\/\//.test(v) ? v : null);
const ipOf = (request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
export const isStatus = (v) => STATUSES.includes(v);

const memory = new Map();           // limiteurs en mémoire : un garde-fou, pas un pare-feu
function limited(bucket, max, windowMs, now = Date.now()) {
  const recent = (memory.get(bucket) ?? []).filter((t) => now - t < windowMs);
  recent.push(now); memory.set(bucket, recent);
  if (memory.size > 5000) for (const [k, v] of memory) if (!v.some((t) => now - t < MONTH)) memory.delete(k);
  return recent.length > max;
}

/** Jaquette via RAWG (au mieux, jamais d'exception). */
export async function fetchCover(title, apiKey) {
  if (!apiKey || !title) return null;
  try {
    const url = new URL("https://api.rawg.io/api/games");
    url.searchParams.set("search", title); url.searchParams.set("page_size", "1"); url.searchParams.set("key", apiKey);
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return safeHttps((await res.json()).results?.[0]?.background_image ?? null);
  } catch { return null; }
}

const rows = async (ctx) => (await ctx.api.store.list(COLLECTION, { limit: 1000 })).map((r) => ({
  id: r.id, at: r.createdAt, title: String(r.data.title ?? ""), status: isStatus(r.data.status) ? r.data.status : "proposed",
  cover: safeHttps(r.data.coverUrl), by: String(r.data.submitterName ?? ""), note: String(r.data.note ?? ""), votes: Number(r.data.replayVotes) || 0,
}));

const baseHref = (ctx) => { const b = ctx.instance.basePath; return b === null || b === undefined ? "/" : b ? `/${b}` : "/"; };

function card(ctx, g) {
  const cover = g.cover ? `<img src="${esc(g.cover)}" alt="" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px;margin-bottom:8px">` : "";
  const vote = g.status === "already_played"
    ? `<form method="post" action="/m/${esc(ctx.instance.key)}/vote" style="margin:8px 0 0"><input type="hidden" name="id" value="${esc(g.id)}"><button style="cursor:pointer;border:1px solid var(--v-line);border-radius:8px;padding:4px 10px;background:transparent;color:var(--v-fg)">🔁 ${esc(ctx.t("replay", { n: g.votes }))}</button></form>`
    : "";
  return `<article style="padding:12px;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface)">${cover}<h3 style="margin:0;font-size:1.05em">${esc(g.title)}</h3>` +
    `<p style="margin:4px 0 0;font-size:.85em;color:var(--v-muted)">${esc(ctx.t(`status_${g.status}`))}${g.by ? ` · ${esc(ctx.t("by", { name: g.by }))}` : ""}</p>` +
    (g.note ? `<p style="margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere">${esc(g.note)}</p>` : "") + vote + `</article>`;
}

export default {
  // /suggestions → tous (sauf rejetés) · /suggestions/<statut> → un statut
  async page(ctx, { segments }) {
    let filter = null;
    if (segments.length === 1 && PUBLIC.includes(segments[0])) filter = segments[0];
    else if (segments.length > 0) return { notFound: true, blocks: [] };

    const list = (await rows(ctx)).filter((g) => PUBLIC.includes(g.status) && (!filter || g.status === filter));
    const base = baseHref(ctx) === "/" ? "" : baseHref(ctx);
    const blocks = [];
    if (ctx.setting("intro")) blocks.push({ type: "markdown", text: String(ctx.setting("intro")) });
    blocks.push({ type: "links", items: [{ label: ctx.t("all"), href: base || "/" }, ...PUBLIC.map((s) => ({ label: ctx.t(`status_${s}`), href: `${base}/${s}` }))] });
    blocks.push({ type: "heading", text: ctx.t("formTitle") }, {
      type: "form", action: `${ctx.instance.key}/suggest`, submitLabel: ctx.t("formSubmit"), successText: ctx.t("thanks"),
      fields: [{ name: "title", label: ctx.t("formGame"), required: true }, { name: "name", label: ctx.t("formName") }, { name: "note", label: ctx.t("formNote"), kind: "textarea" }],
    });
    blocks.push(list.length ? { type: "html", html: `<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">${list.map((g) => card(ctx, g)).join("")}</div>` } : { type: "markdown", text: ctx.t("empty") });
    return { title: ctx.setting("title") || ctx.t("pageTitle"), blocks };
  },

  routes: {
    async suggest(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      if (limited(`s|${ctx.instance.key}|${ipOf(request)}`, num(ctx.setting("rateLimit"), 5, 1, 100), HOUR)) return Response.json({ ok: false }, { status: 429 });
      let form; try { form = await request.formData(); } catch { return Response.json({ ok: false }, { status: 400 }); }
      if (String(form.get("website") ?? "")) return Response.json({ ok: true });          // piège à robots
      const title = clean(form.get("title"), 100);
      const note = clean(form.get("note"), 280, true);
      if (!title || (note.match(/https?:\/\//gi) ?? []).length > 1) return Response.json({ ok: false }, { status: 400 });
      if ((await ctx.api.store.count(COLLECTION)) >= MAX_STORED) return Response.json({ ok: false }, { status: 503 });
      const cover = await fetchCover(title, String(ctx.setting("rawgApiKey") ?? "").trim());
      await ctx.api.store.add(COLLECTION, { title, status: "proposed", coverUrl: cover, submitterName: clean(form.get("name"), 40) || null, note: note || null, replayVotes: 0, lastVotedAt: null });
      return Response.json({ ok: true });
    },

    // « Rejoue-le » : seulement sur les jeux déjà joués ; N votes par mois et par visiteur. Un simple formulaire HTML : on revient sur la page.
    async vote(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      const back = new Response(null, { status: 303, headers: { Location: baseHref(ctx) } });
      let form; try { form = await request.formData(); } catch { return new Response("Bad request", { status: 400 }); }
      const record = await ctx.api.store.get(String(form.get("id") ?? ""));
      if (!record || record.data.status !== "already_played") return new Response("Not found", { status: 404 });
      const max = num(ctx.setting("maxVotesPerMonth"), 3, 1, 50);
      const now = Date.now();
      const cookie = /(?:^|;\s*)vh_gs_votes=([^;]*)/.exec(request.headers.get("cookie") ?? "")?.[1];
      let mine = []; try { mine = JSON.parse(decodeURIComponent(cookie ?? "[]")).filter((t) => Number.isFinite(t) && now - t < MONTH); } catch { mine = []; }
      // Le cookie seul se contourne (on l'efface) : une mémoire par adresse le double.
      if (mine.length >= max || limited(`v|${ctx.instance.key}|${ipOf(request)}`, max, MONTH, now)) return new Response("Too many votes", { status: 429 });
      await ctx.api.store.update(record.id, { ...record.data, replayVotes: (Number(record.data.replayVotes) || 0) + 1, lastVotedAt: new Date(now).toISOString() });
      mine.push(now);
      back.headers.append("Set-Cookie", `${COOKIE}=${encodeURIComponent(JSON.stringify(mine))}; Path=/; Max-Age=${30 * 86400}; SameSite=Lax; HttpOnly`);
      return back;
    },
  },

  async adminPanel(ctx) {
    const list = await rows(ctx);
    return [
      { type: "heading", text: ctx.t("adminTitle", { count: list.length, proposed: list.filter((g) => g.status === "proposed").length }) },
      {
        type: "table", columns: [ctx.t("colDate"), ctx.t("colGame"), ctx.t("colBy"), ctx.t("colStatus"), ctx.t("colVotes")],
        rows: list.map((g) => [new Date(g.at).toISOString().slice(0, 10), g.title, g.by, ctx.t(`status_${g.status}`), String(g.votes)]),
        rowIds: list.map((g) => g.id),
        rowActions: [...STATUSES.map((s) => ({ label: ctx.t("setTo", { status: ctx.t(`status_${s}`) }), action: `status_${s}` })), { label: ctx.t("actDelete"), action: "remove", confirm: ctx.t("confirmDelete"), danger: true }],
      },
    ];
  },

  adminActions: {
    ...Object.fromEntries(STATUSES.map((s) => [`status_${s}`, async (ctx, values) => {
      const record = values.id ? await ctx.api.store.get(values.id) : null;
      if (!record) return { error: ctx.t("errNotFound") };
      await ctx.api.store.update(record.id, { ...record.data, status: s });
      return { ok: ctx.t("okStatus") };
    }])),
    async remove(ctx, values) {
      if (!values.id || !(await ctx.api.store.get(values.id))) return { error: ctx.t("errNotFound") };
      await ctx.api.store.remove(values.id);
      return { ok: ctx.t("okDeleted") };
    },
  },

  mcp: {
    async game_suggestions_list(ctx, args) {
      return (await rows(ctx)).filter((g) => !args?.status || g.status === args.status).slice(0, num(args?.limit, 30, 1, 100))
        .map((g) => ({ id: g.id, title: g.title, status: g.status, submitter: g.by || null, note: g.note || null, replayVotes: g.votes, createdAt: new Date(g.at).toISOString() }));
    },
    async game_suggestions_set_status(ctx, args) {
      const record = typeof args?.id === "string" && args.id ? await ctx.api.store.get(args.id) : null;
      if (!record) throw Object.assign(new Error("suggestion not found"), { expose: true });
      if (!isStatus(args.status)) throw Object.assign(new Error("invalid status"), { expose: true });
      await ctx.api.store.update(record.id, { ...record.data, status: args.status });
      return { id: record.id, status: args.status };
    },
  },

  backup: {
    async readable(ctx) {
      const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
      const lines = (await rows(ctx)).map((g) => [g.id, new Date(g.at).toISOString(), g.status, g.title, g.by, g.note, g.votes].map(cell).join(","));
      return [{ path: "games.csv", content: `﻿${[["id", "date", "status", "game", "by", "note", "votes"].map(cell).join(","), ...lines].join("\r\n")}\r\n` }];
    },
  },

  hooks: {
    async onInstanceDelete(ctx) { for (const k of [...memory.keys()]) if (k.split("|")[1] === ctx.instance.key) memory.delete(k); },
  },
};
