# Demo repo

`npm run seed:demo` deletes and rebuilds `sample-repos/demo-app`. It is not part of Git Clarity's own history.

The repo ends on `main`. `feature/login` (3 commits) and `feature/navbar` (2 commits) both start from main's 6th commit, so each is behind main. Nine commits on main use beginner messages and are spread over the last 14 days.

Left uncommitted, on purpose:

- `src/index.js` is modified and not staged
- `src/utils.js` is modified and staged
- `config.js` is new and staged. Line 1 is a fake AWS key. Line 2 is the placeholder `your_api_key_here`, which Secret Guard ignores
- `.env` and `notes.txt` are new files Git does not know about

## Three-minute walk

1. Open `sample-repos/demo-app` and run Git Clarity: Open Dashboard.
2. Branches: `main`, `feature/login`, and `feature/navbar`. The feature branches are behind main.
3. Overview: one unstaged edit, one staged edit, and the new staged `config.js`.
4. Safety: one high finding, `config.js` line 1. The placeholder on line 2 is not listed.
5. Assistant: ask to save your changes. The plan is blocked and names `config.js`.
6. Acknowledge that finding in the Safety tab, then Confirm. The commit is allowed.
