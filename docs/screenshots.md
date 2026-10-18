# Screenshot capture guide

Ten screenshots for the README and Devpost. Every shot shows a feature that exists on `main` today; nothing here is
mocked or edited. Follow the setup once, then capture the shots in the order below. Save each PNG in
`docs/screenshots/` with the exact file name.

## Status

| # | File | Can it be captured now? | Captured |
| ---: | --- | --- | --- |
| 1 | `01-overview.png` | Yes, with the manual setup below | No |
| 2 | `02-branches.png` | Yes, with the manual setup below. The demo seed script (P4) would make it repeatable | No |
| 3 | `03-activity.png` | Yes, with the manual setup below (it backdates commits). The demo seed script (P4) would make it repeatable | No |
| 4 | `04-assistant-empty.png` | Yes | No |
| 5 | `05-assistant-plan.png` | Yes | No |
| 6 | `06-assistant-blocked.png` | Yes | No |
| 7 | `07-assistant-unrecognized.png` | Yes | No |
| 8 | `08-safety-findings.png` | Yes | No |
| 9 | `09-safety-acknowledged.png` | Yes | No |
| 10 | `10-first-run-help.png` | Yes | No |

- **Needs the demo seed script:** none strictly. P4 (the demo seed script) is not on `main` yet, so this guide uses
  a manual setup instead. When P4 lands, use it for shots 02 and 03 so the branch and history data is the same
  every time.
- **Blocked by unfinished features:** none of these ten. T7 is waiting on P5 and is not part of this set; add its
  screenshot here when it lands.

Change "No" to "Yes" in the Captured column when a PNG is committed.

## Capture setup (same for every shot)

- **Window:** VS Code (the Extension Development Host window) at **1440 × 900**. On macOS you can set this with:
  ```bash
  osascript -e 'tell application "Code" to set bounds of front window to {0, 25, 1440, 925}'
  ```
  (Click the Extension Development Host window first so it is the front window.)
- **Layout:** sidebar closed (Cmd+B), bottom panel closed (Cmd+J), no other editors open. The Git Clarity
  dashboard fills the editor area. Default zoom (View > Appearance > Reset Zoom).
- **Theme:** **Dark Modern** for all ten (Command Palette > "Preferences: Color Theme" > Dark Modern).
- **Format:** PNG. On macOS, Cmd+Shift+4 then Space captures one window; Cmd+Shift+5 also works.
- **Crop:** crop every shot to the same box: the editor area below the editor tab bar, full width. Crop only.
  Do not edit, blur or redact anything; secrets in the dashboard are already masked.

## One-time demo repository setup

This builds `/tmp/gc-demo/campus-events` with a shared copy (`remote.git`), some history over several days,
two feature branches that both touch `src/app.js`, one commit not uploaded yet, and a mix of staged, not staged
and untracked files. No secrets yet; those are added for shots 06, 08 and 09.

Every command in this guide works only inside `/tmp/gc-demo`. The setup runs in a subshell with `set -e`, so if
any step fails (for example the folder cannot be created) it stops instead of running the rest in whatever
folder your terminal is in. Never run these commands inside the Git Clarity repository itself.

```bash
(
set -e
DEMO=/tmp/gc-demo
rm -rf "$DEMO"
mkdir -p "$DEMO"
cd "$DEMO"
git init -q --bare -b main remote.git
git clone -q remote.git campus-events
cd campus-events
test "$(basename "$PWD")" = campus-events
git config user.name "Sam Rivera"
git config user.email "sam@example.com"
git config commit.gpgsign false

mkdir -p src
echo '# Campus Events' > README.md
echo 'console.log("campus events");' > src/app.js
git add -A && git commit -q --date="4 days ago" -m "Start the campus events site"
echo 'export const events = [];' > src/events.js
git add -A && git commit -q --date="1 day ago" -m "Add an empty events list"
echo 'body { font-family: sans-serif; }' > src/style.css
git add -A && git commit -q --date="1 day ago" -m "Add basic page styles"
git push -q -u origin main

git switch -q -c feature/login
echo 'console.log("campus events + login");' > src/app.js
echo 'export function login() {}' > src/login.js
git add -A && git commit -q -m "Add a login button"
git switch -q main
git switch -q -c feature/navbar
echo 'console.log("campus events + navbar");' > src/app.js
echo 'export function navbar() {}' > src/navbar.js
git add -A && git commit -q -m "Add a navigation bar"
git switch -q main

echo 'export const events = ["Hack night"];' > src/events.js
git add -A && git commit -q -m "List the first event"

echo 'Find and RSVP to campus events.' >> README.md
echo 'export function rsvp() {}' > src/rsvp.js && git add src/rsvp.js
echo 'ideas: map view' > notes.txt
)
```

