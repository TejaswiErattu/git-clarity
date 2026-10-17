# Git Clarity

**Git in plain English, with a safety net.** A VS Code extension for people in their first weeks of Git.

You type what you want ("save my changes", "undo my last commit", "switch to feature-login"). Git Clarity
shows the exact commands it would run, a Safe / Careful / Risky label, and how to undo it. Nothing runs
until you press Confirm. And if you are about to commit something that looks like a real API key, it
stops you first.

Built at [DubHacks '26](https://dubhacks-2026.devpost.com/), Oct 17–18, 2026. See `PROVENANCE.md` for what
was carried over from earlier work (four files, about 1,100 lines) and what was written during the event.

## What it does

- **Guided Assistant.** Nine supported requests, matched deterministically (no model picks a command).
  Every plan shows the commands, a plain-English explanation, affected files, a risk level and an undo hint.
  Unrecognized input gets an honest "I don't recognize that yet" plus the list of what works.
- **Secret Guard.** Scans the lines you are about to commit for eight kinds of secret (AWS, GitHub,
  Google, OpenAI, Slack, Stripe, private keys, hard-coded passwords). A high-severity finding blocks the
  commit until you remove it or acknowledge it. Acknowledgements are per-workspace and survive reloads.
- **Dashboard.** Overview, branches, recent activity and the Safety tab, in words a beginner understands.
- **Safety layer.** Git runs with argument arrays, never a shell string. A deny-list refuses `--force`,
  `--hard`, `reset`, `clean`, `rebase` and friends. `pull` is `--ff-only`. `switch`, not `checkout`.

## Run it

```bash
npm install
npm run compile
```

Press **F5** in VS Code, open any Git repo folder in the window that appears, then run
**Git Clarity: Open Dashboard** from the Command Palette.

```bash
npm test        # unit tests in the VS Code test host
npm run loc     # total lines of src/**/*.ts, for the 70/30 check in PROVENANCE.md
```

## Layout

```
src/
  assistant/intentMatcher.ts   phrase -> intent (deterministic)
  git/gitActions.ts            plans, deny-list, argv-only execution
  git/gitCommands.ts           read-only data layer: getRepoSnapshot and friends, argv-only
  git/types.ts                 shared Git data types (RepoSnapshot, BranchSummary, ...)
  safety/secretScanner.ts      patterns, placeholder filter, masking
  safety/secretGuard.ts        the backend <-> UI contract: staged scan, acknowledgements, commit guard
  extension.ts                 entry point
  test/                        mocha suites; helpers/tempRepo.ts builds throwaway repos
```

## Team

Tejaswi Erattu (UI, copy, demo) and Thanishka (data, safety backend, tests). Process in `CONTRIBUTING.md`.
