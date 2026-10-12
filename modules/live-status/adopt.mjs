// Reprise des identifiants Twitch : dans l'admin de ce module, propose de les copier UNE fois dans la Chaîne Twitch.
// Un module n'écrit jamais dans les réglages d'un autre : la copie passe par le service `twitch.live` (méthode `adopt`), qui ne remplit que
// ses champs vides. Les valeurs ne sont ni affichées ni renvoyées ; le journal d'audit du cœur note l'action sans son contenu.
import { SERVICE, legacyOf, hasLegacy, providerInfo } from "./source.mjs";

const MARK = "adoption";
const FIELD_KEYS = { channel: "field_channel", clientId: "field_clientId", clientSecret: "field_clientSecret" };
const mark = async (ctx) => { try { return (await ctx.api.store.list(MARK, { limit: 1 }))[0] ?? null; } catch { return null; } };

/** Blocs d'admin : bandeau + bouton tant qu'il reste quelque chose à reprendre, sinon, une fois la reprise faite, une confirmation. */
export async function adoptPanel(ctx) {
  const legacy = legacyOf(ctx);
  if (!hasLegacy(legacy)) return [];
  const done = await mark(ctx);
  const info = await providerInfo(ctx);
  if (!info) return [{ type: "banner", tone: "warning", text: ctx.t("adoptUnavailable") }];
  const todo = (info.missing ?? []).filter((f) => legacy[f]);
  if (todo.length) {
    return [
      { type: "banner", tone: "info", text: ctx.t("adoptBanner") },
      { type: "adminForm", action: "adopt", submitLabel: ctx.t("adoptButton"), fields: [] },
    ];
  }
  return done ? [{ type: "banner", tone: "success", text: ctx.t("adoptDone") }] : [];
}

/** Action du bouton : idempotente, ne dit jamais une valeur. */
export async function adopt(ctx) {
  const legacy = legacyOf(ctx);
  if (!hasLegacy(legacy)) return { error: ctx.t("adoptNothing") };
  const r = await ctx.api.services.call(SERVICE, "adopt", legacy);
  if (!r.ok) return { error: ctx.t("adoptUnavailable") };
  const adopted = Array.isArray(r.value?.adopted) ? r.value.adopted.filter((f) => f in FIELD_KEYS) : [];
  if (adopted.length) {
    const doc = await mark(ctx);
    const data = { at: new Date().toISOString(), fields: adopted };
    if (doc) await ctx.api.store.update(doc.id, data); else await ctx.api.store.add(MARK, data);
  }
  return { ok: adopted.length ? ctx.t("adoptOk", { fields: adopted.map((f) => ctx.t(FIELD_KEYS[f])).join(", ") }) : ctx.t("adoptAlready"), redirect: "?" };
}
