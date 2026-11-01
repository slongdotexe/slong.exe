#!/usr/bin/env bash
set -euo pipefail

PROFILE=slongdotexe
REGION=ap-southeast-2
DOMAIN_NAME=development.seanlong.me

usage() {
  printf 'Usage: bash %s [--profile PROFILE] [--region REGION] [--domain-name DOMAIN]\n' "$0"
}

while (( $# > 0 )); do
  case "$1" in
    --help) usage; exit 0 ;;
    --profile|--region|--domain-name)
      if (( $# < 2 )) || [[ -z "$2" || "$2" == --* ]]; then
        printf 'ERROR: %s requires a value.\n' "$1" >&2
        exit 1
      fi
      case "$1" in
        --profile) PROFILE="$2" ;;
        --region) REGION="$2" ;;
        --domain-name) DOMAIN_NAME="$2" ;;
      esac
      shift 2
      ;;
    *) printf 'ERROR: Unknown argument: %s\n' "$1" >&2; usage >&2; exit 1 ;;
  esac
done
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

bash infra/dns-certificates/scripts/deploy.sh \
  --environment development \
  --profile "$PROFILE" \
  --domain-name "$DOMAIN_NAME"

bash applications/nextjs-slongdotexe/scripts/deploy.sh \
  --environment development --profile "$PROFILE"

bash infra/cdn-cloudfront/scripts/deploy.sh \
  --environment development \
  --profile "$PROFILE" \
  --app-stack-name sam-nextjs-slongdotexe-development \
  --app-region "$REGION"

printf '\nSet CloudFrontDistributionId in the development deployment parameters in applications/nextjs-slongdotexe/samconfig.toml, then run:\n'
printf 'bash applications/nextjs-slongdotexe/scripts/deploy.sh --skip-build --environment development --profile %q\n' "$PROFILE"
