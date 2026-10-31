#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-${AWS_PROFILE:-okta}}"
REGION="${AWS_REGION:-ap-southeast-2}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../../.."

if (( $# > 1 )); then
  echo "Usage: bash $0 [profile]" >&2
  exit 1
fi

for tool in aws yarn sam node; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: Required command '$tool' is not installed or not on PATH." >&2
    exit 1
  fi
done

yarn workspace nextjs-slongdotexe build

APP=applications/nextjs-slongdotexe
ARTIFACT="$APP/out/web-function"
if [[ ! -f "$APP/.next/standalone/$APP/server.js" ]]; then
  echo "ERROR: Expected standalone server at $APP/.next/standalone/$APP/server.js." >&2
  exit 1
fi
rm -rf "$ARTIFACT"
mkdir -p "$ARTIFACT"
cp -R "$APP/.next/standalone/." "$ARTIFACT/"
cp -R "$APP/.next/static" "$ARTIFACT/$APP/.next/static"
cp -R "$APP/public" "$ARTIFACT/$APP/public"
find "$ARTIFACT" -type f \( -name '.env' -o -name '.env.*' \) -delete

echo "Deploying to sandbox ($REGION)..."
sam deploy --template-file "$APP/template.yaml" \
  --profile "$PROFILE" \
  --region "$REGION" \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset --no-confirm-changeset \
  --config-env ephemeral
