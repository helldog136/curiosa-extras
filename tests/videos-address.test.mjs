// Vidéothèque : lire une adresse collée (tous les formats, jamais d'adresse arbitraire) et fabriquer le lecteur, la miniature et le lien « regarder » à partir d'un identifiant vérifié.
import test from "node:test";
import assert from "node:assert/strict";
import { R, P } from "./helpers/videosKit.mjs";

const ID = "dQw4w9WgXcQ";
const ok = (text) => { const r = R.parseAddress(text); return r.ok ? r.id : r.why; };

test("tous les formats d'adresse donnent le même identifiant, les paramètres de suivi sont jetés", () => {
  const same = [
    `https://www.youtube.com/watch?v=${ID}`, `https://youtube.com/watch?v=${ID}&t=42s&si=abcdef&utm_source=x&feature=share`,
    `https://m.youtube.com/watch?feature=share&v=${ID}`, `https://music.youtube.com/watch?v=${ID}&list=RDAMVM${ID}`,
    `https://youtu.be/${ID}`, `https://youtu.be/${ID}?si=trackingtrackin&t=10`, `https://www.youtube.com/shorts/${ID}`, `https://www.youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/embed/${ID}`, `https://www.youtube-nocookie.com/embed/${ID}?rel=0`, `https://www.youtube.com/live/${ID}?si=zzz`, `https://www.youtube.com/v/${ID}`,
    `http://www.youtube.com/watch?v=${ID}`, `  https://www.youtube.com/watch?v=${ID}  `, `youtube.com/watch?v=${ID}`, `www.youtube.com/watch?v=${ID}`, `youtu.be/${ID}`, `m.youtube.com/shorts/${ID}`,
    `HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}`,
  ];
  for (const text of same) assert.equal(ok(text), ID, text);
});

test("ce qui n'est pas une vidéo YouTube est refusé, avec la raison", () => {
  const cases = {
    "": "format", "bonjour": "format", "masterclass": "format", [ID]: "format", "ftp://youtube.com/watch?v=dQw4w9WgXcQ": "format",
    "javascript:alert(1)": "format", "data:text/html,<script>1</script>": "format", "https://www.youtube.com/watch?v=dQw4w9WgXcQ extra": "format",
    "https://example.org/watch?v=dQw4w9WgXcQ": "host", "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ": "host", "https://evil.test/youtu.be/dQw4w9WgXcQ": "host",
    "https://notyoutube.com/watch?v=dQw4w9WgXcQ": "host", "https://youtu.be.evil.test/dQw4w9WgXcQ": "host", "https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ": "host",
    "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ": "format", "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ": "format",
    "https://www.youtube.com/watch": "id", "https://www.youtube.com/watch?v=": "id", "https://www.youtube.com/watch?v=tooshort": "id", "https://www.youtube.com/watch?v=waytoolongidentifier": "id",
    "https://www.youtube.com/watch?v=dQw4w9WgXc!": "id", "https://www.youtube.com/watch?v=dQw4w9WgX<>": "id", "https://www.youtube.com/watch?v=dQw4w9WgXcQ%22": "id", "https://youtu.be/": "id",
    "https://www.youtube.com/playlist?list=PL123": "playlist", "https://www.youtube.com/channel/UC123": "channel", "https://www.youtube.com/@moi": "channel", "https://www.youtube.com/": "format",
  };
  for (const [text, why] of Object.entries(cases)) assert.equal(ok(text), why, JSON.stringify(text));
});

test("l'identifiant est strictement 11 caractères [A-Za-z0-9_-] : tout autre est refusé partout", () => {
  const y = R.PROVIDERS.youtube;
  for (const good of ["dQw4w9WgXcQ", "AAAAAAAAAAA", "a-b_c-d_e-f", "___________", "-----------"]) assert.ok(y.validId(good), good);
  for (const bad of ["", "short", "dQw4w9WgXcQ1", "dQw4w9WgXc ", "dQw4w9WgXc\n", "dQw4w9WgXc\"", "dQw4w9WgXc/", "dQw4w9WgXc?", "dQw4w9WgXc.", "é".repeat(11), null, undefined, 12345678901, ["dQw4w9WgXcQ"]]) {
    assert.ok(!y.validId(bad), String(bad));
    assert.equal(y.watchUrl(bad), null); assert.equal(y.embedUrl(bad), null); assert.equal(y.thumbUrl(bad), null); assert.equal(y.oembedUrl(bad), null);
  }
});

