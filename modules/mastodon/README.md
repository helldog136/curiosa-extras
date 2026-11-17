# Mastodon — Curiosa community module

Shows your Mastodon button (icon and link) in the site header. It provides the `social.link` topic to the core, which gathers the buttons of all your networks, and its own numbers (`social.stat` topic): it consumes nothing and stores nothing.

- **Setting**: your profile address. Paste your profile link, or @name@server. For example: https://mastodon.social/@name. The name alone, the address without https:// or www. and short addresses are recognised; tracking parameters are removed.
- **Several accounts**: add one instance per account (yours, a friend's…).
- Only an https address of the right site is accepted; nothing is shown until the profile is set.

## Statistics: followers and posts

**Follow my statistics** is ticked by default: these are public numbers, no key is needed. Untick it to follow nothing.

- **What is read**: `/api/v1/accounts/lookup` on your account's server (the one in your profile address): number of followers and posts, kept 30 minutes. Only public https addresses are called: never a local or private machine, a port, or credentials in the address. Before each request, and again at each redirect, the server name is resolved and every address it leads to must be public; otherwise the server is not contacted and the panel says the address leads to a private network.
- **Platform limits**: each Mastodon server sets its own rules: some refuse public reading (error "this server does not show its numbers", nothing to fix on your side) or limit requests. The follower count is the one your server knows.
- **If it does not work**: the module panel says in plain words what is happening. *"This Mastodon server cannot find this account"*: the profile address must look like `https://server/@name`.
- No number is invented or stale: when the platform does not answer, the module publishes the error (`auth`, `rate`, `network`, `hidden` or `config`) and no number. Several instances of the same account share a single request.
