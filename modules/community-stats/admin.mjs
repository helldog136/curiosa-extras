// Statistiques de la communauté — la page d'administration : vos chiffres, ce que vous montrez, la mise à jour, les comptes saisis à la main.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const { METRICS, DAY, periodKey, platformName, platformLabel } = await import(`./model.mjs${v}`);
const { loadStats, getStat, saveStat, removeStat, readRun } = await import(`./stats.mjs${v}`);
const { changesOf, evolutionPhrase, formatValue, ago, dateText, reasonText } = await import(`./evolution.mjs${v}`);
const { collectNow } = await import(`./collect.mjs${v}`);
const { setManual, staleManual } = await import(`./manual.mjs${v}`);

const OTHER = "__other";
const MANUAL_NETWORKS = ["Instagram", "TikTok", "X", "Facebook", "Threads", "Snapchat", "Pinterest", "LinkedIn", "Telegram"];
const sorted = (stats) => [...stats].sort((a, b) => platformName(a).localeCompare(platformName(b)) || a.account.localeCompare(b.account) || METRICS.indexOf(a.metric) - METRICS.indexOf(b.metric));
const title = (ctx, s) => `${platformName(s)} · ${s.account}`;

/** Le texte d'une carte : le chiffre, l'évolution en phrases, l'origine, et — s'il manque — pourquoi et quoi faire. */
async function describe(ctx, s, now) {
  const t = ctx.t;
  const known = s.lastValue != null;
  const figure = [title(ctx, s), `${t(`metric_${s.metric}`)} : ${known ? formatValue(ctx, s.lastValue) : "—"}`, t(s.visible ? "onSiteYes" : "onSiteNo")].join("\n");
  const lines = [];
  const broken = s.source === "auto" && s.state !== "ok";
  if (known) {
    const { week, month } = await changesOf(ctx, s);
    if (!week && !month) lines.push(evolutionPhrase(ctx, null, s.metric));
    if (week) lines.push(evolutionPhrase(ctx, week, s.metric));
    if (month) lines.push(evolutionPhrase(ctx, month, s.metric));
  }
  if (broken) {
    if (known) lines.push(t("lastKnown", { value: formatValue(ctx, s.lastValue), when: ago(ctx, s.lastAt, now) }));
    lines.push(t(known ? "noFigureSince" : "noFigureYet", { date: dateText(ctx, s.since ?? s.lastAt ?? now) }));
    lines.push(reasonText(ctx, s));
  } else if (known) lines.push(t(s.source === "manual" ? "originManual" : "originAuto", { when: ago(ctx, s.lastAt, now) }));
  return [figure, lines.join("\n")];
}

const platformOptions = (ctx) => [...MANUAL_NETWORKS.map((n) => ({ value: n, label: n })), { value: OTHER, label: ctx.t("networkOther") }];
const metricOptions = (ctx) => METRICS.map((m) => ({ value: m, label: ctx.t(`metric_${m}`) }));

function manualForm(ctx, stat) {
  const t = ctx.t;
  if (stat) {
    return { type: "adminForm", action: "saveManual", title: `${title(ctx, stat)} — ${t(`metric_${stat.metric}`)}`, submitLabel: t("saveManual"), cancelHref: "?",
      fields: [
        { name: "platform", kind: "hidden", value: platformName(stat) }, { name: "account", kind: "hidden", value: stat.account }, { name: "metric", kind: "hidden", value: stat.metric },
        { name: "value", label: t("fValue"), kind: "number", required: true, value: String(stat.lastValue ?? "") },
        { name: "date", label: t("fDate"), kind: "date", help: t("fDateHelp") },
      ] };
  }
  return { type: "adminForm", action: "saveManual", title: t("addManual"), submitLabel: t("saveManual"),
    fields: [
      { name: "platform", label: t("fNetwork"), kind: "select", options: platformOptions(ctx), value: "Instagram" },
      { name: "otherPlatform", label: t("fOtherNetwork"), help: t("fOtherNetworkHelp") },
      { name: "account", label: t("fAccount"), required: true, help: t("fAccountHelp") },
      { name: "metric", label: t("fMetric"), kind: "select", options: metricOptions(ctx), value: "followers" },
      { name: "value", label: t("fValue"), kind: "number", required: true },
      { name: "date", label: t("fDate"), kind: "date", help: t("fDateHelp") },
    ] };
}

