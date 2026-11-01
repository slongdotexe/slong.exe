#!/usr/bin/env bash
set -euo pipefail

APP_STACK=''
PROFILE=slongdotexe
APP_REGION=ap-southeast-2
STACK_NAME=''
DNS_STACK_NAME=''
RATE_LIMIT=2000
CONFIG_ENV=development
CREATE_HOSTED_ZONE=''

usage() {
  printf 'Usage: bash %s [--app-stack-name NAME] [--environment development|production|ephemeral] [--profile PROFILE] [--app-region REGION] [--stack-name NAME] [--dns-stack-name NAME] [--rate-limit NUMBER] [--create-hosted-zone true|false]\n' "$0"
  printf 'Defaults: profile=slongdotexe, app-region=ap-southeast-2, stack-name=APP_STACK-cdn, dns-stack-name=APP_STACK-dns (development DNS for ephemeral), rate-limit=2000\n'
  printf 'DNS exports supply the domain, certificate, and zone ID. Hosted zones default to true outside production. Only ephemeral enables wildcard routing.\n'
  printf 'Requires AWS CLI, SAM CLI, and Node.js. SAM manages deployment artifacts in us-east-1.\n'
}

while (( $# > 0 )); do
  case "$1" in
    --help) usage; exit 0 ;;
    --app-stack-name|--environment|--profile|--app-region|--stack-name|--dns-stack-name|--rate-limit|--create-hosted-zone)
      if (( $# < 2 )) || [[ -z "$2" || "$2" == --* ]]; then
        printf 'ERROR: %s requires a value.\n' "$1" >&2
        exit 1
      fi
      case "$1" in
        --app-stack-name) APP_STACK="$2" ;;
        --profile) PROFILE="$2" ;;
        --app-region) APP_REGION="$2" ;;
        --stack-name) STACK_NAME="$2" ;;
        --dns-stack-name) DNS_STACK_NAME="$2" ;;
        --rate-limit) RATE_LIMIT="$2" ;;
        --environment) CONFIG_ENV="$2" ;;
        --create-hosted-zone) CREATE_HOSTED_ZONE="$2" ;;
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
if [[ -z "$APP_STACK" && "$CONFIG_ENV" != ephemeral ]]; then
  printf 'ERROR: --app-stack-name is required for mainline environments.\n' >&2
  usage >&2
  exit 1
fi
if [[ ! "$RATE_LIMIT" =~ ^[0-9]+$ ]] || (( ${#RATE_LIMIT} > 10 )) || (( 10#$RATE_LIMIT < 10 || 10#$RATE_LIMIT > 2000000000 )); then
  printf 'ERROR: --rate-limit must be an integer between 10 and 2000000000.\n' >&2
  exit 1
fi
DNS_SWITCH_DEFAULT=false
if [[ "$CONFIG_ENV" != production ]]; then
  DNS_SWITCH_DEFAULT=true
fi
CREATE_HOSTED_ZONE="${CREATE_HOSTED_ZONE:-$DNS_SWITCH_DEFAULT}"
if [[ "$CREATE_HOSTED_ZONE" != true && "$CREATE_HOSTED_ZONE" != false ]]; then
  printf 'ERROR: --create-hosted-zone must be true or false.\n' >&2
  exit 1
fi
if [[ "$CONFIG_ENV" == ephemeral ]]; then
  STACK_NAME="${STACK_NAME:-sam-nextjs-slongdotexe-ephemeral-cdn}"
  DNS_STACK_NAME="${DNS_STACK_NAME:-sam-nextjs-slongdotexe-development-dns}"
else
  STACK_NAME="${STACK_NAME:-${APP_STACK}-cdn}"
  DNS_STACK_NAME="${DNS_STACK_NAME:-${APP_STACK}-dns}"
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export AWS_PAGER=''

node "$SCRIPT_DIR/build-cloudfront-handler.mts"
node "$SCRIPT_DIR/build-preview-handler.mts"

set -- "DNSStackName=$DNS_STACK_NAME" "CreateHostedZone=$CREATE_HOSTED_ZONE" \
  "Environment=$CONFIG_ENV" "RateLimit=$RATE_LIMIT" "AppRegion=$APP_REGION"
if [[ "$CONFIG_ENV" != ephemeral ]]; then
  ORIGIN_DOMAIN="$(aws cloudformation describe-stacks \
    --stack-name "$APP_STACK" --region "$APP_REGION" --profile "$PROFILE" \
    --query "Stacks[0].Outputs[?OutputKey=='WebAppOriginDomainName'].OutputValue | [0]" --output text)"
  if [[ -z "$ORIGIN_DOMAIN" || "$ORIGIN_DOMAIN" == None ]]; then
    printf 'ERROR: Deploy the application template with WebAppOriginDomainName first.\n' >&2
    exit 1
  fi
  set -- "$@" "WebAppOriginDomainName=$ORIGIN_DOMAIN"
fi

sam deploy \
  --template-file "$SCRIPT_DIR/../template.yaml" \
  --config-file "$SCRIPT_DIR/../samconfig.toml" --config-env "$CONFIG_ENV" \
  --stack-name "$STACK_NAME" --region us-east-1 --profile "$PROFILE" \
  --parameter-overrides "$@"

aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region us-east-1 --profile "$PROFILE" \
  --query 'Stacks[0].Outputs' --output table
if [[ "$CONFIG_ENV" != ephemeral ]]; then
  printf 'Set CloudFrontDistributionId in the application samconfig.toml, then deploy with --skip-build.\n'
fi
