#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == --help ]] || (( $# < 1 || $# > 2 )); then
  printf 'Usage: bash %s ENVIRONMENT [PROFILE]\n' "$0"
  printf 'ENVIRONMENT: development or production\n'
  printf 'Optional environment: DNS_STACK_NAME, DOMAIN_NAME\n'
  [[ "${1:-}" == --help ]] && exit 0
  exit 1
fi

ENVIRONMENT="$1"
PROFILE="${2:-${AWS_PROFILE:-slongdotexe}}"
STACK_NAME="${DNS_STACK_NAME:-sam-nextjs-slongdotexe-${ENVIRONMENT}-dns}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export AWS_PAGER=''

case "$ENVIRONMENT" in
  development)
    DOMAIN_NAME="${DOMAIN_NAME:-development.seanlong.me}"
    CREATE_HOSTED_ZONE=true
    INCLUDE_WILDCARD=true
    printf 'During creation, find HostedZone in the stack Resources tab and copy its four name servers from Route53.\n'
    printf 'Publish DNS-only NS records for %s in the parent Cloudflare zone. ACM validation waits for delegation.\n' "$DOMAIN_NAME"
    ;;
  production)
    DOMAIN_NAME="${DOMAIN_NAME:-seanlong.me}"
    CREATE_HOSTED_ZONE=false
    INCLUDE_WILDCARD=false
    printf 'Publish the certificate validation CNAME shown in ACM (us-east-1) as DNS-only in Cloudflare.\n'
    printf 'Deployment waits for validation. No Route53 zone will be created.\n'
    ;;
  *)
    printf 'ERROR: ENVIRONMENT must be development or production.\n' >&2
    exit 1
    ;;
esac

aws cloudformation deploy \
  --template-file "$SCRIPT_DIR/../template.yaml" \
  --stack-name "$STACK_NAME" --region us-east-1 --profile "$PROFILE" \
  --no-fail-on-empty-changeset \
  --parameter-overrides "DomainName=$DOMAIN_NAME" "CreateHostedZone=$CREATE_HOSTED_ZONE" \
    "IncludeWildcard=$INCLUDE_WILDCARD"

aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region us-east-1 --profile "$PROFILE" \
  --query 'Stacks[0].Outputs' --output table