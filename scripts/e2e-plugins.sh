#!/usr/bin/env bash
# Adds every built-in plugin to a plugin-free app, one at a time, then removes them in
# reverse — checking the app after every step the way a user would: type-check, Jest,
# a Metro bundle, lint, doctor and the web build. At the end the app must be the one it
# started as, apart from the leftovers docs/plugins.md (R3) names.
#
# Usage: scripts/e2e-plugins.sh <app-dir> [ts|js]
# The app must come from `armemon init react-native … --plugins "" --platforms …,web`.
set -euo pipefail

APP="$(cd "$1" && pwd)"
LANGUAGE="${2:-ts}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
armemon() { node "$ROOT/packages/cli-armemon/dist/bin/armemon.js" "$@"; }
PLUGINS=(advanced-init splash ui essentials redux navigation)

cd "$APP"
if [ ! -d .git ]; then git init -q; fi
git add -A
git -c user.email=ci@armemon -c user.name=ci commit -qm "before plugins" --allow-empty
START="$(git rev-parse HEAD)"

check() {
  echo "::group::checks after $1"
  if [ "$LANGUAGE" = ts ]; then npx tsc --noEmit; fi
  npx jest --watchAll=false
  npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output "${RUNNER_TEMP:-/tmp}/plugins-bundle.js" > /dev/null
  npm run lint -- --quiet
  armemon doctor .
  npm run web:build > /dev/null
  echo "::endgroup::"
}

run() {
  local out
  out="$(armemon plugin "$@" --all-accept --json)"
  node -e '
    const r = JSON.parse(process.argv[1]);
    if (!r.ok) { console.error(JSON.stringify(r, null, 2)); process.exit(1); }
    console.log(`${r.action} ${r.plugin}: +${(r.created || []).length} ~${(r.edited || []).length} -${(r.deleted || []).length}`);
  ' "$out"
}

for plugin in "${PLUGINS[@]}"; do
  run add "$plugin"
  check "add $plugin"
done

for (( i=${#PLUGINS[@]}-1; i>=0; i-- )); do
  run remove "${PLUGINS[$i]}"
  check "remove ${PLUGINS[$i]}"
done

# Everything that differs from the app before any plugin, lockfile aside. R3 keeps root
# files and ignore lines (.env is ignored, so git doesn't list it); package.json only
# differs by npm's key order.
git add -A
changed="$(git diff --cached --name-only "$START" -- . ':!package-lock.json' ':!package.json')"
expected=".env.example
.gitignore"
if [ "$(echo "$changed" | sort)" != "$(echo "$expected" | sort)" ]; then
  echo "Removing every plugin should leave only: $(echo $expected). It left:"
  git diff --cached --stat "$START" -- . ':!package-lock.json' ':!package.json'
  exit 1
fi
node -e '
  const { execSync } = require("child_process");
  const sort = (v) => v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)])) : v;
  const before = JSON.stringify(sort(JSON.parse(execSync(`git show ${process.argv[1]}:package.json`, { encoding: "utf8" }))));
  const after = JSON.stringify(sort(JSON.parse(require("fs").readFileSync("package.json", "utf8"))));
  if (before !== after) { console.error("package.json differs from before the plugins were added"); process.exit(1); }
' "$START"
echo "Every plugin added and removed; the app is back where it started."
