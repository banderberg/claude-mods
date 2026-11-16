# Working on this repo

Notes for an agent (or person) picking up development. `README.md` is for
people who install the mods; this file is for whoever changes them.

## What this is

A Claude Code plugin marketplace (`.claude-plugin/marketplace.json`) holding
mods: plugins that change Claude Code's own interface through a hooks module.
One mod so far, `model-usage-status/`.

Load the `plugin-authoring` skill before changing a mod. It names the API
types file for the running build and carries the reference for events, `$`,
state contracts, tests and sharing. The API changes between builds, so check
names against that types file, not against memory.

## Layout of a mod

```
model-usage-status/
  .claude-plugin/plugin.json   name, version, "types" pointing at the contract
  hooks/hooks.json             names the one hooks module
  hooks/register.ts            everything the mod does
  types/index.d.ts             the shape of what the mod keeps in $.state
  tests/status.test.ts         run by `claude plugin test`
  tsconfig.json                extends types the engine lays in once loaded
```

## How model-usage-status works

The line is `$.ui.status(text)`. What it is written from is one value in
`$.state` (`line`, declared in `types/index.d.ts`): the main model, the usage
parts, the context part, and what is known of each subagent.

- **Measuring.** `session.start`, `turn.start`, `turn.complete`,
  `session.measure` and any `command.run` call `measure`, which reads
  `$.session.model()` and `$.session.usage()` and stores the result.
- **Account figures.** `readPlan` asks
  `https://api.anthropic.com/api/oauth/usage` (header
  `anthropic-beta: oauth-2025-04-20`) through `$.session.authorize()`, at most
  once a minute. The reading is kept in `$.store` under `plan`, so it is
  shared by the machine's sessions and outlives reloads; a stale one is shown
  for up to 6 hours, and a failed request is not retried for 5 minutes. The
  endpoint is undocumented and its reply may change shape.
- **Spend share.** `spendPercentOf` reads `spend.percent` when the plan's
  spend limit is on, else `extra_usage.utilization` when extra usage is on.
- **Subagents.** `agent.spawn` and `turn.step` record each agent's model and
  token count. A `ui.render` hook on `AbovePrompt` draws nothing; it is used
  to learn which transcript is in view (`e.props.view.agentId`) and writes the
  status for that view.
- **Diagnostic.** `/usage-status-check` prints what the usage endpoint
  returned and what the mod read from it.

## Things that were learned the hard way

- The `ui.render` hook and the event hooks do not share module variables.
  Anything both need must live in `$.state`. The test kit runs all hooks in
  one environment, so tests pass while the live mod is broken: verify a
  change to what is drawn in a real session.
- A helper that takes `$` must be declared at the top level of the file, not
  inside `register`; the validator refuses it otherwise.
- A hook that can hold up a turn needs a `.catch` that calls `next(e)`.
- `agent.spawn` gives the agent's type, not always its model. The model is
  taken from `turn.step` at request time.
- Do not run `tsc -p model-usage-status` unless the engine has laid types
  into `.claude-plugin/types/`; without `noEmit` it writes a `register.js`
  beside the module, which must not be committed.
- `VERSION` in `register.ts` and `version` in `plugin.json` are kept the same
  by hand. Raise both with every change people should receive.

## Decisions already made

- No cost or dollar figures on the line. This was built, then removed at the
  owner's request. Do not bring it back unasked.
- A part the account has no figure for is left out, not shown as a blank or
  a zero.

## Checking a change

From the repo root, in this order:

```
claude plugin validate model-usage-status
claude plugin test model-usage-status
```

Type-check with a `tsconfig.json` kept outside the repo, `noEmit` on, whose
`include` names the API types file the `plugin-authoring` skill gives plus
the mod's `hooks` and `types` folders.

Then check live, since the tests cannot see the drawing problem above. A
terminal session can be driven with tmux:

```
tmux new-session -d -s mus -x 200 -y 50 "claude --model haiku"
tmux send-keys -t mus "your prompt" Enter
tmux capture-pane -t mus -p
```

Run it from a folder already trusted, or the trust question appears first.
To check the subagent view, have the session start a subagent, press Down
twice to open the agent list, then Down and Enter to open one. The status
line should change to that agent's model.

For a throwaway experiment, write a small probe mod in a scratch folder and
run `claude -p --plugin-dir <folder>`.

## Releasing

1. Raise the version in both places.
2. Scan the repo for secrets before pushing (the `plugin-authoring` skill
   provides a scanner). The repo is public.
3. Commit and push to `main`. No force pushes.
4. People update with `claude plugin marketplace update claude-mods` and
   `claude plugin update model-usage-status@claude-mods`, then
   `/reload-plugins`.

Never commit the output of `/usage-status-check` or a captured reply from the
usage endpoint: it holds an account's own figures.

## Open question

On one enterprise plan with a monthly spend limit, the spend share has gone
missing from the line. The cause is not confirmed. Either the usage request
is refused there, or that plan reports the limit in a field other than the
two `spendPercentOf` reads. The output of `/usage-status-check` on that
account settles it; if it is the second, extend `spendPercentOf` and add a
test with the reply's shape (figures replaced).
