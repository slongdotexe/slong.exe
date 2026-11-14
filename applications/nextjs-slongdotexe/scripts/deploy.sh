#!/usr/bin/env bash
set -euo pipefail

CONFIG_ENV=development
PROFILE=slongdotexe
SKIP_BUILD=false

usage() {
  printf 'Usage: bash %s [--environment development|production] [--profile PROFILE] [--skip-build]\n' "$0"
  printf 'Deployment defaults are defined in the application samconfig.toml.\n'
  printf 'Set CloudFrontDistributionId in samconfig.toml after CDN deployment, then use --skip-build to update access without rebuilding.\n'
}

while (( $# > 0 )); do
  case "$1" in
    --help) usage; exit 0 ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --environment|--profile)
      if (( $# < 2 )) || [[ -z "$2" || "$2" == --* ]]; then
        printf 'ERROR: %s requires a value.\n' "$1" >&2
        exit 1
      fi
      case "$1" in
        --environment) CONFIG_ENV="$2" ;;
        --profile) PROFILE="$2" ;;
      esac
      shift 2
      ;;
    *) printf 'ERROR: Unknown argument: %s\n' "$1" >&2; usage >&2; exit 1 ;;
  esac
done
if [[ "$CONFIG_ENV" == ephemeral ]]; then
  printf 'ERROR: Ephemeral applications must be deployed as named PR previews.\n' >&2
  printf 'From the repository root, deploy shared infrastructure with: bash scripts/deploy-ephemeral.sh --profile %q\n' "$PROFILE" >&2
  printf 'Then deploy an application with: bash applications/nextjs-slongdotexe/scripts/deploy-preview.sh pr-NUMBER --profile %q\n' "$PROFILE" >&2
  exit 1
fi
if [[ "$CONFIG_ENV" != development && "$CONFIG_ENV" != production ]]; then
  printf 'ERROR: --environment must be development or production.\n' >&2
  exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../../.."
APP=applications/nextjs-slongdotexe
ARTIFACT="$APP/infra/application/out/web-function"
export AWS_PAGER=''

yarn workspace @slongdotexe/infra-common build:cache "$PWD/$APP/infra/application/out/cache"
node "$SCRIPT_DIR/build-preview-handler.mts"
if ! command -v sam >/dev/null 2>&1; then
  printf "ERROR: Required command 'sam' is not installed or not on PATH.\n" >&2
  exit 1
fi
if [[ "$SKIP_BUILD" == true ]]; then
  bash "$SCRIPT_DIR/build-artifact.sh" --skip-build
else
  bash "$SCRIPT_DIR/build-artifact.sh"
fi

printf 'Deploying %s application infrastructure...\n' "$CONFIG_ENV"
sam deploy --template-file "$APP/infra/application/template.yaml" \
  --config-file "$SCRIPT_DIR/../infra/application/samconfig.toml" \
  --config-env "$CONFIG_ENV" \
  --profile "$PROFILE"
