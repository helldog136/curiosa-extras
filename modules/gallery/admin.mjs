// Galeries photos : l'administration. Deux onglets : « Mes albums » (albums, photos, point de départ) et « Retraits » (les demandes des visiteurs).
// Tout se fait avec des boutons : ordre par « Monter / Descendre », jamais de glisser-déposer obligatoire.
// L'envoi de plusieurs photos avec progression se fait dans une page à part (voir view.mjs, renderStudio) qui appelle les actions ci-dessous.

const { TEMPLATES, freshAlbums, getAlbum, getRow, hostsOf, limitsOf, loadMeta, loadPhotos, loadRequests, locked, purgeRequests, saveMeta, showDates, sortMode, usage } = await import(new URL(`./data.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
const { addExternalPhoto, addUploadedPhoto, closeRequest, createAlbum, deleteAlbum, deletePhoto, hidePhoto, movePhoto, moveAlbum, setCover, setStatus, updateAlbum, updatePhoto } = await import(new URL(`./ops.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
const { HARD, clean, dayLabel, esc, httpsUrl, megabytes, plainText } = await import(new URL(`./text.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
const { albumHref, imgSrc, pageHref, previewHref, studioHref } = await import(new URL(`./view.mjs${new URL(import.meta.url).search}`, import.meta.url).href);

const can = (ctx, right) => typeof ctx.can === "function" && ctx.can(right) === true;
const here = (ctx) => `/admin/instances/${ctx.instance.id}`;
const ADMIN_PAGE = 50;
const PHOTO_ID = /^[a-z0-9]{4,24}$/;

/** « albumId.photoId » (la ligne d'un tableau ne porte qu'un identifiant). */
const joinId = (a, p) => `${a}.${p}`;
function splitId(value) {
  const [a, p, ...rest] = String(value ?? "").split(".");
  return a && p && !rest.length && /^[A-Za-z0-9_-]{1,80}$/.test(a) && PHOTO_ID.test(p) ? { album: a, photo: p } : null;
}

function fullUrl(ctx, path) {
  return path === null || path === undefined ? "" : `${ctx.api.siteUrl}${path === "/" ? "" : path}`;
}

const SMALL = `<style>.ga-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(5.5rem,1fr));gap:.5rem;margin:0 0 1rem;padding:0;list-style:none}.ga-grid li{position:relative;aspect-ratio:1;overflow:hidden;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:8px}.ga-grid img{display:block;width:100%;height:100%;object-fit:cover}.ga-n{position:absolute;left:.25rem;top:.25rem;min-width:1.5rem;padding:0 .35rem;border-radius:999px;background:#000c;color:#fff;font-size:.8rem;text-align:center}.ga-flag{position:absolute;left:0;right:0;bottom:0;padding:.1rem .25rem;background:#000c;color:#fff;font-size:.7rem;text-align:center}.ga-hid img{opacity:.35}.ga-prev{display:block;max-width:100%;max-height:14rem;margin:0 0 1rem;border-radius:8px}</style>`;

function thumbSrc(ctx, a, p) {
  return imgSrc(ctx, p, "thumb");
}

function photoGrid(ctx, a, photos, offset) {
  const lis = photos.map((p, i) => `<li class="${p.hidden ? "ga-hid" : ""}"><span class="ga-n">${offset + i + 1}</span><img src="${thumbSrc(ctx, a, p)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">${p.hidden ? `<span class="ga-flag">${esc(ctx.t("aHidden"))}</span>` : ""}</li>`);
  return { type: "html", html: `${SMALL}<ul class="ga-grid">${lis.join("")}</ul>` };
}

const extraActions = (ctx, label, id, rowActions, column = "colOther") => ({ type: "table", columns: [ctx.t(column)], rows: [[label]], rowIds: [id], rowActions });

// ── Les formulaires ──────────────────────────────────────────────────────────────────────────────────────────────────

function albumForm(ctx, a, publisher) {
  const fields = [
    { name: "id", kind: "hidden", label: "id", value: a?.id ?? "" },
    { name: "title", label: ctx.t("fTitle"), value: a?.title ?? "", help: ctx.t("fTitleHelp") },
    { name: "date", kind: "date", label: ctx.t("fDate"), value: a?.date ?? "", help: ctx.t("fDateHelp") },
    { name: "desc", kind: "textarea", label: ctx.t("fDesc"), value: a?.desc ?? "", help: ctx.t("fDescHelp") },
    {
      name: "mode", kind: "select", label: ctx.t("fMode"), value: a?.mode ?? "hosted", help: ctx.t("fModeHelp"),
      options: [{ value: "hosted", label: ctx.t("modeHosted") }, { value: "external", label: ctx.t("modeExternal") }],
    },
    { name: "link", kind: "url", label: ctx.t("fLink"), value: a?.link ?? "", help: ctx.t("fLinkHelp") },
  ];
  if (publisher || !a) {
    fields.push({
      name: "status", kind: "select", label: ctx.t("fState"), value: a?.status ?? "draft", help: ctx.t("fStateHelp"),
      options: [{ value: "draft", label: ctx.t("stateDraft") }, ...(publisher ? [{ value: "published", label: ctx.t("statePublished") }] : [])],
    });
  }
  return { type: "adminForm", action: "saveAlbum", title: ctx.t(a ? "editAlbumTitle" : "newAlbumTitle"), submitLabel: ctx.t("save"), cancelHref: "?", fields };
}

function photoForm(ctx, a, p) {
  return {
    type: "adminForm", action: "savePhoto", title: ctx.t("editPhotoTitle"), submitLabel: ctx.t("save"), cancelHref: `?album=${a.id}`,
    fields: [
      { name: "id", kind: "hidden", label: "id", value: joinId(a.id, p.id) },
      { name: "caption", label: ctx.t("fCaption"), value: p.caption, help: ctx.t("fCaptionHelp") },
      { name: "alt", kind: "textarea", label: ctx.t("fAlt"), value: p.alt, help: ctx.t("fAltHelp") },
      { name: "hidden", kind: "checkbox", label: ctx.t("fHidden"), value: p.hidden ? "on" : "", help: ctx.t("fHiddenHelp") },
    ],
  };
}

function urlForm(ctx, a) {
  return {
    type: "adminForm", action: "addByUrl", title: ctx.t("byUrlTitle"), submitLabel: ctx.t("byUrlAdd"),
    fields: [
      { name: "album", kind: "hidden", label: "album", value: a.id },
      { name: "url", kind: "url", label: ctx.t("fPhotoUrl"), help: ctx.t("fPhotoUrlHelp", { hosts: hostsOf(ctx).join(", ") }) },
      { name: "caption", label: ctx.t("fCaption"), help: ctx.t("fCaptionHelp") },
      { name: "alt", kind: "textarea", label: ctx.t("fAlt"), help: ctx.t("fAltHelp") },
    ],
  };
}

// ── Le panneau ───────────────────────────────────────────────────────────────────────────────────────────────────────

function starter(ctx) {
  return [
    { type: "heading", text: ctx.t("starterTitle") },
    { type: "markdown", text: ctx.t("starterHelp") },
    {
      type: "table", columns: [ctx.t("starterCol")],
      rows: Object.keys(TEMPLATES).map((id) => [`${ctx.t(`tpl_${id}_name`)}\n${ctx.t(`tpl_${id}_about`)}`]),
      rowIds: Object.keys(TEMPLATES),
      rowActions: [{ label: ctx.t("starterPick"), action: "chooseTemplate" }],
    },
  ];
}

function usageLine(ctx, albums) {
  const u = usage(albums);
  const l = limitsOf(ctx);
  return ctx.t("usageLine", { albums: u.albums, maxAlbums: l.albums, photos: u.photos, maxPhotos: l.totalPhotos });
}

export async function adminPanel(ctx, { query } = {}) {
  const q = query ?? {};
  try { await purgeRequests(ctx); } catch { /* le ménage se refera à la prochaine visite */ }
  const [meta, albums, requests] = await Promise.all([loadMeta(ctx), freshAlbums(ctx, "date"), loadRequests(ctx)]);
  const sort = sortMode(ctx, meta);
  const ordered = sort === "manual" ? [...albums].sort((a, b) => a.pos - b.pos) : albums;
  const editor = can(ctx, "edit");
  const publisher = can(ctx, "publish");
  const handler = can(ctx, "requests");
  const blocks = [];
  const fresh = requests.filter((r) => r.status === "new");
  const root = pageHref(ctx);

  // ── Onglet « Retraits » ─────────────────────────────────────────────────────────
  const tab = "requests";
  blocks.push({ type: "heading", text: ctx.t("reqTitle", { count: fresh.length }), tab });
  blocks.push({ type: "markdown", text: ctx.t(requests.length ? "reqHelp" : "reqNone", { days: 30 }), tab });
  const row = (r) => {
    const a = albums.find((x) => x.id === r.album);
    return [`${r.label || ctx.t("reqNoLabel")}\n${plainText(r.message, 200)}\n${[dayLabel(new Date(r.at).toISOString().slice(0, 10), ctx.locale), r.contact ? ctx.t("reqContact", { contact: r.contact }) : "", a ? "" : r.album ? ctx.t("reqGone") : ""].filter(Boolean).join(" · ")}`];
  };
  if (fresh.length) {
    const actions = [];
    if (handler) actions.push({ label: ctx.t("reqMask"), action: "maskRequest", confirm: ctx.t("reqMaskConfirm") });
    blocks.push({ type: "table", columns: [ctx.t("reqCol")], rows: fresh.map(row), rowIds: fresh.map((r) => r.id), rowActions: actions, tab });
    // « Écarter » est sous la liste : une seule action par ligne reste lisible sur un téléphone.
    if (handler) blocks.push({ type: "table", columns: [ctx.t("colOther")], rows: fresh.map((r) => [r.label || ctx.t("reqNoLabel")]), rowIds: fresh.map((r) => r.id), rowActions: [{ label: ctx.t("reqDismiss"), action: "dismissRequest", confirm: ctx.t("reqDismissConfirm"), danger: true }], tab });
    blocks.push({ type: "markdown", text: ctx.t("reqMaskHelp"), tab });
  }
  const done = requests.filter((r) => r.status !== "new");
  if (done.length) {
    blocks.push({ type: "heading", text: ctx.t("reqDoneTitle", { count: done.length }), tab });
    blocks.push({ type: "table", columns: [ctx.t("reqCol")], rows: done.map((r) => [`${r.label || ctx.t("reqNoLabel")}\n${ctx.t(r.status === "done" ? "reqDone" : "reqDismissed")}`]), rowIds: done.map((r) => r.id), rowActions: handler ? [{ label: ctx.t("reqErase"), action: "eraseRequest", confirm: ctx.t("reqEraseConfirm"), danger: true }] : [], tab });
  }

  // ── Onglet « Mes albums » ───────────────────────────────────────────────────────
  if (fresh.length) blocks.push({ type: "banner", tone: "warning", text: ctx.t("bannerRequests", { count: fresh.length }), href: `${here(ctx)}?tab=requests` });
  if (root === null) blocks.push({ type: "banner", tone: "warning", text: ctx.t("noPageBanner") });

  // Ordre des albums (tri manuel)
  if (editor && q.order === "albums" && ordered.length > 1) {
    blocks.push({ type: "heading", text: ctx.t("orderAlbumsTitle") });
    blocks.push({ type: "markdown", text: ctx.t("orderHelp") });
    blocks.push({ type: "table", columns: [ctx.t("colAlbum")], rows: ordered.map((a, n) => [`${n + 1}. ${a.title}`]), rowIds: ordered.map((a) => a.id), rowActions: [{ label: ctx.t("actUp"), action: "albumUp" }, { label: ctx.t("actDown"), action: "albumDown" }] });
    blocks.push({ type: "links", items: [{ label: ctx.t("orderDone"), href: here(ctx) }] });
    return blocks;
  }

  const current = typeof q.album === "string" ? await getAlbum(ctx, q.album) : null;
  if (current) return albumView(ctx, current, q, { editor, publisher, handler }, blocks);

  if (!meta.template && !albums.length && editor) blocks.push(...starter(ctx));

  if (editor) {
    const wanted = typeof q.edit === "string" ? albums.find((a) => a.id === q.edit) : null;
    if (wanted) {
      blocks.push(albumForm(ctx, wanted, publisher));
      blocks.push(extraActions(ctx, wanted.title, wanted.id, [{ label: ctx.t("actDeleteAlbum"), action: "removeAlbum", confirm: ctx.t("confirmDeleteAlbum"), danger: true }]));
    } else if (q.new) blocks.push(albumForm(ctx, null, publisher));
  }

  const links = [];
  if (editor) links.push({ label: ctx.t("linkNew"), href: `${here(ctx)}?new=1` });
  if (root !== null) links.push({ label: ctx.t("linkSee"), href: root });
  if (editor && sort === "manual" && albums.length > 1) links.push({ label: ctx.t("linkOrderAlbums"), href: `${here(ctx)}?order=albums` });
  if (links.length) blocks.push({ type: "links", items: links });
  if (root !== null) blocks.push({ type: "copy", label: ctx.t("copyLabel"), text: fullUrl(ctx, root) || ctx.api.siteUrl });

  if (albums.length) {
    blocks.push({ type: "markdown", text: usageLine(ctx, albums) });
    blocks.push({ type: "heading", text: ctx.t("albumsTitle", { count: albums.length }) });
    if (sort === "date" && albums.length > 1 && editor) blocks.push({ type: "markdown", text: ctx.t("sortHint") });
    const dates = showDates(ctx, meta);
    blocks.push({
      type: "table", columns: [ctx.t("colAlbum")],
      rows: ordered.map((a) => [`${a.title}\n${[ctx.t(a.status === "published" ? "statePublishedShort" : "stateDraftShort"), a.mode === "external" ? ctx.t("modeExternalShort") : countText(ctx, a.total, a.total - a.shown), dates ? dayLabel(a.date, ctx.locale) : ""].filter(Boolean).join(" · ")}`]),
      rowIds: ordered.map((a) => a.id),
      rowActions: [{ label: ctx.t("actOpen"), href: "?album={id}" }, ...(editor ? [{ label: ctx.t("actEdit"), href: "?edit={id}" }] : [])],
    });
  } else if (meta.template || !editor) {
    blocks.push({ type: "markdown", text: ctx.t("albumsNone") });
  }
  if (editor && meta.template && albums.length) blocks.push({ type: "links", items: [{ label: ctx.t("linkStarter"), href: `${here(ctx)}?starter=1` }] });
  if (editor && q.starter) blocks.push(...starter(ctx));
  return blocks;
}

function countText(ctx, total, hidden) {
  const base = total === 1 ? ctx.t("countOne") : total === 0 ? ctx.t("countNone") : ctx.t("countMany", { n: total });
  return hidden > 0 ? `${base} (${ctx.t("hiddenCount", { n: hidden })})` : base;
}

/** Ce module garde-t-il le fichier de cette photo (envoyée depuis la 0.2.13) ? Faux pour une ancienne photo. */
async function ownsFile(ctx, url) {
  try { return (await ctx.api.files.owns(url)) === true; } catch { return false; }
}

async function albumView(ctx, a, q, rights, blocks) {
  const { editor, publisher } = rights;
  const photos = await loadPhotos(ctx, a);
  const limits = limitsOf(ctx);
  const pg = Math.max(1, Math.min(Math.ceil(photos.length / ADMIN_PAGE) || 1, Number(q.pg) || 1));
  const offset = (pg - 1) * ADMIN_PAGE;
  const part = photos.slice(offset, offset + ADMIN_PAGE);
  const base = `${here(ctx)}?album=${a.id}`;

  blocks.push({ type: "links", items: [{ label: ctx.t("backToAlbums"), href: here(ctx) }] });
  blocks.push({ type: "heading", text: a.title });
  blocks.push({ type: "markdown", text: `${ctx.t(a.status === "published" ? "statePublished" : "stateDraft")} · ${a.mode === "external" ? ctx.t("modeExternalShort") : countText(ctx, a.total, a.total - a.shown)}` });

  // La photo demandée
  const asked = splitId(q.photo);
  const wanted = asked && asked.album === a.id ? photos.find((p) => p.id === asked.photo) : null;
  if (wanted && editor) {
    blocks.push({ type: "html", html: `${SMALL}<img class="ga-prev" src="${imgSrc(ctx, wanted, "full")}" alt="${esc(wanted.alt)}" referrerpolicy="no-referrer">` });
    blocks.push(photoForm(ctx, a, wanted));
    if (wanted.full && !(await ownsFile(ctx, wanted.full))) blocks.push({ type: "markdown", text: ctx.t("legacyPhotoNote") });
    const rows = [{ label: ctx.t("actCover"), action: "makeCover" }, { label: ctx.t("actDeletePhoto"), action: "removePhoto", confirm: ctx.t("confirmDeletePhoto"), danger: true }];
    blocks.push(extraActions(ctx, wanted.caption || wanted.name || ctx.t("noCaption"), joinId(a.id, wanted.id), rows));
    return blocks;
  }

  // Ordre des photos
  if (editor && q.order === "1" && photos.length > 1) {
    blocks.push({ type: "heading", text: ctx.t("orderPhotosTitle") });
    blocks.push({ type: "markdown", text: ctx.t("orderHelp") });
    blocks.push({
      type: "table", columns: [ctx.t("colPhoto")], rows: part.map((p, i) => [`${offset + i + 1}. ${p.caption || p.name || ctx.t("noCaption")}`]), rowIds: part.map((p) => joinId(a.id, p.id)),
      rowActions: [{ label: ctx.t("actUp"), action: "photoUp" }, { label: ctx.t("actDown"), action: "photoDown" }, { label: ctx.t("actFirst"), action: "photoFirst" }],
    });
    blocks.push(...pager(ctx, `${base}&order=1`, pg, photos.length));
    blocks.push({ type: "links", items: [{ label: ctx.t("orderDone"), href: base }] });
    return blocks;
  }

  const links = [];
  const studio = studioHref(ctx, a);
  if (editor && studio) links.push({ label: ctx.t("linkAddPhotos"), href: studio });
  if (editor) links.push({ label: ctx.t("linkEditAlbum"), href: `${here(ctx)}?edit=${a.id}` });
  const preview = previewHref(ctx, a);
  const live = a.status === "published" ? albumHref(ctx, a, false) : null;
  if (live) links.push({ label: ctx.t("linkSeeAlbum"), href: live });
  else if (preview) links.push({ label: ctx.t("linkPreview"), href: preview });
  if (editor && photos.length > 1) links.push({ label: ctx.t("linkOrderPhotos"), href: `${base}&order=1` });
  blocks.push({ type: "links", items: links });
  if (publisher) {
    blocks.push(extraActions(ctx, a.status === "published" ? ctx.t("pubLabelOn") : ctx.t("pubLabelOff"), a.id, [a.status === "published" ? { label: ctx.t("actUnpublish"), action: "unpublish", confirm: ctx.t("confirmUnpublish") } : { label: ctx.t("actPublish"), action: "publish" }], "colState"));
  }
  if (a.mode === "external") {
    blocks.push({ type: "markdown", text: ctx.t(a.link ? "externalAlbumHelp" : "externalAlbumNoLink") });
    blocks.push({ type: "markdown", text: ctx.t("externalCoverHelp") });
  }
  blocks.push({ type: "markdown", text: ctx.t("albumRoom", { count: photos.length, max: limits.photos }) });

  if (photos.length) {
    const missing = photos.filter((p) => !p.alt).length;
    if (missing) blocks.push({ type: "banner", tone: "info", text: ctx.t("altMissing", { count: missing }) });
    blocks.push(photoGrid(ctx, a, part, offset));
    blocks.push({
      type: "table", columns: [ctx.t("colPhoto")],
      rows: part.map((p, i) => [`${offset + i + 1}. ${p.caption || p.name || ctx.t("noCaption")}\n${[p.hidden ? ctx.t("aHidden") : "", a.cover === p.id ? ctx.t("aCover") : "", p.alt ? "" : ctx.t("aNoAlt"), p.url && !p.full ? ctx.t("aElsewhere") : ""].filter(Boolean).join(" · ")}`]),
      rowIds: part.map((p) => joinId(a.id, p.id)),
      rowActions: editor ? [{ label: ctx.t("actEdit"), href: `?album=${a.id}&photo={id}` }, { label: ctx.t("actToggle"), action: "toggleHidden" }] : [],
    });
    blocks.push(...pager(ctx, base, pg, photos.length));
  } else {
    blocks.push({ type: "markdown", text: ctx.t("photosNone") });
  }
  if (editor && hostsOf(ctx).length) blocks.push(urlForm(ctx, a));
  return blocks;
}

/** Les liens « page précédente / suivante » d'une longue liste (50 par page), ou rien. */
function pager(ctx, base, pg, total) {
  const pages = Math.ceil(total / ADMIN_PAGE);
  if (pages <= 1) return [];
  const items = [];
  if (pg > 1) items.push({ label: ctx.t("pagePrev"), href: `${base}&pg=${pg - 1}` });
  if (pg < pages) items.push({ label: ctx.t("pageNext"), href: `${base}&pg=${pg + 1}` });
  return [{ type: "markdown", text: ctx.t("pageOf", { n: pg, total: pages }) }, { type: "links", items }];
}

/** Menu de l'admin : le nombre de demandes de retrait qui attendent. */
export async function adminBadge(ctx) {
  return (await loadRequests(ctx)).filter((r) => r.status === "new").length;
}

// ── Les actions ──────────────────────────────────────────────────────────────────────────────────────────────────────

const REASONS = {
  not_found: "errNotFound", title: "errTitle", link_needed: "errLinkNeeded", full_albums: "errFullAlbums", full_photos: "errFullPhotos", full_total: "errFullTotal", bad_upload: "errBadUpload", duplicate: "errDuplicate",
  bad_url: "errBadUrl", no_hosts: "errNoHosts", host_not_allowed: "errHostNotAllowed", cover_hidden: "errCoverHidden",
};
const FILE_REASONS = {
  expired: "errFileExpired", taken: "errFileTaken", "not-uploader": "errFileNotUploader", quota: "errFileQuota", unknown: "errFileUnknown", invalid: "errBadUpload",
  missing: "errFileMissing", "no-person": "errFileNoPerson", "no-permission": "errFileNoPermission",
};
/** Une phrase pour un refus de `ops`. */
export function reasonText(ctx, r) {
  if (r.error === "file") return ctx.t(FILE_REASONS[r.reason] || "errGeneric"); // le cœur a refusé de confier le fichier au module (motifs de `files.claim`)
  const key = REASONS[r.error];
  return ctx.t(key || "errGeneric", { max: r.max ?? "", hosts: hostsOf(ctx).join(", ") });
}

async function chooseTemplate(ctx, values) {
  const id = String(values.id ?? "");
  if (!TEMPLATES[id]) return { error: ctx.t("errNotFound") };
  return locked(ctx, async () => {
    await saveMeta(ctx, id);
    const albums = await freshAlbums(ctx);
    if (!albums.length) {
      const seeds = id === "retro" ? ["hosted", "external"] : id === "portfolio" ? ["hosted"] : [];
      for (const mode of seeds) {
        await createAlbum(ctx, { title: ctx.t(mode === "external" ? "seedExternal" : `seed_${id}`), desc: ctx.t(mode === "external" ? "seedExternalDesc" : "seedDesc"), mode, link: mode === "external" ? "https://photos.example.org/mon-album" : "", status: "draft" });
      }
    }
    return { ok: ctx.t("okStarter"), redirect: "?" };
  });
}

async function saveAlbum(ctx, values) {
  const errors = {};
  const title = clean(values.title, HARD.title);
  if (!title) errors.title = ctx.t("errTitle");
  const mode = values.mode === "external" ? "external" : "hosted";
  const link = httpsUrl(values.link);
  if (String(values.link ?? "").trim() && !link) errors.link = ctx.t("errLinkBad");
  else if (mode === "external" && !link) errors.link = ctx.t("errLinkNeeded");
  if (String(values.date ?? "").trim() && !/^\d{4}-\d{2}-\d{2}$/.test(String(values.date).trim())) errors.date = ctx.t("errDate");
  if (Object.keys(errors).length) return { errors };
  return locked(ctx, async () => {
    const id = typeof values.id === "string" ? values.id : "";
    const wantsPublished = values.status === "published";
    if (id) {
      const a = await getAlbum(ctx, id);
      if (!a) return { error: ctx.t("errNotFound") };
      const r = await updateAlbum(ctx, id, values);
      if (!r.ok) return { error: reasonText(ctx, r) };
      if (values.status !== undefined && (a.status === "published") !== wantsPublished) {
        if (!can(ctx, "publish")) return { errors: { status: ctx.t("errNoPublishRight") } };
        await setStatus(ctx, id, wantsPublished ? "published" : "draft");
      }
      return { ok: ctx.t("okSaved"), redirect: `?album=${id}` };
    }
    if (wantsPublished && !can(ctx, "publish")) return { errors: { status: ctx.t("errNoPublishRight") } };
    const r = await createAlbum(ctx, values);
    if (!r.ok) return { error: reasonText(ctx, r) };
    return { ok: ctx.t("okAlbumCreated"), redirect: `?album=${r.id}` };
  });
}

async function setAlbumStatus(ctx, values, status) {
  return locked(ctx, async () => {
    const a = await getAlbum(ctx, values.id);
    if (!a) return { error: ctx.t("errNotFound") };
    if (status === "published" && a.mode === "external" && !a.link) return { error: ctx.t("errLinkNeeded") };
    await setStatus(ctx, a.id, status);
    return { ok: ctx.t(status === "published" ? "okPublished" : "okUnpublished") };
  });
}

/** Ce qui est arrivé aux fichiers, en mots simples : supprimés, gardés parce que la photo date d'avant la 0.2.13, ou pas supprimés pour l'instant. Vide s'il n'y avait rien à dire. */
function filesNote(ctx, files, kind) {
  if (!files) return "";
  const parts = [];
  if (files.removed) parts.push(ctx.t(kind === "photo" ? "okFilesGonePhoto" : "okFilesGoneAlbum"));
  if (files.legacy) parts.push(ctx.t(kind === "photo" ? "okFilesOldPhoto" : "okFilesOldAlbum", { n: files.legacy }));
  if (files.failed) parts.push(ctx.t("okFilesFailed", { n: files.failed }));
  return parts.length ? ` ${parts.join(" ")}` : "";
}

async function removeAlbum(ctx, values) {
  return locked(ctx, async () => {
    const r = await deleteAlbum(ctx, values.id);
    return r.ok ? { ok: `${ctx.t("okAlbumDeleted")}${filesNote(ctx, r.files, "album")}`, redirect: "?" } : { error: reasonText(ctx, r) };
  });
}

async function moveAlbumBy(ctx, values, step) {
  return locked(ctx, async () => {
    const r = await moveAlbum(ctx, values.id, step);
    if (!r.ok) return { error: reasonText(ctx, r) };
    return { ok: ctx.t(r.edge ? (step < 0 ? "okFirst" : "okLast") : "okMoved") };
  });
}

async function savePhoto(ctx, values) {
  const ids = splitId(values.id);
  if (!ids) return { error: ctx.t("errNotFound") };
  return locked(ctx, async () => {
    const r = await updatePhoto(ctx, ids.album, ids.photo, { caption: values.caption, alt: values.alt, hidden: values.hidden === "on" });
    return r.ok ? { ok: ctx.t("okSaved"), redirect: `?album=${ids.album}` } : { error: reasonText(ctx, r) };
  });
}

async function toggleHidden(ctx, values) {
  const ids = splitId(values.id);
  if (!ids) return { error: ctx.t("errNotFound") };
  return locked(ctx, async () => {
    const a = await getAlbum(ctx, ids.album);
    const p = a ? (await loadPhotos(ctx, a)).find((x) => x.id === ids.photo) : null;
    if (!p) return { error: ctx.t("errNotFound") };
    const r = await hidePhoto(ctx, ids.album, ids.photo, !p.hidden);
    return r.ok ? { ok: ctx.t(p.hidden ? "okShown" : "okHidden") } : { error: reasonText(ctx, r) };
  });
}

async function movePhotoBy(ctx, values, how) {
  const ids = splitId(values.id);
  if (!ids) return { error: ctx.t("errNotFound") };
  return locked(ctx, async () => {
    const r = await movePhoto(ctx, ids.album, ids.photo, how);
    if (!r.ok) return { error: reasonText(ctx, r) };
    return { ok: ctx.t(r.edge ? (how === "first" || how < 0 ? "okFirst" : "okLast") : "okMoved") };
  });
}

async function makeCover(ctx, values) {
  const ids = splitId(values.id);
  if (!ids) return { error: ctx.t("errNotFound") };
  return locked(ctx, async () => {
    const r = await setCover(ctx, ids.album, ids.photo);
    return r.ok ? { ok: ctx.t("okCover"), redirect: `?album=${ids.album}` } : { error: reasonText(ctx, r) };
  });
}

async function removePhoto(ctx, values) {
  const ids = splitId(values.id);
  if (!ids) return { error: ctx.t("errNotFound") };
  return locked(ctx, async () => {
    const r = await deletePhoto(ctx, ids.album, ids.photo);
    return r.ok ? { ok: `${ctx.t("okPhotoDeleted")}${filesNote(ctx, r.files, "photo")}`, redirect: `?album=${ids.album}` } : { error: reasonText(ctx, r) };
  });
}

async function addByUrl(ctx, values) {
  const errors = {};
  if (!httpsUrl(values.url)) errors.url = ctx.t("errBadUrl");
  if (Object.keys(errors).length) return { errors };
  return locked(ctx, async () => {
    const r = await addExternalPhoto(ctx, values.album, { url: values.url, caption: values.caption, alt: values.alt, hidden: false });
    if (r.ok) return { ok: ctx.t("okPhotoAdded"), redirect: `?album=${values.album}` };
    if (r.error === "bad_url" || r.error === "host_not_allowed" || r.error === "no_hosts") return { errors: { url: reasonText(ctx, r) } };
    return { error: reasonText(ctx, r) };
  });
}

// ── L'envoi de photos (la page d'envoi envoie chaque fichier au cœur, puis appelle ces actions) ─────────────────────────────────────

/** Les bornes et le titre de l'album, pour la page d'envoi. Réservé à l'équipe (le cœur vérifie le droit avant d'arriver ici). */
async function studioInfo(ctx, values) {
  const a = await getAlbum(ctx, values.album);
  if (!a) return { error: ctx.t("errNotFound") };
  const limits = limitsOf(ctx);
  const photos = await loadPhotos(ctx, a);
  const total = usage(await freshAlbums(ctx)).photos;
  const info = {
    title: a.title,
    count: photos.length,
    max: limits.photos,
    kb: Math.round(limits.photoBytes / 1000),
    side: limits.side,
    thumbSide: limits.thumbSide,
    thumbBytes: limits.thumbBytes,
    room: Math.max(0, Math.min(limits.photos - photos.length, limits.totalPhotos - total)),
    back: `${here(ctx)}?album=${a.id}`,
  };
  return { ok: JSON.stringify(info) };
}

/**
 * Une photo déjà envoyée par la page d'envoi au mécanisme d'envoi du CŒUR (une grande, une miniature) : le module ne reçoit que leurs adresses `/uploads/…`.
 * Il ne peut pas relire les fichiers (aucun accès aux fichiers pour un module) : il vérifie la forme des adresses et rogne les tailles annoncées.
 * Le cœur a déjà vérifié le type par le contenu et la taille (5 Mo) ; le navigateur a ré-encodé les images (plus d'informations cachées) et les pages publiques
 * n'affichent que la version propre fabriquée par le cœur.
 */
async function addPhoto(ctx, values) {
  const a = await getAlbum(ctx, values.album);
  if (!a) return { error: ctx.t("errNotFound") };
  return locked(ctx, async () => {
    const r = await addUploadedPhoto(ctx, a.id, { full: values.full, thumb: values.thumb, w: values.w, h: values.h, bytes: values.bytes, tbytes: values.tbytes, name: values.name, caption: values.caption, alt: values.alt, hidden: false });
    if (r.ok) return { ok: ctx.t("okPhotoAdded") };
    const message = reasonText(ctx, r);
    return { error: message, errors: { photo: message } };
  });
}

// ── Demandes de retrait ──────────────────────────────────────────────────────────────────────────────────────────────

async function maskRequest(ctx, values) {
  return locked(ctx, async () => {
    const row = await getRow(ctx, values.id, "request");
    if (!row) return { error: ctx.t("errNotFound") };
    const { album, photo } = row.data;
    if (album && photo) {
      const r = await hidePhoto(ctx, String(album), String(photo), true);
      if (!r.ok && r.error !== "not_found") return { error: reasonText(ctx, r) };
    }
    await closeRequest(ctx, values.id, "done");
    return { ok: ctx.t(album && photo ? "okMasked" : "okClosedNoPhoto") };
  });
}

async function dismissRequest(ctx, values) {
  return locked(ctx, async () => {
    const r = await closeRequest(ctx, values.id, "dismissed");
    return r.ok ? { ok: ctx.t("okDismissed") } : { error: reasonText(ctx, r) };
  });
}

async function eraseRequest(ctx, values) {
  return locked(ctx, async () => {
    const row = await getRow(ctx, values.id, "request");
    if (!row) return { error: ctx.t("errNotFound") };
    await ctx.api.store.remove(values.id);
    return { ok: ctx.t("okErased") };
  });
}

export const adminActions = {
  chooseTemplate: { right: "edit", run: chooseTemplate },
  saveAlbum: { right: "edit", run: saveAlbum },
  publish: { right: "publish", run: (ctx, v) => setAlbumStatus(ctx, v, "published") },
  unpublish: { right: "publish", run: (ctx, v) => setAlbumStatus(ctx, v, "draft") },
  removeAlbum: { right: "edit", run: removeAlbum },
  albumUp: { right: "edit", run: (ctx, v) => moveAlbumBy(ctx, v, -1) },
  albumDown: { right: "edit", run: (ctx, v) => moveAlbumBy(ctx, v, 1) },
  savePhoto: { right: "edit", run: savePhoto },
  toggleHidden: { right: "edit", run: toggleHidden },
  photoUp: { right: "edit", run: (ctx, v) => movePhotoBy(ctx, v, -1) },
  photoDown: { right: "edit", run: (ctx, v) => movePhotoBy(ctx, v, 1) },
  photoFirst: { right: "edit", run: (ctx, v) => movePhotoBy(ctx, v, "first") },
  makeCover: { right: "edit", run: makeCover },
  removePhoto: { right: "edit", run: removePhoto },
  addByUrl: { right: "edit", run: addByUrl },
  studioInfo: { right: "edit", run: studioInfo },
  addPhoto: { right: "edit", run: addPhoto },
  maskRequest: { right: "requests", run: maskRequest },
  dismissRequest: { right: "requests", run: dismissRequest },
  eraseRequest: { right: "requests", run: eraseRequest },
};
