## Home Assistant gets small pieces of information from other modules, starting with the sponsor on screen

*Modules touched: Home Assistant connector 1.5.0, Sponsor ticker overlay 1.6.0.*

### New
- **Home Assistant connector 1.5.0.** The connector now hands Home Assistant small pieces of display information provided by your other modules (a name, a number, a yes or no). Nothing changes if no module provides any, and nothing from your home is ever sent to Curiosa.
- **Sponsor ticker 1.6.0.** It tells which sponsor is currently shown on its OBS overlay, so Home Assistant can show it ("Sponsor on screen"). The overlay reports it to your site while it is on screen; the page you add in OBS stays the same.

### For developers
- New optional topic `home.info` (`docs/TOPICS.md`): items `{ key, label, value, unit? }`, 20 at most. `home-assistant` consumes it in the new `info.mjs` (5 s cache, 15 s retry after a failure, 1.5 s at most, texts cleaned with `clean`, `cleanInfo`) and `pull` adds the additive field `info` (always present, not filtered by `enabled` or `live`); see `docs/ideas/home-assistant-contract.md` (§1.2, §3, §5 item 11).
- `sponsor-ticker` provides `home.info` (`key` `sponsor-ticker.<instance>`, `value` the current sponsor name or `null`) and gets a route `shown` (POST, JSON body of 512 bytes at most `{ "id": "<item id>" | null }`, 30 calls per minute per instance, memory only, valid for the hold time plus 10 s). The server validates the id against the current items and takes the name from its own data. The overlay page script reports through `reportUrl`, only outside demo and dev-fast modes.
