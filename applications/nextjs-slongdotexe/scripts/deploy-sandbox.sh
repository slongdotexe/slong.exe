#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-${AWS_PROFILE:-slongdotexe}}"
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

APP=applications/nextjs-slongdotexe
ARTIFACT="$APP/out/web-function"
rm -rf "$ARTIFACT" "$APP/.next/standalone"
yarn workspace @slongdotexe/nextjs-slongdotexe build

if [[ ! -f "$APP/.next/standalone/$APP/server.js" ]]; then
  echo "ERROR: Expected standalone server at $APP/.next/standalone/$APP/server.js." >&2
  exit 1
fi
mkdir -p "$ARTIFACT"
cp -R "$APP/.next/standalone/." "$ARTIFACT/"
cp -R "$APP/.next/static" "$ARTIFACT/$APP/.next/static"
cp -R "$APP/public" "$ARTIFACT/$APP/public"
find "$ARTIFACT" -type f \( -name '.env' -o -name '.env.*' \) -delete

for packaged_file in server.js web-function-entrypoint.cjs src/cache/handler.cjs src/cache/use-cache-handler.cjs src/cache/runtime.cjs src/cache/worker.cjs; do
  if [[ ! -f "$ARTIFACT/$APP/$packaged_file" ]]; then
    echo "ERROR: Required runtime file missing from artifact: $APP/$packaged_file" >&2
    exit 1
  fi
done

AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:8080 \
  node --require "$PWD/$ARTIFACT/$APP/web-function-entrypoint.cjs" \
  -e 'if (process.env.HOSTNAME !== "127.0.0.1" || process.env.PORT !== "8080") throw new Error("Web Function preload failed");'

echo "Deploying shared development infrastructure ($REGION)..."
sam deploy --template-file "$APP/template.yaml" \
  --stack-name "${STACK_NAME:-sam-nextjs-slongdotexe-development}" \
  --profile "$PROFILE" \
  --region "$REGION" \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset --no-confirm-changeset \
  --config-env development
