# Contributing (two-person hackathon edition)

## Setup

```bash
git clone https://github.com/TejaswiErattu/git-clarity.git
cd git-clarity
npm install
npm run compile
```

Press **F5** in VS Code to open the Extension Development Host, open any Git repo folder there, and run
**Git Clarity: Open Dashboard** from the Command Palette.

## Rules

- **`main` is always demo-able.** Nothing lands on `main` except through a PR that compiles, lints and
  passes `npm test`.
- **One branch per task**, named `<initials>/<task>-<short-name>`: `tej/t1-safety-tab`, `thn/p1-staged-scan`.
- **Two writers never touch the same file at the same time.** Backend (`src/git`, `src/safety`,
  `src/test`) is Thanishka's; UI (`src/ui`, `src/extension.ts`) is Tejaswi's. The contract between them is
  `src/safety/secretGuard.ts`; change a signature there only after telling the other person.
- **Squash-merge**, delete the branch.
- **Broke `main`?** `git revert <sha>` on a branch and PR it. Do not fix forward on `main`.

## PR checklist

- [ ] `npm run compile` and `npm run lint` are clean
- [ ] `npm test` passes, including tests I added
- [ ] Pressed F5 and walked the feature by hand, including the empty or error state
- [ ] Only the files my task names changed
- [ ] Rebased on the latest `main`
- [ ] If I carried over any pre-hackathon code, `PROVENANCE.md` is updated
