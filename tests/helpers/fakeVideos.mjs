// Faux fournisseurs du service `videos.library` pour les tests des modules qui le CONSOMMENT (par exemple un module d'événements qui lie une masterclass).
//   fakeVideosProvider(items)   un faux « pur » : même forme de réponses que le vrai service, rien d'autre. À passer à fakeCtx({ services: { "videos.library": … } }).
//   makeLibrary(opts)           la VRAIE vidéothèque branchée sur un faux contexte : { ctx, methods, services, add(...) } ; ses vidéos s'ajoutent avec add().
// Pannes à tester côté consommateur : service absent (ne pas le fournir), en panne (fakeVideosProvider.failing), lent (fakeVideosProvider.slow), réponse illisible (fakeVideosProvider.garbled).
import { ctxFor, def, seedVideos, id as vid } from "./videosKit.mjs";

/** items : [{ id, title, thumb?, url, category? }] */
export function fakeVideosProvider(items = []) {
  const shape = ({ id, title, thumb, url }) => ({ id: String(id), title, ...(thumb ? { thumb } : {}), url });
  return {
    async list({ limit = 20, cursor, q, category } = {}) {
      const n = Math.trunc(Number(limit));
      const lim = Number.isFinite(n) ? Math.min(50, Math.max(1, n)) : 20;
      let rows = items.filter((x) => (!category || x.category === category) && (!q || x.title.toLowerCase().includes(String(q).toLowerCase())));
      const from = cursor ? Math.max(0, rows.findIndex((x) => String(x.id) === String(cursor)) + 1) : 0;
      rows = rows.slice(from);
      const page = rows.slice(0, lim);
      return { ok: true, items: page.map(shape), ...(rows.length > lim ? { next: String(page[page.length - 1].id) } : {}) };
    },
    async get({ id } = {}) { const x = items.find((y) => String(y.id) === String(id)); return { ok: true, item: x ? shape(x) : null }; },
  };
}
fakeVideosProvider.failing = () => ({ list: async () => { throw new Error("boom"); }, get: async () => { throw new Error("boom"); } });
fakeVideosProvider.slow = (ms = 60_000) => ({ list: () => new Promise((r) => setTimeout(() => r({ ok: true, items: [] }), ms)), get: () => new Promise((r) => setTimeout(() => r({ ok: true, item: null }), ms)) });
fakeVideosProvider.garbled = () => ({ list: async () => "pas du json", get: async () => ({ ok: true, item: { title: 42 } }) });

/** La vraie vidéothèque, prête à servir : { ctx, methods, services, add(list) }. */
export function makeLibrary(settings = {}, opts = {}) {
  const ctx = ctxFor(settings, opts);
  const methods = Object.fromEntries(Object.entries(def.services["videos.library"]).map(([m, fn]) => [m, (args) => fn(ctx, args)]));
  return { ctx, methods, services: { "videos.library": methods }, add: (list) => seedVideos(ctx, list), id: vid };
}
