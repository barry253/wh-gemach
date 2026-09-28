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
echo "Built dist/:"
ls dist
