# Mascot

A small, discreet character in a corner of your site. It makes a short appearance, says hello in a bubble, gives a tip or announces something new (the next event, a live stream, the daily game), then steps aside. It adds life to the site without ever getting in the way.

It fits any identity: the included drawing takes the colours of your theme (light or dark) by itself, or you show your own picture. The sentences are yours.

## What a visitor sees

- One appearance per visit, after a few quiet seconds (8 by default). Never the same sentence twice in a row, never more than 3 messages a day (adjustable), never any sound.
- A short bubble: a greeting, then an announcement or a tip. A "See" button when the sentence has a link.
- The visitor can **close** it (44 px cross), **reduce it to a small badge** (it then stays discreetly in the corner) or **switch it off for good**. The choice is kept in the browser, without a cookie, and nothing is sent.
- On a small screen it never opens by itself: a badge with a dot appears, and the bubble opens when touched.
- It never hides the content: it stays in its corner, with margins, under the windows and the cookie banner of the site. It is not printed.
- "Reduced motion": no animation. The bubble never closes while hovered or read with the keyboard (Escape closes it).

## What the person who runs the site does

1. Install the module: starter sentences (French and English, neutral) are already there, and the mascot is a **draft** (nobody sees it).
2. Tab **My mascot**: look at the preview, choose the included drawing (three moods: happy, curious, sleepy) or **your own picture** (round or square, picture description required), give it a **name**. Click **Publish**.
3. Tab **Animation**: give it a moving face (see below). Tab **Voice**: give it a voice (see below).
4. Tab **Sentences**: add, edit, set to draft or delete sentences (140 characters, 100 at most). Choose the language and, if you want, the pages where a sentence is said. Two **templates**: "Discreet welcome" and "Empty".
5. Tab **When and where**: all pages, only the home page or some pages; bottom right or left; advanced options (wait, bubble duration, messages a day).
6. To see it again right away: open `your-site/?mascot=voir` (this also forgets what the browser had kept).

### Information of the site in a sentence

Write `{site_name}`, `{name}` (the name of the mascot), `{next_event}`, `{event_date}`, `{live_now}`, `{live_title}`, `{latest_news}` (the French names `{nom_du_site}`, `{nom}`, `{prochain_evenement}`, `{date_evenement}`, `{en_direct}`, `{titre_direct}`, `{derniere_nouveaute}` work too). **If the information does not exist, the sentence is simply not said**: no error, no hole. The date is written in the language and time of the visitor.

## Works alone, gets richer with other modules (everything is optional)

- A module that offers your **upcoming events** turns on the sentences with `{next_event}`.
- Your **Twitch** or **YouTube** channel turns on the sentences with `{live_now}` while you are live.
- Your published articles and videos give `{latest_news}`.
- Any module can hand a piece of news to the mascot (for example the daily game); it says it as an announcement. The option "Also announce news from other modules" switches that off.

## What it does not do

- No tracking, no account, no cookie, nothing sent to an outside service. **No sound on the pages of your site.**
- Only one mascot per site.
- It does not show when the browser refuses all storage (it could not respect "once per visit").
- It is not a live chat: it does not answer questions.

## For an AI assistant

Four tools. Read the sentences (read only) and propose one (always saved as a draft, never published; not granted by default). Read how the mascot moves and speaks (`mascot_animation_get`, read only) and change the talking time, the speed of the animations and the voice (`mascot_animation_update`, not granted by default). The assistant cannot upload pictures or sounds, and cannot make a draft public.

## Privacy

The browser of the visitor keeps its choices (closed, badge, off), the number of messages today and the last sentences said. Nothing goes to the site or to a third party. The module declares it in the privacy policy of the site.

## In an overlay page

