# The "Interaction on stream" family (an idea born from the Polls module)

Principle: the community takes part from its phones (a public page, no account, no app), the streamer drives from a phone or a computer (a very simple control page, big buttons), and everything that must be seen on screen goes through a transparent **OBS browser source** (the same mechanism as the existing overlays). No real money, no needless data, everything purges itself.

## The common base (built once, used by all)
Otherwise each module would reinvent: the anonymous identity of a participant, the vote limit, the name, the moderation, the live view on the overlay, the streamer's remote control, the GDPR purge. Proposal: a small provider module **"Participation"** (`audience`, service `audience.session`) that owns these bricks, and that the modules below call:
- **anonymous identity**: a random token in the browser, never a tracking cookie; a name chosen by the person (editable list of forbidden words, one name per session); linking to a Contacts card only if the person asks for it;
- **limits**: rate, one participant = one vote, no duplicates without keeping an IP address in clear;
- **remote control**: a secret "Live" page to start, stop and go to the next one, with big buttons;
- **live view**: the overlay and the public page are updated by gentle, bounded polling (no tight loop), with a readable fallback;
- a minimal **audit log** (who decided what, when) and an automatic **purge** on read (no background timer);
- **moderation mode**: mute a participant, empty a room.

The modules that use it stay usable alone (simple fallback) while the base is not installed. **Participation is not installed automatically**: Polls and Daily game declare `audience.session` as an **optional** need, and the core never installs an optional need by itself (see "Optional need" in the core's `docs/MODULES.md`). Each of them offers it instead with the core's one-click install suggestion (`suggestInstall`).

## The concepts

1. **Giveaway / draw (`giveaway`)**: people sign up on the page (a name) or the streamer pastes a list; the streamer starts the draw: an **animated drum or urn** on screen (off with reduced motion), one or more winners, a **reserve** if the winner is absent ("draw again" in one click), exclusions (moderators, former winners). The bonus: a **verifiable draw**: before starting, the module publishes a fingerprint (hash) of a secret number; after the draw, it reveals the number: anyone can compute the result again and see that it was not rigged. Rules of the game in one click (a template, with a link to the legal notice), a deadline, purge of the entrants after N days. Nothing is promised legally: a clear reminder of the rules of the platform and of the country.
2. **Wheel of fortune (`wheel`)**: a custom wheel (games to play, dares, rewards, questions) with a weight per slice, readable colours, the result shown on screen and kept in a history; the wheel can be **spun by the streamer or by the chat** (a "who spins?" vote). Ideal for "which game tonight" and dares. Shares its draw engine with the giveaway.
3. **Chat decisions (rounds) (`polls` v2)**: the poll becomes a **loop**: "every 10 minutes, the chat decides"; a round countdown, the winner applied automatically (shown on screen), a history of decisions, ties broken at random and said on screen. A **quick poll in one gesture** ("A or B?") from the remote control.
4. **Live quiz (`quiz`)**: the streamer prepares questions in advance (text, picture, 2 to 4 answers, duration); live, the streamer pushes the question, participants answer on their phones, the **ranking shows on screen** (speed + accuracy, without pressure: no shaming ranking, the top 5 is shown). Modes: "surprise question", "end-of-stream quiz", "guess the game from a detail".
5. **Stream bingo (`bingo`)**: a grid of 25 likely events ("the streamer grumbles", "the chat spams an emote", "dies in less than 5 min"), drawn at random for each participant from a **prepared template**; the streamer confirms the events live with one tap; the first to complete a line wins. Very useful for long streams, speedruns and game discovery evenings; no account, live results.
6. **Predictions (no money) (`predictions`)**: "Will the boss fall in fewer than 10 tries?" Participants bet **virtual points that cannot be converted** (never real money, no purchase, nothing exchangeable); a monthly ranking of the best forecasts. Insists on the difference with betting: the module says so plainly and offers no point shop.
7. **Question wall (`ama`)**: for talk, IRL and AMA streams: participants ask questions, the others **vote for the ones that matter**, the streamer chooses "the next one" and the question shows on screen; anti-spam filter, blocked words, one question a minute, "already answered" kept apart, export of the Q&A to turn it into a FAQ article.
8. **Goal bar (`goal-bar`)**: a bar on screen ("100 votes to unlock the bonus quiz", "50 messages for the victory dance") fed by hand, by the votes of a poll or by the entrants of a giveaway; steps with rewards, a discreet effect at each step. Can show a follower goal typed by hand or read from the community statistics.
9. **Subathon / growing timer (`subathon`)**: a countdown that **gets longer** when things happen (time added by hand with one button, or after a community vote) with a cap, a log, pause and resume; relies on the Countdown module for the display, without duplicating its rules.
10. **Secret word hunt (`secret-word`)**: the streamer says a word or a code during the stream; participants type it on the site to win a point or unlock a bonus page (relies on the existing codes module rather than replacing it); a ranking at the end of the month.
11. **Presence cards ("Who is here?") (`presence`)**: participants "check in" with one gesture; a small wall of names on screen (or a counter) to say hello; also serves as a **sign-up list** for the bingo, the quiz or the giveaway.
12. **Library of sounds and alerts the community can trigger**: later (needs safeguards for volume and abuse).

## Why this family holds together
- One place for the remote control and for moderation: the streamer learns ONE gesture.
- The same safety limits everywhere (one vote, no tracking cookie, purge).
- Each module stays simple, useful alone, and can be combined (a goal unlocked by a poll, a giveaway reserved for those who played the quiz).

## Ethical and legal safeguards (to be written plainly in the admin)
- No real money, no stake, no convertible or purchasable points. "Predictions" are not bets.
- Giveaway: rules, age, country, rules of the streaming platform; the module helps but does not replace legal advice. The verifiable draw is a way to prove fairness, not to guarantee it.
- Data: name + anonymous token, automatic purge, no IP address in clear, deletion on request.
- Moderation: everything a visitor writes (name, question) goes through a list of forbidden words, a rate limit and a way to remove it in one click.

## Proposed building order
1. **The "Participation" base** (with Polls v2: rounds and remote control): the foundation.
2. **Giveaway** (the most requested, and the most visible) + **Wheel** (same draw engine).
3. **Bingo** and **Quiz** (the two chat "games").
4. **Question wall** and **Goal bar**.
5. **Subathon**, **Secret word**, **Presence**, **Predictions**.
