// Outils pour les assistants (MCP) : lister, créer et modifier des commandes. Jamais activés d'office (voir module.json). Pas de suppression, pas de secret, pas d'envoi de message.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { saveCommand, saveSourced } = await import(`./commands.mjs${v}`);
const { context, saveError } = await import(`./admin.mjs${v}`);
const st = await import(`./state.mjs${v}`);

const expose = (message) => Object.assign(new Error(message), { expose: true });
const view = (c) => ({
  kind: c.kind, name: c.name, aliases: c.aliases, text: c.text, enabled: c.enabled, role: c.role,
  state: c.state, ...(c.why ? { reason: c.why } : {}), delayAllSeconds: c.cdGlobal, delayPerPersonSeconds: c.cdUser,
  ...(c.kind === "partner" || c.kind === "network" ? { source: c.label } : {}),
});
const changes = (a) => {
  const f = {};
  if (a.newName !== undefined) f.name = a.newName;
  if (a.text !== undefined) f.text = a.text;
  if (a.aliases !== undefined) f.aliases = a.aliases;
  if (a.role !== undefined) f.role = a.role;
  if (a.enabled !== undefined) f.enabled = a.enabled;
  if (a.delayAllSeconds !== undefined) f.cdGlobal = a.delayAllSeconds;
  if (a.delayPerPersonSeconds !== undefined) f.cdUser = a.delayPerPersonSeconds;
  return f;
};

export default {
  async bot_commands_list(ctx, args) {
    const info = await context(ctx, { declare: false });
    const list = info.list.filter((c) => !args.kind || c.kind === args.kind);
    return { prefix: info.s.prefix, muted: await st.isMuted(ctx), commands: list.map(view) };
  },
  async bot_command_create(ctx, args) {
    const info = await context(ctx, { declare: false });
    const r = await saveCommand(ctx, { kind: "custom" }, { name: args.name, text: args.text, aliases: args.aliases ?? [], role: args.role ?? "everyone", enabled: args.enabled !== false, ...(args.delayAllSeconds !== undefined ? { cdGlobal: args.delayAllSeconds } : {}), ...(args.delayPerPersonSeconds !== undefined ? { cdUser: args.delayPerPersonSeconds } : {}) }, info.env);
    if (r.ok === false) throw expose(saveError(ctx, r));
    return { created: true, name: String(args.name).replace(info.s.prefix, "").toLowerCase() };
  },
  async bot_command_update(ctx, args) {
    const info = await context(ctx, { declare: false });
    const word = String(args.name).toLowerCase().replace(info.s.prefix, "");
    const c = info.list.find((x) => x.name === word || x.aliases.includes(word));
    if (!c) throw expose(`no command named "${word}"`);
    const f = changes(args);
    if (!Object.keys(f).length) throw expose("nothing to change");
    const r = c.kind === "partner" || c.kind === "network" ? await saveSourced(ctx, c.kind, c.id, f, info.env) : await saveCommand(ctx, { kind: c.kind, id: c.id }, f, info.env);
    if (r.ok === false) throw expose(saveError(ctx, r));
    return { updated: true, name: f.name ? String(f.name).toLowerCase().replace(info.s.prefix, "") : c.name };
  },
};
