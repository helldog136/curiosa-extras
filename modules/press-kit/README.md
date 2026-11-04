# Press kit

A public page that presents your identity to press and partners: presentation, main facts, logos, colors, fonts and contact. It works with no setting at all, because it takes everything from your site (Settings → Identity and Appearance). Add your own texts and values in **Settings** when the site's are not enough.

Core module of Curiosa (Curiosa License 1.0). Turn it on from the admin, under **Features**; its settings are on its page.

## What you can set

Simple settings (visible at once):

- **Presentation** and **What we do in one line**: one text per language. Empty, the site's presentation and tagline are used.
- **Main facts**: one per line, 12 at most ("Created in 2021").
- **Press contact name**: shown above the contact e-mail of the site.
- **Colors, fonts and logos**: "From the site (recommended)" (default) or "My own values".

Under **More options** (used only when "My own values" is chosen; an empty or invalid value falls back to the site):

- **Own colors**: one per line, 8 at most, a name then a code, for example `Night blue #1B1A2E`. Lines without a valid code are ignored.
- **Own font for titles** and **Own font for text**: the name only, for example `Lora`.
- **Four logos** (horizontal, icon, and their dark-background versions): files already uploaded to the site. A file that is not on the site is ignored, so a visitor's browser never loads anything from a third party.

Advanced: show or hide the font and the contact e-mail.

## For an AI assistant

Everything above is an ordinary module setting, so `maintenance_module_settings` lists it and `maintenance_module_configure` fills it, for example:

```json
{
  "about": { "en": "We make cosy puzzle games.", "fr": "Nous créons des jeux de réflexion apaisants." },
  "tagline": { "en": "Cosy puzzle games, streamed live.", "fr": "Des jeux de réflexion apaisants, en direct." },
  "facts": { "en": "Created in 2021\nBased in Lyon", "fr": "Créé en 2021\nBasé à Lyon" },
  "contactName": "Camille",
  "brandSource": "own",
  "ownColors": "Night blue #1B1A2E\nSun #FFCC00",
  "ownHeadingFont": "Lora",
  "ownLogoWide": "/uploads/logo-wide.png"
}
```

`about`, `tagline` and `facts` take one value per language of the site. Logos must already be uploaded to the site (`/uploads/...`). The module needs Curiosa 0.6.0 or later.
