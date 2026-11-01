#!/usr/bin/env bash
set -euo pipefail

PROFILE=slongdotexe
REGION=ap-southeast-2
DOMAIN_NAME=development.seanlong.me
DNS_STACK_NAME=sam-nextjs-slongdotexe-development-dns

usage() {
  printf 'Usage: bash %s [--profile PROFILE] [--region REGION] [--domain-name DOMAIN] [--dns-stack-name NAME]\n' "$0"
  printf 'Deploys shared preview cache and CDN infrastructure, not an application.\n'
  printf 'Reuses development DNS/certificates; the ephemeral CDN owns only the wildcard hostname.\n'
}

while (( $# > 0 )); do
  case "$1" in
    --help) usage; exit 0 ;;
    --profile|--region|--domain-name|--dns-stack-name)
      if (( $# < 2 )) || [[ -z "$2" || "$2" == --* ]]; then
        printf 'ERROR: %s requires a value.\n' "$1" >&2
        exit 1
      fi
      case "$1" in
        --profile) PROFILE="$2" ;;
        --region) REGION="$2" ;;
        --domain-name) DOMAIN_NAME="$2" ;;
        --dns-stack-name) DNS_STACK_NAME="$2" ;;
      esac
      shift 2
      ;;
    *) printf 'ERROR: Unknown argument: %s\n' "$1" >&2; usage >&2; exit 1 ;;
  esac
done
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

bash infra/dns-certificates/scripts/deploy.sh \
  --environment ephemeral --profile "$PROFILE" --domain-name "$DOMAIN_NAME" \
  --stack-name "$DNS_STACK_NAME"

bash libraries/application-infrastructure/scripts/deploy.sh \
  --profile "$PROFILE" --region "$REGION"

bash infra/cdn-cloudfront/scripts/deploy.sh \
  --environment ephemeral --profile "$PROFILE" \
  --app-region "$REGION" \
  --dns-stack-name "$DNS_STACK_NAME"

printf '\nDeploy a PR application with:\n'
printf 'bash applications/nextjs-slongdotexe/scripts/deploy-preview.sh pr-NUMBER --profile %q --region %q\n' "$PROFILE" "$REGION"