test("les adresses fabriquées : lecteur « nocookie », miniature et titre sur des hôtes fermés", () => {
  const y = R.PROVIDERS.youtube;
  assert.equal(y.watchUrl(ID), `https://www.youtube.com/watch?v=${ID}`);
  assert.equal(y.embedUrl(ID), `https://www.youtube-nocookie.com/embed/${ID}?rel=0&playsinline=1`);
  assert.equal(y.embedUrl(ID, { autoplay: true }), `https://www.youtube-nocookie.com/embed/${ID}?rel=0&playsinline=1&autoplay=1`);
  assert.equal(y.thumbUrl(ID), `https://i.ytimg.com/vi/${ID}/mqdefault.jpg`);
  assert.equal(new URL(y.oembedUrl(ID)).hostname, "www.youtube.com");
  assert.deepEqual(y.embedHosts, ["www.youtube-nocookie.com"]); assert.deepEqual(y.thumbHosts, ["i.ytimg.com"]);
});

test("embedSrc : seulement pour une vidéo connue, au bon identifiant, et pas si le lecteur est interdit", () => {
  assert.equal(R.embedSrc({ provider: "youtube", ext: ID }), `https://www.youtube-nocookie.com/embed/${ID}?rel=0&playsinline=1`);
  assert.equal(R.embedSrc({ provider: "youtube", ext: ID, noEmbed: true }), null);
  assert.equal(R.embedSrc({ provider: "dailymotion", ext: ID }), null);
  assert.equal(R.embedSrc({ provider: "__proto__", ext: ID }), null);
  assert.equal(R.embedSrc({ provider: "youtube", ext: `${ID}"onload="x` }), null);
  assert.equal(R.embedSrc({ provider: "youtube", ext: "../../evil" }), null);
  assert.equal(R.embedSrc(null), null);
});

test("la table des fournisseurs est faite pour recevoir une autre plateforme sans toucher au reste", () => {
  assert.deepEqual(Object.keys(R.PROVIDERS), ["youtube"]);
  for (const [name, p] of Object.entries(R.PROVIDERS)) {
    for (const fn of ["parse", "validId", "watchUrl", "embedUrl", "thumbUrl", "oembedUrl"]) assert.equal(typeof p[fn], "function", `${name}.${fn}`);
    assert.ok(Array.isArray(p.embedHosts) && Array.isArray(p.thumbHosts) && p.label);
  }
});

test("durées, dates et curseurs", () => {
  assert.equal(P.parseDuration("12:34"), 754); assert.equal(P.parseDuration("1:02:03"), 3723); assert.equal(P.parseDuration("90"), 90); assert.equal(P.parseDuration(""), 0);
  assert.equal(P.parseDuration("12:75"), null); assert.equal(P.parseDuration("abc"), null); assert.equal(P.parseDuration("99:99:99"), null);
  assert.equal(P.formatDuration(754), "12:34"); assert.equal(P.formatDuration(3723), "1:02:03"); assert.equal(P.formatDuration(0), "");
  assert.equal(P.isoDuration(3723), "PT1H2M3S"); assert.equal(P.isoDuration(60), "PT1M"); assert.equal(P.isoDuration(5), "PT5S");
  assert.equal(P.parseDate("2026-10-24"), "2026-10-24"); assert.equal(P.parseDate("2026-02-30"), null); assert.equal(P.parseDate("24/10/2026"), null);
  const a = { date: "2026-10-24", n: 5 }, b = { date: "2026-10-24", n: 4 }, c = { date: "2026-10-23", n: 9 };
  assert.deepEqual([c, a, b].sort(P.byNewest), [a, b, c]);
  assert.equal(P.cursorOf(a), "20261024-5");
  assert.ok(P.afterCursor(b, P.parseCursor(P.cursorOf(a)))); assert.ok(!P.afterCursor(a, P.parseCursor(P.cursorOf(a)))); assert.ok(P.afterCursor(c, P.parseCursor(P.cursorOf(b))));
  assert.equal(P.parseCursor("abc"), null); assert.equal(P.parseCursor("20261024-5; drop"), null);
});

test("un chemin d'image n'est accepté que s'il vient de l'envoi de fichiers du site", () => {
  assert.equal(P.sitePath("/uploads/0a1b2c3d-0000-4000-8000-000000000000.jpg"), "/uploads/0a1b2c3d-0000-4000-8000-000000000000.jpg");
  for (const bad of ["https://evil.test/x.jpg", "//evil.test/x.jpg", "/uploads/../etc/passwd", "javascript:alert(1)", "/other/x.jpg", "/uploads/x\"onerror=1", ""]) assert.equal(P.sitePath(bad), "", bad);
});

test("paragraphes : texte échappé, adresses https seulement en liens", () => {
  const html = P.paragraphs("Ligne <script>alert(1)</script>\n\nVoir https://example.org/a?b=1&c=2. Et javascript:alert(1) et http://x.test/\"onmouseover=\"y");
  assert.ok(!html.includes("<script"));
  assert.match(html, /<a href="https:\/\/example\.org\/a\?b=1&amp;c=2" rel="nofollow noopener noreferrer"/);
  assert.ok(!/href="javascript/i.test(html));
  assert.ok(!/onmouseover="/.test(html.replace(/&quot;/g, "")), "pas de guillemet brut dans un attribut");
});
