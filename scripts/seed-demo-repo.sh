#!/usr/bin/env bash
# Build the Git Clarity demo repo from scratch. Safe to run twice: the target is deleted first.
# Dates are computed in Node so this works with both BSD date (macOS) and GNU date (Linux).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-$ROOT/sample-repos/demo-app}"

if [[ "$TARGET" != /* ]]; then
	TARGET="$ROOT/$TARGET"
fi
if [[ "$TARGET" == "$ROOT" || "$TARGET" == "$ROOT/" ]]; then
	echo "Refusing to delete the Git Clarity repo itself." >&2
	exit 1
fi

# ISO-8601, days before now. Git accepts this as GIT_AUTHOR_DATE / GIT_COMMITTER_DATE.
stamp() {
	node -e 'process.stdout.write(new Date(Date.now() - Number(process.argv[1]) * 86400000).toISOString())' "$1"
}

commit_at() {
	local days="$1"
	local message="$2"
	shift 2
	git add -- "$@"
	local when
	when="$(stamp "$days")"
	GIT_AUTHOR_DATE="$when" GIT_COMMITTER_DATE="$when" git commit -m "$message" >/dev/null
}

write_file() {
	local file="$1"
	mkdir -p "$(dirname "$file")"
	cat > "$file"
}

rm -rf "$TARGET"
mkdir -p "$TARGET"
cd "$TARGET"

git init -b main >/dev/null
git config user.name "Demo Student"
git config user.email "demo.student@example.com"
git config commit.gpgsign false

write_file README.md <<'EOF'
# Demo App

A tiny app for learning Git.
EOF
commit_at 14 "first commit" README.md

write_file src/index.js <<'EOF'
function main() {
  console.log("hello");
}

main();
EOF
commit_at 13 "fix bug" src/index.js

write_file package.json <<'EOF'
{
  "name": "demo-app",
  "version": "1.0.0",
  "private": true
}
EOF
commit_at 12 "update" package.json

write_file src/utils.js <<'EOF'
function greet(name) {
  return "hi " + name;
}

module.exports = { greet };
EOF
commit_at 10 "add login page" src/utils.js

write_file src/index.js <<'EOF'
const { greet } = require("./utils");

function main() {
  console.log(greet("world"));
}

main();
EOF
commit_at 8 "stuff" src/index.js

write_file README.md <<'EOF'
# Demo App

A tiny app for learning Git. It says hello.
EOF
commit_at 7 "fix typo" README.md

# feature/login and feature/navbar both start here, so they stay behind the last three commits on main.
BRANCH_POINT="$(git rev-parse HEAD)"

write_file src/utils.js <<'EOF'
function greet(name) {
  return "hi " + name;
}

function shout(name) {
  return greet(name).toUpperCase();
}

module.exports = { greet, shout };
EOF
commit_at 4 "more changes" src/utils.js

write_file package.json <<'EOF'
{
  "name": "demo-app",
  "version": "1.0.1",
  "private": true
}
EOF
commit_at 2 "working now" package.json

write_file src/index.js <<'EOF'
const { greet } = require("./utils");

function main() {
  console.log(greet("world"));
}

// ready to demo
main();
EOF
commit_at 1 "final" src/index.js

git switch -q -c feature/login "$BRANCH_POINT"
write_file src/login.js <<'EOF'
function showLogin() {
  console.log("login");
}

module.exports = { showLogin };
EOF
commit_at 6 "add login form" src/login.js

write_file src/utils.js <<'EOF'
function greet(name) {
  return "hi " + name;
}

function checkPassword(value) {
  return value.length > 4;
}

module.exports = { greet, checkPassword };
EOF
commit_at 5 "check the password" src/utils.js

write_file src/login.js <<'EOF'
const { checkPassword } = require("./utils");

function showLogin(password) {
  console.log(checkPassword(password) ? "ok" : "try again");
}

module.exports = { showLogin };
EOF
commit_at 3 "wire up login" src/login.js

git switch -q main
git switch -q -c feature/navbar "$BRANCH_POINT"
write_file src/navbar.js <<'EOF'
function showNav() {
  console.log("home");
}

module.exports = { showNav };
EOF
commit_at 6 "add navbar" src/navbar.js

write_file src/utils.js <<'EOF'
function greet(name) {
  return "hi " + name;
}

function navLabel(page) {
  return page.toUpperCase();
}

module.exports = { greet, navLabel };
EOF
commit_at 5 "label the navbar" src/utils.js src/navbar.js

git switch -q main

# Leave a known working tree. src/index.js is edited but not staged, so it is an unstaged change.
write_file src/index.js <<'EOF'
const { greet } = require("./utils");

function main() {
  console.log(greet("demo"));
}

main();
EOF

write_file src/utils.js <<'EOF'
function greet(name) {
  return "hello " + name;
}

function shout(name) {
  return greet(name).toUpperCase();
}

module.exports = { greet, shout };
EOF
git add -- src/utils.js

write_file config.js <<'EOF'
const awsKey = "AKIAZZ9Q4K2M7T1B8R3W";
const api_key = "your_api_key_here";
EOF
git add -- config.js

write_file .env <<'EOF'
DB_PASSWORD=supersecret123
AWS_SECRET_ACCESS_KEY=notarealsecretvalue1234567890
EOF

write_file notes.txt <<'EOF'
Remember to finish the readme later.
EOF

echo "Demo repo: $TARGET"
echo "Current branch: $(git branch --show-current)"
echo "Branches:"
git for-each-ref --format='  %(refname:short)' refs/heads | sort
echo "Staged:"
git diff --cached --name-status | sed 's/^/  /'
echo "Unstaged:"
git diff --name-status | sed 's/^/  /'
echo "Untracked:"
git ls-files --others --exclude-standard | sed 's/^/  /'
