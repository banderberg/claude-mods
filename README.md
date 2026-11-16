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

The line refreshes at session start, at the start and end of each turn,
whenever a rate-limit window moves a whole point, and after any slash command
(so a `/model` switch shows at once). The usage figures appear after the first
response of a session reports them; rate-limit windows show only on a
subscription.

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
