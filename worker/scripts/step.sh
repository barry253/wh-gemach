#!/usr/bin/env bash
# Runs one migration step for the D1 workflow. The repo is public, so its Actions logs are too:
# output lines that could contain record values (SQL statements) are hidden, long lines are cut,
# and on failure the last lines also become an error annotation (readable without the full log).
#   scripts/step.sh "<title>" <command...>
title="$1"; shift
out=$("$@" 2>&1); code=$?
# Also hide signed download links (wrangler d1 export prints one that works for an hour).
clean=$(printf '%s\n' "$out" | sed -E '/INSERT INTO|VALUES ?\(|UPDATE [a-z_]+ SET|cloudflarestorage\.com|X-Amz-|https?:\/\/[^ ]*[?&](sig|signature|token)=/Id' | cut -c1-300)
printf '%s\n' "$clean"
# The whole (cleaned) output as a notice too, so it can be read from the API.
all=$(printf '%s\n' "$clean" | tail -c 60000 | sed -e 's/%/%25/g' | sed -e ':a;N;$!ba;s/\n/%0A/g')
echo "::notice title=${title} (output)::${all}"
if [ $code -ne 0 ]; then
  msg=$(printf '%s\n' "$clean" | tail -n 25 | sed -e 's/%/%25/g' | sed -e ':a;N;$!ba;s/\n/%0A/g')
  echo "::error title=${title}::${msg}"
fi
exit $code
