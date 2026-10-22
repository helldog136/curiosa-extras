// Santé du site — une page d'administration « Vérifier maintenant » qui regarde ce que le site montre et le dit en phrases simples.
//
// Rien ne tourne en arrière-plan : une vérification part d'un clic (ou d'un appel explicite d'un assistant). Le module ne lit que ce que l'API des modules expose
// (rubriques, pages publiées, réglages publics du site) et ne modifie jamais le site : « Corriger » ouvre l'écran d'administration qui convient.
// Les visites de liens passent toutes par ctx.api.net, un site à la fois, par petits paquets. Voir probe.mjs (règles de sécurité) et run.mjs (déroulement).
import { readState, startCheck, continueCheck, ignoreItem, unignoreAll, fixTarget } from "./run.mjs";
import { panelBlocks, describe } from "./view.mjs";

// Les erreurs d'ici ne concernent aucun champ (les boutons n'ont rien à remplir) : un bandeau, avec quoi faire.
const stop = (message) => ({ error: message });

/** Le message qui suit un paquet de liens. */
const outcome = (ctx, r) => (r.busy ? stop(ctx.t("err_busy")) : r.none ? stop(ctx.t("err_nothing")) : { ok: r.finished ? ctx.t("ok_done") : ctx.t("ok_partial", { done: r.done, total: r.total }) });
async function guarded(ctx, work) {
  try { return outcome(ctx, await work()); } catch (e) { console.error("[site-check] vérification interrompue :", e?.message ?? e); return stop(ctx.t("err_failed")); }
}

export default {
  async adminPanel(ctx, { query } = {}) {
    return panelBlocks(ctx, await readState(ctx), query ?? {});
  },

  adminActions: {
    check: (ctx) => guarded(ctx, () => startCheck(ctx)),
    more: (ctx) => guarded(ctx, () => continueCheck(ctx)),
    async ignore(ctx, values) {
      const r = await ignoreItem(ctx, values.id);
      return r.gone ? stop(ctx.t("err_gone")) : r.full ? stop(ctx.t("err_ignored_full")) : { ok: ctx.t("ok_ignored") };
    },
    async unignore(ctx) { await unignoreAll(ctx); return { ok: ctx.t("ok_unignored") }; },
    async fix(ctx, values) {
      const to = await fixTarget(ctx, values.id);
      return to ? { redirect: to } : stop(ctx.t("err_gone"));
    },
  },

  mcp: {
    async site_health_status(ctx) {
      return describe(ctx, await readState(ctx));
    },
    async site_health_run(ctx, args) {
      const r = args?.continue === true ? await continueCheck(ctx) : await startCheck(ctx);
      if (r.busy) return { started: false, reason: "A check is already running. Try again in a minute." };
      if (r.none) return { started: false, reason: "There is no check in progress to continue. Call again without continue to start one." };
      return { started: true, finished: r.finished, linksChecked: r.done, linksTotal: r.total, report: describe(ctx, await readState(ctx)) };
    },
  },
};
