#!/bin/sh
# Build the Cloudflare Pages output: public site + admin + legacy embed.
# Cloudflare Pages: build command `sh build.sh`, output directory `dist`.
set -eu
cd "$(dirname "$0")"
rm -rf dist
mkdir dist
cp -R site/. dist/
cp admin.html dist/admin.html
cp embed.html dist/embed.html

# Cache-busting (Oct 15, 2026). Every "/assets/<file>.js|css?v=<anything>" link in the built pages gets
# ?v=<first 10 hex digits of that file's SHA-256>, so a changed script or stylesheet always gets a new
# URL and an unchanged one keeps its URL. The ?v= numbers in site/*.html are no longer bumped by hand
# (two changes once both bumped gemach.js to v36, and browsers kept the older v36 — the request form
# broke). Source files are untouched; only dist/ is rewritten. tests/site/asset-versions.test.cjs checks it.
sha10() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -c1-10; }
for f in $(cd dist && find assets -type f \( -name '*.js' -o -name '*.css' \) | sort); do
  h=$(sha10 "dist/$f")
  pat=$(printf '%s' "$f" | sed 's/[.]/\\./g')
  find dist -name '*.html' -exec sed -i.bak -E "s#\"/${pat}\\?v=[A-Za-z0-9]+\"#\"/${f}?v=${h}\"#g" {} +
done
find dist -name '*.html.bak' -exec rm -f {} +

# Which commit this build is (Oct 22, 2026): the live check waits until whgemachs.org/version.txt shows the
# commit it was started for, so it never tests the previous deploy. Cloudflare Pages sets CF_PAGES_COMMIT_SHA.
sha="${CF_PAGES_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo local)}"
printf '%s\n' "$sha" > dist/version.txt

echo "Built dist/:"
ls dist
