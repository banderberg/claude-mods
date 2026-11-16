# claude-mods

Mods for Claude Code.

## model-usage-status

Pins one line under the prompt that always shows which model the session is
using and how much of your usage is spent:

```
Fable 5.2 · 5h 23% · 7d 41% · ctx 12%
```

- **model** — the main loop's model, as `/model` shows it
- **5h / 7d** — how much of each subscription rate-limit window is used
- **spend** — how much of the plan's spend limit is used, on a plan that has
  one (a work plan with a monthly spend limit, or extra usage switched on):
  `Fable 5.2 · spend 37% · ctx 12%`
- **ctx** — how full the context window is

A part the account has no figure for is left out.

While a subagent's transcript is on screen the line shows that subagent's
model and context instead, with its type beside it: `Haiku 5.5 (Explore) ·
5h 23% · ctx 45k`. Its context appears once its first response has finished. A subagent on another model than the session's shows its context in
tokens, since only the session model's window size is known. The usage
percentages are the account's, so they read the same in either view.

The line refreshes at session start, at the start and end of each turn,
whenever a rate-limit window moves a whole point, and after any slash command
(so a `/model` switch shows at once).

### What it sends

To read the spend limit, and the rate-limit windows before the session's first
response, the mod asks Anthropic's own usage endpoint
(`https://api.anthropic.com/api/oauth/usage`, the one Claude Code's `/usage`
screen reads) at most once a minute across this machine's sessions, signed in as the
session is. The sign-in
stays with Claude Code: the mod never sees it, and the request goes nowhere
else. It needs a claude.ai sign-in; with an API key, a gateway or a cloud
provider, or with `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set, no request
is made and the line shows what Claude Code itself reports. That endpoint is
not a documented API, so its answer may change shape; the mod then drops the
parts it can no longer read.

### When a part is missing

`/usage-status-check` asks the usage endpoint once and prints what came back:
whether the request went through, which fields the account's reply holds, and
the spend share the mod reads from it. The last good reading is kept for this
machine's sessions and shown for a few hours when a request is refused or
rate-limited.

### Install

At the prompt of a terminal session:

```
/plugin install model-usage-status --marketplace banderberg/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads the mod
in every session).

From a shell:

```
claude plugin install model-usage-status --marketplace banderberg/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt
box, then Plugins, Add marketplace with `banderberg/claude-mods`, then Add
plugin.
