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
- **ctx** — how full the context window is

On an account with no rate-limit windows (API or usage-based billing, as on
many enterprise plans) the line shows cost instead: what this session has cost
so far, and what all your sessions have cost this calendar month:

```
Fable 5.2 · $1.23 session · $48.10 month · ctx 12%
```

The session figure covers every model the session used, subagents included.
The month figure is the mod's own tally, not your organization's bill: it
counts only Claude Code sessions on this machine, only from the day the mod
was installed, and only sessions that ran with the mod loaded.

The line refreshes at session start, at the start and end of each turn,
whenever a rate-limit window moves a whole point, and after any slash command
(so a `/model` switch shows at once). The usage figures appear after the first
response of a session reports them.

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
