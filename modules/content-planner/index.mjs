// Content notebook: a community module of Curiosa: your PRIVATE notebook of ideas for videos, articles and posts, with long documents (a script, in versions).
//
// No public page, no public route, no home section: nothing of this module is ever shown to visitors.
// The ideas live in the private storage of the instance (collection "ideas", one row per idea), their documents in the collection "ideaDocs". The module reads the data of no other module
// and depends on no other: networks are plain words that the person chooses, not links to the network modules.
//
// Files: data.mjs (data and rules, rhythm included), documents.mjs (documents: storage, limits, versions), view.mjs (screen pieces), admin.mjs (list, idea page, actions),
// docsAdmin.mjs (documents area, reading screen, windows), tools.mjs (AI assistant tools), export.mjs (CSV files and readable backup).
const v = new URL(import.meta.url).search; // the module version travels to the sibling files (otherwise the old code would stay in cache after an update)
const { default: admin } = await import(`./admin.mjs${v}`);
const { default: tools } = await import(`./tools.mjs${v}`);
const { downloads, backup } = await import(`./export.mjs${v}`);
const placeLinks = await import(`./placeLinks.mjs${v}`);

export default {
  ...admin, // adminPanel, adminActions
  // On a place page shared with another module the core reads each module's own namespace only and does not rewrite the links inside html blocks: see placeLinks.mjs.
  async adminPanel(ctx, o = {}) { const key = ctx.instance?.key; return placeLinks.scopeHtmlLinks(await admin.adminPanel(ctx, { query: placeLinks.unscopeQuery(o?.query, key) }), key); },
  ...tools, // mcp
  adminDownloads: downloads,
  backup,
  // No `tasks`, no `routes`, no `page`: everything is computed when the notebook is opened.
};
