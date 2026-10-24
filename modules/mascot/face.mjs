// Mascotte — le dessin inclus (original, simple, neutre) : un petit être rond avec une touffe de deux feuilles.
// Il est dessiné avec des CLASSES (mc-b, mc-t, mc-s, mc-f, mc-l, mc-c) dont les couleurs viennent des jetons du thème du site (voir style.mjs) :
// corps = couleur principale, touffe et joues = couleur secondaire, visage = fond des cartes, yeux = couleur du texte. Il s'harmonise donc tout seul.
// Trois expressions : « happy » (content), « curious » (curieux), « sleepy » (endormi).
//
// `drawFace` doit rester AUTONOME (aucune variable extérieure) : sa source est envoyée telle quelle au navigateur (voir client.mjs) et sert aussi à l'aperçu de l'administration.

/** Le dessin en SVG (texte) pour une expression ; une expression inconnue donne « content ». */
export function drawFace(mood) {
  var m = mood === "curious" || mood === "sleepy" ? mood : "happy";
  var eyes = {
    happy: '<path class="mc-l" d="M21 33q3.5-5 7 0M36 33q3.5-5 7 0"/><path class="mc-l" d="M27 40q5 5 10 0"/><ellipse class="mc-c" cx="20" cy="39" rx="3.5" ry="2.4"/><ellipse class="mc-c" cx="44" cy="39" rx="3.5" ry="2.4"/>',
    curious: '<circle class="mc-f" cx="25" cy="34" r="2.6"/><circle class="mc-f" cx="39" cy="34" r="3.5"/><path class="mc-l" d="M35 27.5l8-2.2"/><ellipse class="mc-l" cx="32" cy="42.5" rx="2" ry="2.5"/>',
    sleepy: '<path class="mc-l" d="M21 34q3.5 3.5 7 0M36 34q3.5 3.5 7 0"/><path class="mc-l" d="M29 41.5h6"/><path class="mc-l" d="M47 12h6l-6 7h6"/>',
  };
  var tilt = m === "curious" ? ' transform="rotate(-5 32 34)"' : "";
  return '<svg class="mc-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">'
    + '<ellipse class="mc-t" cx="22" cy="57.5" rx="6.5" ry="3"/><ellipse class="mc-t" cx="42" cy="57.5" rx="6.5" ry="3"/>'
    + '<path class="mc-b" d="M32 9C18 9 8 19 8 34c0 14 9 23 24 23s24-9 24-23C56 19 46 9 32 9z"/>'
    + '<path class="mc-t" d="M32 10C31 5 27 2.5 22 3.5c1 4.5 4.5 7 10 6.5zM32 10c1-5 5-7.5 10-6.5-1 4.5-4.5 7-10 6.5z"/>'
    + '<g' + tilt + '><ellipse class="mc-s" cx="32" cy="36" rx="17.5" ry="14"/>' + eyes[m] + "</g></svg>";
}

export const MOODS = ["happy", "curious", "sleepy"];
