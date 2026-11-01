#!/usr/bin/env bash
set -euo pipefail

CONFIG_ENV=development
PROFILE=slongdotexe
SKIP_BUILD=false

usage() {
  printf 'Usage: bash %s [--environment development|production|ephemeral] [--profile PROFILE] [--skip-build]\n' "$0"
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
if [[ "$CONFIG_ENV" != development && "$CONFIG_ENV" != production && "$CONFIG_ENV" != ephemeral ]]; then
  printf 'ERROR: --environment must be development, production, or ephemeral.\n' >&2
  exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../../.."
APP=applications/nextjs-slongdotexe
ARTIFACT="$APP/out/web-function"
export AWS_PAGER=''

yarn workspace @slongdotexe/application-infrastructure build "$PWD/$APP/out/cache"
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
sam deploy --template-file "$APP/template.yaml" \
  --config-file "$SCRIPT_DIR/../samconfig.toml" \
  --config-env "$CONFIG_ENV" \
  --profile "$PROFILE"
