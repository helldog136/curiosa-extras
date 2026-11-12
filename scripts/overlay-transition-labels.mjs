// The texts people read for the transition settings (module settings and element options). Written ONCE here;
// `node scripts/gen-transition.mjs` copies them into each module.json and the test checks nothing drifted.
import { ENTRANCES, EXITS, INHERIT, SECONDS } from "./overlay-transition.mjs";

const IN = {
  auto: ["Default", "Par défaut"],
  slide: ["Slide in from the nearest edge", "Glisse depuis le bord le plus proche"],
  slideLeft: ["Slide in from the left", "Glisse depuis la gauche"],
  slideRight: ["Slide in from the right", "Glisse depuis la droite"],
  slideTop: ["Slide in from the top", "Glisse depuis le haut"],
  slideBottom: ["Slide in from the bottom", "Glisse depuis le bas"],
  fade: ["Fade in", "Apparaît en fondu"],
  jiggle: ["Jiggle in", "Arrive avec un rebond"],
  pop: ["Pop in", "Surgit en zoom"],
  none: ["Instant", "Instantané"],
};
const OUT = {
  same: ["Same as how it enters", "Comme l'arrivée"],
  slide: ["Slide out to the nearest edge", "Glisse vers le bord le plus proche"],
  slideLeft: ["Slide out to the left", "Glisse vers la gauche"],
  slideRight: ["Slide out to the right", "Glisse vers la droite"],
  slideTop: ["Slide out to the top", "Glisse vers le haut"],
  slideBottom: ["Slide out to the bottom", "Glisse vers le bas"],
  fade: ["Fade out", "Disparaît en fondu"],
  jiggle: ["Jiggle, then fade", "Rebondit, puis s'efface"],
  pop: ["Pop out", "Disparaît en zoom"],
  none: ["Instant", "Instantané"],
};
const text = ([en, fr]) => ({ fr, en });
const choices = (modes, labels) => modes.map((value) => ({ value, label: text(labels[value]) }));

export const LABELS = {
  in: { fr: "Comment il arrive", en: "How it enters" },
  out: { fr: "Comment il part", en: "How it leaves" },
  seconds: { fr: "Durée du mouvement", en: "Length of the movement" },
  inHelp: { fr: "« Par défaut » garde le style actuel.", en: "\"Default\" keeps the current look." },
  outHelp: { fr: "« Comme l'arrivée » la joue à l'envers.", en: "\"Same\" plays the entrance backwards." },
  module: { fr: "Comme dans les réglages du module", en: "Like the module settings" },
};

/** The three module settings (all folded under "More options"). `seconds` = the module's default length. */
export function settingsBlock(seconds) {
  return [
    { key: "transitionIn", type: "select", default: "auto", rare: true, label: LABELS.in, help: LABELS.inHelp, options: choices(ENTRANCES, IN) },
    { key: "transitionOut", type: "select", default: "same", rare: true, label: LABELS.out, help: LABELS.outHelp, options: choices(EXITS, OUT) },
    { key: "transitionSeconds", type: "number", default: seconds, rare: true, min: SECONDS.min, max: SECONDS.max, step: 0.1, unit: { fr: "secondes", en: "seconds" }, label: LABELS.seconds },
  ];
}

/** The two options of an overlay element (default: follow the module settings). */
export function optionsBlock() {
  const inherit = { value: INHERIT, label: LABELS.module };
  return [
    { id: "transitionIn", type: "choice", label: LABELS.in, choices: [inherit, ...choices(ENTRANCES, IN)], default: INHERIT },
    { id: "transitionOut", type: "choice", label: LABELS.out, choices: [inherit, ...choices(EXITS, OUT)], default: INHERIT },
  ];
}
