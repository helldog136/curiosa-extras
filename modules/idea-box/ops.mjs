// Boîte à idées — les gestes de la personne propriétaire (administration et assistant IA) : publier, refuser, changer de statut, fusionner, supprimer.
// Un seul endroit pour les deux : mêmes règles, même journal. Chaque geste rend { ok: true, ... } ou { error: "<code>" } ; jamais d'exception à cause des données.
const v = new URL(import.meta.url).search;   // chaque fichier voisin est importé avec la version du module (voir index.mjs)
const { DAY, MERGED_MAX, NICK_MAX, PURGE_BATCH, REPLY_MAX, TEXT_MIN, clean, isState, isStatus, linkCount, loadAll, norm, settings, toData } = await import(`./lib.mjs${v}`);

/** Écrit une ligne au journal du cœur, sans aucun texte du public ni pseudo. Ne lève jamais. */
export async function journal(ctx, action, id, data) {
  try { await ctx.api.log?.write({ action, target: id, ...(data ? { data } : {}) }); } catch { /* le journal est un plus */ }
}

const load = async (ctx, id) => {
  const row = typeof id === "string" && id ? await ctx.api.store.get(id) : null;
  return row ? norm(row) : null;
};
const save = (ctx, idea) => ctx.api.store.update(idea.id, toData(idea));

/** Efface les idées refusées depuis plus longtemps que le délai réglé : quelques-unes à chaque passage, jamais de minuteur. */
export async function purgeRefused(ctx, now = Date.now(), all) {
  const days = settings(ctx).keepRefusedDays;
  const list = all ?? await loadAll(ctx);
  const old = list.filter((i) => i.state === "refused" && Number.isFinite(Date.parse(i.refusedAt)) && now - Date.parse(i.refusedAt) > days * DAY).slice(0, PURGE_BATCH);
  for (const i of old) await ctx.api.store.remove(i.id);
  return old.length;
}

/** Publie (`published`), masque (`hidden`) ou refuse (`refused`) une idée. Refaire le même geste ne change rien. */
export async function setState(ctx, id, state, now = Date.now()) {
  if (!isState(state) || state === "pending") return { error: "state" };
  const idea = await load(ctx, id);
  if (!idea) return { error: "notFound" };
  if (idea.state !== state) {
    idea.state = state;
    idea.refusedAt = state === "refused" ? new Date(now).toISOString() : "";
    await save(ctx, idea);
    await journal(ctx, state === "published" ? "idea.published" : state === "refused" ? "idea.refused" : "idea.hidden", id);
  }
  return { ok: true, idea };
}

/**
 * Change le statut, la réponse et, si demandé, le texte, le pseudo et la visibilité. Valide tout avant d'écrire.
 * Rend `{ errors: { champ: "code" } }` sans rien écrire, ou `{ ok, idea, stateChanged, statusChanged }`.
 */
export async function saveIdea(ctx, id, input) {
  const idea = await load(ctx, id);
  if (!idea) return { error: "notFound" };
  const errors = {};
  const next = { ...idea };
  if (input.status !== undefined) { if (isStatus(input.status)) next.status = input.status; else errors.status = "status"; }
  if (input.reply !== undefined) {
    const reply = clean(input.reply);
    if (reply.length > REPLY_MAX) errors.reply = "replyLong"; else next.reply = reply;
  }
  if (input.text !== undefined) {
    const text = clean(input.text, true);
    if (text.length < TEXT_MIN) errors.text = "textEmpty";
    else if (text.length > settings(ctx).textMax) errors.text = "textLong";
    else next.text = text;
  }
  if (input.nick !== undefined) {
    const nick = clean(input.nick);
    if (nick.length > NICK_MAX) errors.nick = "nickLong"; else next.nick = linkCount(nick) ? "" : nick;
  }
  if (Object.keys(errors).length) return { errors: errors };
  if (input.visible === true && next.state !== "published") { next.state = "published"; next.refusedAt = ""; }
  else if (input.visible === false && next.state === "published") next.state = "hidden";
  const stateChanged = next.state !== idea.state, statusChanged = next.status !== idea.status;
  await save(ctx, next);
  if (stateChanged) await journal(ctx, next.state === "published" ? "idea.published" : "idea.hidden", id);
  if (statusChanged) await journal(ctx, "idea.status", id, { status: ctx.t(`status_${next.status}`) });
  return { ok: true, idea: next, stateChanged, statusChanged };
}

/** Fusionne `fromId` dans `intoId` : les soutiens s'additionnent, l'idée fusionnée disparaît, ses anciens soutiens ne comptent pas deux fois. */
export async function mergeIdeas(ctx, fromId, intoId) {
  if (!fromId || fromId === intoId) return { error: "same" };
  const from = await load(ctx, fromId), into = await load(ctx, intoId);
  if (!from || !into) return { error: "notFound" };
  if (into.state === "refused") return { error: "target" };
  into.votes += from.votes;
  into.merged = [...new Set([...into.merged, from.id, ...from.merged])].slice(-MERGED_MAX);
  if (!into.reply && from.reply) into.reply = from.reply;
  await save(ctx, into);
  await ctx.api.store.remove(from.id);
  await journal(ctx, "idea.merged", into.id);
  return { ok: true, idea: into, votes: into.votes };
}

export async function removeIdea(ctx, id) {
  const idea = await load(ctx, id);
  if (!idea) return { error: "notFound" };
  await ctx.api.store.remove(id);
  await journal(ctx, "idea.deleted", id);
  return { ok: true };
}

/** Nombre d'idées à relire. */
export const pendingCount = async (ctx) => (await loadAll(ctx)).filter((i) => i.state === "pending").length;

/** L'interrupteur « Publiée » : `on` dit l'état voulu (publier, ou masquer une idée publiée). Une idée à relire ou refusée ne change pas quand on éteint. */
export async function setVisible(ctx, id, on) {
  const idea = await load(ctx, id);
  if (!idea) return { error: "notFound" };
  if (on) return setState(ctx, id, "published");
  return idea.state === "published" ? setState(ctx, id, "hidden") : { ok: true, idea };
}
