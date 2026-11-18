// Les étapes pour ajouter un dock dans OBS : repliées (c'est une consigne, pas un état). Le gras des textes (**mot**) devient <strong>.
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const obsSteps = (ctx, keys) => {
  const line = (k) => `<li>${esc(ctx.t(k)).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</li>`;
  return `<details><summary>${esc(ctx.t("obs_how"))}</summary><ol>${keys.map(line).join("")}</ol></details>`;
};