Then press **F5** in this repo, and in the Extension Development Host open the folder
`/tmp/gc-demo/campus-events`. Run **Git Clarity: Open Dashboard** from the Command Palette.

> **If you have captured these before:** VS Code remembers Secret Guard acknowledgements per folder, and the
> folder path is the same each time. If shot 06 is not blocked, open the Safety tab and press
> **Undo acknowledge** on any acknowledged row first.

The fake key used in shots 06, 08 and 09 is assembled with `printf` so this guide never contains a whole
key, and it is not a real credential.

## Shots

### 10 · First-run help (`10-first-run-help.png`)

Capture this first, because the overlay opens on its own the first time a folder opens the dashboard.

- **Tab:** any (the overlay covers the dashboard). Overview behind it is fine.
- **Repository state:** the base setup.
- **Actions:** if the overlay is not showing, run **Git Clarity: Reset first-run help** from the Command Palette
  with the dashboard open. Scroll the dialog to the top.
- **Must be visible:** the title "Welcome to Git Clarity", the "The five tabs" explanations (Overview, Branches,
  Activity, Assistant, Safety), and the start of "Things you can ask" with at least one example such as
  `What changed in my project?`.
- **Caption:** A first-run guide explains each tab in plain words and lists every request the Assistant understands.

Press **Got it** before the next shot.

### 01 · Overview (`01-overview.png`)

- **Tab:** Overview.
- **Repository state:** the base setup (1 commit not uploaded; `README.md` edited, `src/rsvp.js` staged,
  `notes.txt` new).
- **Actions:** none.
- **Must be visible:** the sync card "1 commit to upload." with its explanation; the Repository, Current branch
  and Changed files cards; "1 staged · 1 not staged · 1 untracked"; the rows `README.md` (Modified, Not staged),
  `src/rsvp.js` (Added, Staged) and `notes.txt` (Untracked); the legend explaining Staged, Not staged and Untracked.
- **Caption:** The Overview shows what changed and whether it is ready to commit, in words a beginner understands.

### 02 · Branches (`02-branches.png`)

- **Tab:** Branches.
- **Repository state:** the base setup.
- **Actions:** none. Scroll so the warning and the first two branch cards are both in view.
- **Must be visible:** "3 branches in this project."; the warning "These files are changed on more than one
  branch." naming `src/app.js` on feature/login and feature/navbar; `main` with the "You are here" and
  "Main branch" tags; a feature branch with "1 commit only on this branch (not on main yet)." and
  "1 commit on main that this branch doesn't have yet."; a "Last commit:" line with author and time; the
  "Files this branch changed compared with main" list.
- **Caption:** Branches compares every branch with main and warns when two branches change the same file.

### 03 · Activity (`03-activity.png`)

- **Tab:** Activity.
- **Repository state:** the base setup.
- **Actions:** none.
- **Must be visible:** "Recent activity"; the day headings "Today", "Yesterday" and a dated heading (four days
  ago); each commit's message with "Sam Rivera" and a time; the "Recently touched files" card.
- **Caption:** Activity groups recent commits by day so you can see who saved what, and when.

### 04 · Assistant, empty (`04-assistant-empty.png`)

- **Tab:** Assistant.
- **Repository state:** the base setup.
- **Actions:** none; leave the text box empty.
- **Must be visible:** the text box, the **Ask** button, "Nothing runs until you press Confirm.", and all nine
  example chips (What changed?, Show recent history, Save my changes, Undo last commit, Discard my changes,
  Create a new branch, Switch branches, Upload my changes, Get the latest changes).
- **Caption:** Ask for what you want in plain English, or start from one of nine examples.

### 05 · Assistant, plan preview (`05-assistant-plan.png`)

- **Tab:** Assistant.
- **Repository state:** the base setup (no secrets anywhere).
- **Actions:** type `Save my changes: add RSVP` and press **Ask**. Do **not** press Confirm.
- **Must be visible:** the plan title "Save your changes (commit)"; the **Careful** badge with "This changes your
  project, but it can be undone."; "What it does"; "Commands that will run" with `git add -A` and
  `git commit -m "add RSVP"`; "Affected" listing the three files; "How to undo"; **Confirm** (enabled) and **Cancel**.
