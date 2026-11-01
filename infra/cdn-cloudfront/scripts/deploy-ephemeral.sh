#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == --help ]] || (( $# < 2 || $# > 3 )); then
  printf 'Usage: bash %s APP_STACK DOMAIN [PROFILE]\n' "$0"
  printf 'Optional environment: AWS_REGION, CDN_STACK_NAME, DNS_STACK_NAME, RATE_LIMIT\n'
  printf 'Requires AWS CLI, SAM CLI, and Node.js. SAM manages deployment artifacts in us-east-1.\n'
  [[ "${1:-}" == --help ]] && exit 0
  exit 1
fi

APP_STACK="$1"
DOMAIN_NAME="$2"
PROFILE="${3:-${AWS_PROFILE:-slongdotexe}}"
APP_REGION="${AWS_REGION:-ap-southeast-2}"
STACK_NAME="${CDN_STACK_NAME:-${APP_STACK}-cdn}"
DNS_STACK_NAME="${DNS_STACK_NAME:-${APP_STACK}-dns}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export AWS_PAGER=''

node "$SCRIPT_DIR/build-cloudfront-handler.mts"
node "$SCRIPT_DIR/build-preview-handler.mts"

CERTIFICATE_ARN="$(aws cloudformation describe-stacks \
  --stack-name "$DNS_STACK_NAME" --region us-east-1 --profile "$PROFILE" \
  --query "Stacks[0].Outputs[?OutputKey=='CertificateArn'].OutputValue | [0]" --output text)"
HOSTED_ZONE_ID="$(aws cloudformation describe-stacks \
  --stack-name "$DNS_STACK_NAME" --region us-east-1 --profile "$PROFILE" \
  --query "Stacks[0].Outputs[?OutputKey=='HostedZoneId'].OutputValue | [0]" --output text)"
INCLUDE_WILDCARD="$(aws cloudformation describe-stacks \
  --stack-name "$DNS_STACK_NAME" --region us-east-1 --profile "$PROFILE" \
  --query "Stacks[0].Parameters[?ParameterKey=='IncludeWildcard'].ParameterValue | [0]" --output text)"
CERTIFICATE_DOMAIN="$(aws cloudformation describe-stacks \
  --stack-name "$DNS_STACK_NAME" --region us-east-1 --profile "$PROFILE" \
  --query "Stacks[0].Parameters[?ParameterKey=='DomainName'].ParameterValue | [0]" --output text)"
if [[ -z "$CERTIFICATE_ARN" || "$CERTIFICATE_ARN" == None || "$CERTIFICATE_DOMAIN" != "$DOMAIN_NAME" ]]; then
  printf 'ERROR: Deploy the DNS/certificate stack for %s first.\n' "$DOMAIN_NAME" >&2
  exit 1
fi
if [[ "$HOSTED_ZONE_ID" == None ]]; then
  HOSTED_ZONE_ID=''
fi

ORIGIN_DOMAIN="$(aws cloudformation describe-stacks \
  --stack-name "$APP_STACK" --region "$APP_REGION" --profile "$PROFILE" \
  --query "Stacks[0].Outputs[?OutputKey=='WebAppOriginDomainName'].OutputValue | [0]" --output text)"
if [[ -z "$ORIGIN_DOMAIN" || "$ORIGIN_DOMAIN" == None ]]; then
  printf 'ERROR: Deploy the application template with WebAppOriginDomainName first.\n' >&2
  exit 1
fi

sam deploy \
  --template-file "$SCRIPT_DIR/../template.yaml" \
  --stack-name "$STACK_NAME" --region us-east-1 --profile "$PROFILE" \
  --resolve-s3 --s3-prefix "$STACK_NAME" \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND \
  --no-fail-on-empty-changeset --no-confirm-changeset \
  --parameter-overrides "WebAppOriginDomainName=$ORIGIN_DOMAIN" "DomainName=$DOMAIN_NAME" \
    "CertificateArn=$CERTIFICATE_ARN" "HostedZoneId=$HOSTED_ZONE_ID" \
    "IncludeWildcard=$INCLUDE_WILDCARD" "RateLimit=${RATE_LIMIT:-2000}"

aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region us-east-1 --profile "$PROFILE" \
  --query 'Stacks[0].Outputs' --output table
printf 'Set the app CloudFrontDistributionId parameter to DistributionId above before publishing DNS.\n'