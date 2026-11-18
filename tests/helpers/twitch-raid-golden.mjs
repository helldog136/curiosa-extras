// Empreintes du dock de la 2.1, enregistrées sur le code d'AVANT la 2.2 (voir tests/twitch-raid-compat.test.mjs). Ne pas régénérer à la légère : elles PROUVENT que le dock n'a pas bougé.
// 2.3.0: the three PAGE fingerprints (dockPage, denied, dockPageEn) were re-recorded for the new look (administration tokens); every DATA fingerprint (live, pick, refusals) is still the 2.1 one.
// 2.6.2 (R33): dockPage and dockPageEn re-recorded for three shorter dock texts (dock_updated, dock_empty_hint, dock_rm_intro); the data fingerprints are untouched.
export const GOLDEN = {
  "dockStatus": 200,
  "dockCsp": "default-src 'none'; script-src 'nonce-N'; style-src 'nonce-N'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  "dockPage": "95379a622577bd8048c04c0fcfd1d0da",
  "denied": [
    403,
    "7297c6e8aceb143bfaa373ef120fcf06"
  ],
  "live": {
    "state": "ok",
    "mode": "full",
    "live": [
      {
        "login": "membre_0000",
        "name": "MEMBRE_0000",
        "game": "Zelda",
        "title": "Live de membre_0000",
        "viewers": 40,
        "startedAt": 1792837800000,
        "pos": 0
      },
      {
        "login": "membre_0002",
        "name": "MEMBRE_0002",
        "game": "Jeu",
        "title": "Live de membre_0002",
        "viewers": 3,
        "startedAt": 1792842900000,
        "pos": 2
      },
      {
        "login": "membre_0004",
        "name": "MEMBRE_0004",
        "game": "Jeu",
        "title": "Un <titre> & \"guillemets\"",
        "viewers": 12,
        "startedAt": 1792839540000,
        "pos": 4
      }
    ],
    "listed": 6
  },
  "liveDenied": [
    403,
    {
      "state": "denied"
    }
  ],
  "bigLive": {
    "state": "ok",
    "mode": "random",
    "listed": 520,
    "live": []
  },
  "bigPick": {
    "state": "found",
    "listed": 520,
    "pick": {
      "login": "membre_0300",
      "name": "MEMBRE_0300",
      "game": "Jeu",
      "title": "Live de membre_0300",
      "viewers": 9,
      "startedAt": 1792841400000
    }
  },
  "dockPageEn": "72a790b8dd870cfc3a8846cb951bd2b8"
};