export default {
  // Pastille du menu : seulement les rappels « chiffre saisi à la main devenu ancien » (jamais les pannes, qui se règlent d'elles-mêmes ou dans le module du réseau).
  async adminBadge(ctx) { return staleManual(await loadStats(ctx), Date.now()).length; },

  async adminPanel(ctx, { query, now = Date.now() } = {}) {
    const t = ctx.t;
    const stats = sorted(await loadStats(ctx));
    const manual = stats.filter((s) => s.source === "manual");
    if (query?.edit) {
      const stat = stats.find((s) => s.docId === query.edit && s.source === "manual");
      if (stat) return [{ type: "markdown", text: `[${t("back")}](?)` }, manualForm(ctx, stat)];
    }
    const run = (await readRun(ctx)).data;
    const blocks = [{ type: "heading", text: t("title") }, { type: "markdown", text: t("intro") }];
    blocks.push({ type: "markdown", text: [run.lastRunAt ? t("lastUpdate", { when: ago(ctx, run.lastRunAt, now) }) : t("neverUpdated"), t("autoEvery", { freq: t(`freq_${periodKey(ctx)}`) })].join(" ") });
    if (run.lastError) blocks.push({ type: "banner", tone: "warning", text: t("noticeLastFailed") });
    for (const s of staleManual(stats, now).slice(0, 5)) blocks.push({ type: "banner", tone: "warning", text: t("staleReminder", { platform: platformName(s), account: s.account, days: Math.floor((now - s.lastAt) / DAY) }) });

    blocks.push({ type: "adminForm", action: "refresh", submitLabel: t("updateNow"), fields: [] });

    blocks.push({ type: "heading", text: t("headingFigures") });
    const auto = stats.filter((s) => s.source === "auto");
    if (!stats.length) blocks.push({ type: "markdown", text: t("emptyAuto") });
    else {
      const rows = [];
      for (const s of stats) rows.push(await describe(ctx, s, now));
      blocks.push({ type: "table", columns: [t("colFigure"), t("colEvolution")], rows });
      blocks.push({ type: "heading", text: t("headingShow") });
      blocks.push({ type: "markdown", text: `${t("showHelp")} ${t("showComing")}` });
      blocks.push({ type: "adminForm", action: "saveVisibility", submitLabel: t("showSave"), fields: stats.map((s) => ({ name: `show_${s.docId}`, label: `${title(ctx, s)} — ${t(`metric_${s.metric}`)}`, kind: "select", value: s.visible ? "yes" : "no", options: [{ value: "no", label: t("showNo") }, { value: "yes", label: t("showYes") }] })) });
    }
    if (!auto.length && stats.length) blocks.push({ type: "markdown", text: t("emptyAutoShort") });

    blocks.push({ type: "heading", text: t("headingManual") }, { type: "markdown", text: t("manualHelp") });
    if (manual.length) blocks.push({ type: "table", columns: [t("colAccount"), t("colManualFigure")], rows: manual.map((s) => [`${title(ctx, s)}\n${t(`metric_${s.metric}`)}`, `${formatValue(ctx, s.lastValue)}\n${dateText(ctx, s.lastAt)}`]), rowIds: manual.map((s) => s.docId), rowActions: [{ label: t("actUpdate"), href: "?edit={id}" }, { label: t("actDelete"), action: "forget", confirm: t("confirmDeleteManual"), danger: true }] });
    else blocks.push({ type: "markdown", text: t("manualEmpty") });
    blocks.push(manualForm(ctx, null));

    const gone = auto.filter((s) => s.state === "missing");
    if (gone.length) {
      blocks.push({ type: "heading", text: t("headingGone") }, { type: "markdown", text: t("goneHelp") });
      blocks.push({ type: "table", columns: [t("colFigure")], rows: gone.map((s) => [`${title(ctx, s)}\n${t(`metric_${s.metric}`)}`]), rowIds: gone.map((s) => s.docId), rowActions: [{ label: t("actForget"), action: "forget", confirm: t("confirmForget"), danger: true }] });
    }
    blocks.push({ type: "markdown", text: `*${t("footerAdvanced")}*` });
    return blocks;
  },

  adminActions: {
    async refresh(ctx) {
      const r = await collectNow(ctx, { force: true });
      if (r.status === "tooSoon") return { error: ctx.t("updateTooSoon") };
      if (r.status === "busy") return { error: ctx.t("updateBusy") };
      if (r.status === "failed") return { error: ctx.t("updateFailed") };
      return { ok: ctx.t("updateDone"), redirect: "?" };
    },

    async saveVisibility(ctx, values) {
      for (const s of await loadStats(ctx)) {
        const choice = values[`show_${s.docId}`];
        if ((choice === "yes" || choice === "no") && (choice === "yes") !== (s.visible === true)) await saveStat(ctx, { ...s, visible: choice === "yes" });
      }
      return { ok: ctx.t("showSaved"), redirect: "?" };
    },

    async saveManual(ctx, values) {
      const platform = values.platform === OTHER ? values.otherPlatform : values.platform;
      try { await setManual(ctx, { platform, account: values.account, metric: values.metric, value: values.value, date: values.date }, { by: "admin" }); }
      catch (e) {
        if (!e?.code) throw e;
        return { error: ctx.t(`err_${e.code}`, { platform: platformLabel(String(platform ?? "").toLowerCase()) || String(platform ?? "") }) };
      }
      return { ok: ctx.t("manualSaved"), redirect: "?" };
    },

    async forget(ctx, values) {
      const stat = await getStat(ctx, values.id);
      if (!stat) return { error: ctx.t("notFound") };
      await removeStat(ctx, stat);
      return { ok: ctx.t("deleted"), redirect: "?" };
    },
  },
};