Since 1.1.0 (Curiosa 0.5.0 or later), "Add an element" offers **Mascot** in the "Overlays" section. It is a **reduced version**: an overlay frame is not a page of the site, so the element takes nothing of what belongs to a page (corner, pages concerned, "once per visit", delay, messages a day, close / reduce / switch off, browser memory). It shows the included drawing (or your picture, with its description) and the **name** chosen in the module, with a bubble that says its sentences in turn (option **Seconds per sentence**).

**For a stream screen, the sentences come only from what you wrote for the mascot**: your published sentences (never a draft), in the requested language, with only `{site_name}` and `{name}`. A sentence that uses other information (next event, live, latest news) is not said, and news handed over by other modules is never shown: that information comes from elsewhere. A sentence reserved for some pages of your site is not said either. Mascot in draft: the frame stays empty.

The included drawing takes fixed colours here (not those of your theme: an overlay frame never loads the style of the site); the text follows the common style of the page. All the overlay pages showing the element say the same sentence at the same moment; nothing is consumed. In test mode an example sentence shows if there is nothing to say. On your site, nothing changes.

### Animation, reading time, voice and visibility (1.2.0, overlay element)

Nothing changes until you set something: with no animation, no voice and "Always" (the default), the page of the element is **byte for byte** the page of 1.1.1.

**When it shows** (option of the element, "Always" by default). "Always" is what the element always did: the mascot is on screen whenever it has sentences, and the sentence changes every N seconds. "Only while it speaks": the mascot (picture and bubble) comes in with each sentence, speaks for the time the sentence takes to read, leaves, and stays hidden until the next sentence. How it comes in and leaves uses the shared movements of the other overlay elements (module settings "How it enters" / "How it leaves", under More options). A mascot with nothing to say shows nothing in both modes.

**Animation** (tab *Animation*). Two animations, both optional:

- **while waiting** (idle), played all the time the mascot is not speaking, in a loop (or once, under More options);
- **while speaking** (talking), played from the start of each sentence, for the time the sentence takes to read, then the idle animation comes back (or the mascot leaves, in the "only while it speaks" mode). Without a talking animation, the idle one just goes on and the drawing makes a small bounce.

Each is made either of **one animated picture** (GIF, animated WebP or PNG) or of **several pictures** shown one after the other (stop motion), 1 to 24 pictures per second (8 by default). Pictures are added **one at a time**, in the order wanted, and moved up or down with buttons (no drag and drop needed). Pictures can only be pictures **sent to your site**; nothing is ever loaded from elsewhere.

Limits (checked when you save, with a plain message under the field): at most 24 pictures per animation; at most 3 MB per animation (the sum of its pictures, or the size of the GIF); the module keeps the files it is given (permission "files") and deletes a file from the site when you remove its picture. Small pictures (about 256 px) are best: the whole animation is fetched by the page before it starts.

**How long it speaks** (tab *Animation*). The talking animation, the voice and (in the "only while it speaks" mode) the time on screen last as long as the sentence takes to read: its number of characters over a reading speed (slow 10, normal 15, fast 22 characters a second), plus half a second to start, never below the shortest time (2 s) nor above the longest (12 s), and never longer than the time given to one sentence. The tab shows the result for 20, 60 and 140 characters. The calculation is the function `talkSeconds` (`model.mjs`), the same in the page and in the tests.

**Voice** (tab *Voice*), one of four, only the settings of the chosen one are shown:

- **None** (default).
- **Blips**: short sounds made by the page itself, one per letter while it speaks (spaces and punctuation are pauses). Presets Soft, Squeaky, Deep, Robotic, Bubbly, or **Your own sound**; pitch (low, normal, high), speed, variety (under More options) and volume. The same letter always gives the same note, so a sentence sounds like a voice.
- **Voice of your computer**: the speech voice of the browser that shows the page. Language, speed, pitch, volume and, under More options, a part of the name of a voice. **If the computer has no voice** (this happens in some OBS versions), blips are used instead, and the test panel says so in plain words.
- **Your own sound**: a short sound played once for each sentence.