- **Caption:** Before anything runs, the Assistant shows the exact commands, the risk, the files involved and how to undo it.

Press **Cancel** afterwards.

### 07 · Assistant, unrecognized request (`07-assistant-unrecognized.png`)

- **Tab:** Assistant.
- **Repository state:** the base setup.
- **Actions:** type `make me a sandwich` and press **Ask**.
- **Must be visible:** "I don't recognize that yet" with "I don't recognize "make me a sandwich" yet, so I won't
  guess.", and the list of all nine supported actions with their descriptions. No Confirm button.
- **Caption:** When a request is not understood, the Assistant says so and lists what it can do instead of guessing.

Clear the text box before the next shot (this screen has no Cancel button; the next Ask replaces it).

### 06 · Assistant, blocked commit (`06-assistant-blocked.png`)

- **Tab:** Assistant.
- **Repository state:** add a file with a fake AWS key:
  ```bash
  cd /tmp/gc-demo/campus-events && printf 'const awsKeyId = "AKIA%s";\n' ZZ9Q4K2M7T1B8R3W > src/config.js
  ```
- **Actions:** type `Save my changes: add RSVP` and press **Ask**.
- **Must be visible:** the red section "Blocked: Secret Guard stopped this commit" with the reason naming
  `src/config.js line 1`; the warning "Only acknowledge a finding if you are sure it is not a real secret.";
  the finding card with the **High** badge, "What we found.", the masked snippet (`AKIA…8R3W`), "Why it
  matters." and "What to do next."; the **Acknowledge** and **Open file** buttons; **Confirm** disabled.
- **Caption:** Secret Guard stops a commit that contains a likely API key and explains exactly what to do about it.

Press **Cancel**. Do not acknowledge here.

### 08 · Safety, findings (`08-safety-findings.png`)

- **Tab:** Safety.
- **Repository state:** keep `src/config.js` from shot 06 (not staged) and add a staged `.env`:
  ```bash
  cd /tmp/gc-demo/campus-events && printf 'AWS_ACCESS_KEY_ID=AKIA%s\n' ZZ9Q4K2M7T1B8R3W > .env && git add .env
  ```
- **Actions:** none (wait up to four seconds for the tab to refresh).
- **Must be visible:** the Secret Guard card with "2 high-severity findings will block a commit." and the
  note that it "cannot prove there are no secrets"; the section "Staged, about to be committed" with the `.env`
  finding; the section "In your working files" with the `src/config.js` finding; on each card the **High** badge,
  "What we found.", the masked snippet, "Why it matters.", "What to do next.", the `file:line` link and
  **Acknowledge**; **Add to .gitignore** on the `.env` card only.
- **Caption:** The Safety tab separates what is about to be committed from other changed files and explains each possible secret.

### 09 · Safety, acknowledged (`09-safety-acknowledged.png`)

- **Tab:** Safety.
- **Repository state:** as in shot 08.
- **Actions:** press **Acknowledge** on the `src/config.js` card, then click its collapsed row to expand it.
- **Must be visible:** "1 high-severity finding will block a commit."; "1 acknowledged finding in this
  workspace."; the expanded "Acknowledged · …" row for `src/config.js` with "You marked this as not a real
  secret. It no longer blocks a commit." and **Undo acknowledge**; the `.env` finding still open with
  **Acknowledge**.
- **Caption:** Acknowledging a false alarm collapses it without hiding it, and it can be undone at any time.

**Clean up:** press **Undo acknowledge**, then remove the fake keys:

```bash
cd /tmp/gc-demo/campus-events && git rm -q --cached .env && rm -f .env src/config.js
```

## After capturing

1. Commit the PNGs to `docs/screenshots/` with the exact file names above.
2. Change the shot's row in the **Status** table to "Yes".
3. In `README.md`, under **Screenshots**, replace that shot's table row with an image and caption, for example:
   ```markdown
   ![Secret Guard stops a commit that contains a likely API key](docs/screenshots/06-assistant-blocked.png)
   *Secret Guard stops a commit that contains a likely API key and explains exactly what to do about it.*
   ```
   Only add an image line once the PNG is committed, so the README never shows a broken image.
