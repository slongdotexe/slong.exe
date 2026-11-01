#!/usr/bin/env bash
set -euo pipefail

PREVIEW_NAME=''
PROFILE=slongdotexe
REGION=ap-southeast-2
SHARED_CACHE_STACK=sam-nextjs-slongdotexe-preview-cache
SKIP_BUILD=false

usage() {
  printf 'Usage: bash %s pr-NUMBER [--profile PROFILE] [--region REGION] [--skip-build]\n' "$0"
  printf 'Deploys the current checkout as a pinned PR revision and registers its CloudFront route.\n'
  printf 'Requires the shared preview cache and ephemeral CDN stacks to be deployed first.\n'
}

while (( $# > 0 )); do
  case "$1" in
    --help) usage; exit 0 ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --profile|--region)
      if (( $# < 2 )) || [[ -z "$2" || "$2" == --* ]]; then
        printf 'ERROR: %s requires a value.\n' "$1" >&2
        exit 1
      fi
      case "$1" in
        --profile) PROFILE="$2" ;;
        --region) REGION="$2" ;;
      esac
      shift 2
      ;;
    pr-*)
      if [[ -n "$PREVIEW_NAME" ]]; then
        printf 'ERROR: Supply exactly one PR name.\n' >&2
        exit 1
      fi
      PREVIEW_NAME="$1"; shift
      ;;
    *) printf 'ERROR: Unknown argument: %s\n' "$1" >&2; usage >&2; exit 1 ;;
  esac
done
if [[ ! "$PREVIEW_NAME" =~ ^pr-[0-9]+$ ]] || (( ${#PREVIEW_NAME} > 64 )); then
  printf 'ERROR: Supply a PR name such as pr-123 (maximum 64 characters).\n' >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../../.."
APP=applications/nextjs-slongdotexe
ARTIFACT="$APP/out/web-function"
STACK_NAME="sam-nextjs-slongdotexe-$PREVIEW_NAME"
export AWS_PAGER=''

for tool in sam node; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf "ERROR: Required command '%s' is not installed or not on PATH.\n" "$tool" >&2
    exit 1
  fi
done
if [[ "$SKIP_BUILD" == true ]]; then
  bash "$SCRIPT_DIR/build-artifact.sh" --skip-build
else
  bash "$SCRIPT_DIR/build-artifact.sh"
fi

node "$SCRIPT_DIR/build-preview-handler.mts"
printf 'Deploying %s application and registering its CloudFront route...\n' "$PREVIEW_NAME"
sam deploy --template-file "$APP/template.yaml" \
  --config-file "$SCRIPT_DIR/../samconfig.toml" --config-env preview \
  --stack-name "$STACK_NAME" --region "$REGION" --profile "$PROFILE" \
  --parameter-overrides "Environment=ephemeral" "LogLevel=DEBUG" "EndpointAuthType=IamAuth" \
    "SharedCacheStackName=$SHARED_CACHE_STACK" "PreviewName=$PREVIEW_NAME"
