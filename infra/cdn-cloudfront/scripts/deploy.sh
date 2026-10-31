#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == --help ]] || (( $# < 2 || $# > 3 )); then
  printf 'Usage: bash %s APP_STACK DOMAIN [PROFILE]\n' "$0"
  printf 'Optional environment: AWS_REGION, CDN_STACK_NAME, HOSTED_ZONE_ID, RATE_LIMIT\n'
  [[ "${1:-}" == --help ]] && exit 0
  exit 1
fi

APP_STACK="$1"
DOMAIN_NAME="$2"
PROFILE="${3:-${AWS_PROFILE:-slongdotexe}}"
APP_REGION="${AWS_REGION:-ap-southeast-2}"
STACK_NAME="${CDN_STACK_NAME:-${APP_STACK}-cdn}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export AWS_PAGER=''

ORIGIN_DOMAIN="$(aws cloudformation describe-stacks \
  --stack-name "$APP_STACK" --region "$APP_REGION" --profile "$PROFILE" \
  --query "Stacks[0].Outputs[?OutputKey=='WebAppOriginDomainName'].OutputValue | [0]" --output text)"
if [[ -z "$ORIGIN_DOMAIN" || "$ORIGIN_DOMAIN" == None ]]; then
  printf 'ERROR: Deploy the application template with WebAppOriginDomainName first.\n' >&2
  exit 1
fi

if [[ -z "${HOSTED_ZONE_ID:-}" ]]; then
  printf 'ACM is managed by this stack. During creation, publish its validation CNAME in Cloudflare.\n'
  printf 'View pending certificate details in the ACM console in us-east-1; deployment waits for validation.\n'
fi
aws cloudformation deploy \
  --template-file "$SCRIPT_DIR/../template.yaml" \
  --stack-name "$STACK_NAME" --region us-east-1 --profile "$PROFILE" \
  --no-fail-on-empty-changeset \
  --parameter-overrides "WebAppOriginDomainName=$ORIGIN_DOMAIN" "DomainName=$DOMAIN_NAME" \
    "HostedZoneId=${HOSTED_ZONE_ID:-}" "RateLimit=${RATE_LIMIT:-2000}"

aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region us-east-1 --profile "$PROFILE" \
  --query 'Stacks[0].Outputs' --output table
printf 'Set the app CloudFrontDistributionId parameter to DistributionId above before publishing DNS.\n'