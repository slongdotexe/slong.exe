#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT=''
PROFILE=slongdotexe
STACK_NAME=''
DOMAIN_NAME=''

usage() {
  printf 'Usage: bash %s --environment development|production|ephemeral [--profile PROFILE] [--stack-name NAME] [--domain-name DOMAIN]\n' "$0"
  printf 'Defaults: profile=slongdotexe; production uses its DNS stack and seanlong.me; development and ephemeral share sam-nextjs-slongdotexe-development-dns and development.seanlong.me.\n'
  printf 'DNS and certificates deploy in us-east-1.\n'
}

while (( $# > 0 )); do
  case "$1" in
    --help) usage; exit 0 ;;
    --environment|--profile|--stack-name|--domain-name)
      if (( $# < 2 )) || [[ -z "$2" || "$2" == --* ]]; then
        printf 'ERROR: %s requires a value.\n' "$1" >&2
        exit 1
      fi
      case "$1" in
        --environment) ENVIRONMENT="$2" ;;
        --profile) PROFILE="$2" ;;
        --stack-name) STACK_NAME="$2" ;;
        --domain-name) DOMAIN_NAME="$2" ;;
      esac
      shift 2
      ;;
    *) printf 'ERROR: Unknown argument: %s\n' "$1" >&2; usage >&2; exit 1 ;;
  esac
done
if [[ "$ENVIRONMENT" != development && "$ENVIRONMENT" != production && "$ENVIRONMENT" != ephemeral ]]; then
  printf 'ERROR: --environment must be development, production, or ephemeral.\n' >&2
  exit 1
fi
DNS_ENVIRONMENT="$ENVIRONMENT"
if [[ "$ENVIRONMENT" == ephemeral ]]; then
  DNS_ENVIRONMENT=development
fi
STACK_NAME="${STACK_NAME:-sam-nextjs-slongdotexe-${DNS_ENVIRONMENT}-dns}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export AWS_PAGER=''

case "$ENVIRONMENT" in
  development|ephemeral)
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
    printf 'ERROR: --environment must be development, production, or ephemeral.\n' >&2
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
