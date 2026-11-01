#!/usr/bin/env bash
set -euo pipefail

PROFILE=slongdotexe
REGION=ap-southeast-2

usage() {
  printf 'Usage: bash %s [--profile PROFILE] [--region REGION]\n' "$0"
  printf 'Deploys the shared preview cache without building or deploying an application.\n'
}

while (( $# > 0 )); do
  case "$1" in
    --help) usage; exit 0 ;;
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
    *) printf 'ERROR: Unknown argument: %s\n' "$1" >&2; usage >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export AWS_PAGER=''
node "$SCRIPT_DIR/../build.ts" cache
sam deploy --template-file "$SCRIPT_DIR/../out/cache/template.yaml" \
  --config-file "$SCRIPT_DIR/../samconfig.toml" --config-env preview \
  --profile "$PROFILE" --region "$REGION"
