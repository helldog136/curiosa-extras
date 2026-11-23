## Home Assistant gets small pieces of information from other modules, starting with the sponsor on screen

*Modules touched: Home Assistant connector 1.5.0, Sponsor ticker overlay 1.6.0.*

### New
- **Home Assistant connector 1.5.0.** The connector now hands Home Assistant small pieces of display information provided by your other modules (a name, a number, a yes or no). Nothing changes if no module provides any, and nothing from your home is ever sent to Curiosa.
- **Sponsor ticker 1.6.0.** The site now decides which sponsor is on screen, from its own clock, and gives it to Home Assistant ("Sponsor on screen"). Every sponsor comes once per round, in a shuffled order, never twice in a row. The overlay page computes the same answer and sends nothing back; the page you add in OBS stays the same, and a page that is closed or loaded late still shows the planned sponsor.

### For developers
- New optional topic `home.info` (`docs/TOPICS.md`): items `{ key, label, value, unit? }`, 20 at most. `home-assistant` consumes it in the new `info.mjs` (5 s cache, 15 s retry after a failure, 1.5 s at most, texts cleaned with `clean`, `cleanInfo`) and `pull` adds the additive field `info` (always present, not filtered by `enabled` or `live`); see `docs/ideas/home-assistant-contract.md` (§1.2, §3, §5 item 11).
- `sponsor-ticker` provides `home.info` (`key` `sponsor-ticker.<instance>`, `value` the name of the sponsor scheduled now during its display time, else `null`). The schedule is pure and deterministic (`rotation.mjs`: `rotationPick(ids, slot)`, `slotMs(period, hold)`, `scheduledId`): slot = floor(server time / slot length), slots grouped in rounds of n sponsors, each round a shuffle of the sorted ids seeded by the round number, the first of a round never the last of the previous one. The `items` route adds `serverTime` (ms); the overlay page injects the same functions (`Function.prototype.toString`) and offsets its clock by `serverTime`. Nothing is sent by the page and there is no route to report (no `shown`, no `reportUrl`). The test page, `?dev=1` and `?seed=N` keep their random choice (config flag `free`).