*Your own sound* is sent in the Voice form itself, where it is used (mode *Your own sound*, or *Blips* set to "Your own sound"), with a native player to listen to it. Since **Curiosa 0.10.0** (the version this module now needs) the site accepts sound files: **MP3, OGG, WAV, M4A or AAC**, 4 MB at most for the mascot (the core takes 10 MB). Used as a blip, the file is decoded once, then the first 0.2 s are played for each letter, faster or slower according to the letter (playback rate kept between 0.5 and 2.5, at most 6 sounds at the same time): **OGG or WAV are best for a blip** (MP3 and AAC add a tiny silence at the start of the file, so the blips come a little late and soft). A configuration made with 1.2.x (a short MP4 or WebM file in the setting "Older sound file", advanced) keeps working without any conversion; a sound sent in the form wins over it.

The administration shows the **real element page** in a frame, with two buttons: *Play talking animation* and *Test the voice*, and a line that says what happens ("Click a button to enable sound", "No voice found on this computer: short sounds are used instead", "Voice of your computer: ..."). In a normal browser, sound starts only after a click (browser rule); OBS browser sources do not wait for one.

### The animation in the corner of your site (1.3.0)

The mascot in the corner of the pages of your site uses **the same two animations** as the overlay element: you send them once (tab *Animation*) and there is nothing more to set. When an animation is set:

- **Idle**: the animated picture lies over the avatar (same box, so nothing moves on the page) and plays while the mascot is there, also in its small badge.
- **Talking**: when a bubble opens, the talking animation plays for the reading time of the sentence (same speed and times as the overlay), then the idle one comes back. The bubble keeps its own duration: the animation never closes it.
- **Silent, and light**: no sound at all. Nothing is fetched before the mascot shows (once per visit, after its wait): the pages that never see it download no picture. A hidden tab stops the pictures. "Reduced motion": the first picture only; an animated GIF cannot be frozen, so the plain drawing stays.
- **Nothing set**: the script, its settings and the address of its style sheet are exactly those of 1.2.0 (tests compare them). With an animation, the script gets a small extra part and the style sheet address a `&a=1`; the extra part watches the page and never touches the existing script.
- The animated picture is a picture added over the drawing; a skin of the site that restyles the mascot keeps working (the drawing is only hidden while the picture plays).

### Honest limits

- **The voice and the visibility setting are for the overlay element only.** The corner mascot on the pages of your site never makes a sound (a site must not make sound by itself) and is not hidden by a setting: it already appears once per visit and steps aside. The animation is shared (see the next section).
- On the site the talking animation follows the bubble, not a clock shared with other pages; it ends with the estimated reading time even if the visitor keeps the bubble open. A hidden tab stops several pictures but a GIF cannot be stopped by a page (the browser slows it down).
- **A GIF cannot be paused or rewound by a page.** An idle GIF just loops. To start a talking GIF with the sentence, the page loads it under a new address (`?mc=n`); this works but is "best effort": the file may be fetched again each time, and the start may be off by a fraction of a second. For an exact start, use **several pictures**. With "reduced motion", a GIF cannot be frozen: the plain drawing is shown instead (several pictures show their first picture).
- The reading time is an estimate (characters over a speed), not the length of a recorded voice. The voice of the computer follows its own speed: a long sentence may be cut at the end of the estimated time (the voice stops with the bubble).
- Picture sizes are not read: only the weight is checked. Very large pictures are slow to fetch.
- Sound in OBS depends on its browser (CEF); the voice of the computer and some codecs may be missing there (OGG and WAV are the safest). Not verified on every OBS version.
- An assistant cannot send a sound (the core takes sounds only from the administration); it can choose "your own sound" once the person has sent one.
- Pictures removed from an animation are deleted from the site; the module cannot delete files it did not keep (sent more than 30 minutes before being added: send them again). A sound replaced or removed in the Voice form is deleted the same way.
- The *Look* and *Add a sentence* forms of earlier versions still have more fields than the ergonomics budget (a known gap, listed in the baseline).
