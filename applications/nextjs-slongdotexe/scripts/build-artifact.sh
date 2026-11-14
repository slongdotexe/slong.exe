#!/usr/bin/env bash
set -euo pipefail

SKIP_BUILD=false
case "${1:-}" in
  '') ;;
  --skip-build) SKIP_BUILD=true ;;
  *) printf 'ERROR: Expected --skip-build or no arguments.\n' >&2; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../../.."
APP=applications/nextjs-slongdotexe
ARTIFACT="$APP/out/web-function"

if [[ "$SKIP_BUILD" == true ]]; then
  if [[ ! -f "$ARTIFACT/$APP/server.js" ]]; then
    printf 'ERROR: Build the application artifact before using --skip-build.\n' >&2
    exit 1
  fi
  exit 0
fi

for tool in yarn node; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf "ERROR: Required command '%s' is not installed or not on PATH.\n" "$tool" >&2
    exit 1
  fi
done

rm -rf "$ARTIFACT" "$APP/.next/standalone"
yarn workspace @slongdotexe/nextjs-slongdotexe build

if [[ ! -f "$APP/.next/standalone/$APP/server.js" ]]; then
  printf 'ERROR: Expected standalone server at %s/.next/standalone/%s/server.js.\n' "$APP" "$APP" >&2
  exit 1
fi
mkdir -p "$ARTIFACT"
cp -R "$APP/.next/standalone/." "$ARTIFACT/"
cp -R "$APP/.next/static" "$ARTIFACT/$APP/.next/static"
cp -R "$APP/public" "$ARTIFACT/$APP/public"
find "$ARTIFACT" -type f \( -name '.env' -o -name '.env.*' \) -delete
