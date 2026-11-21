#!/usr/bin/env bash
set -euo pipefail

REPO=slongdotexe/slong.exe
STACK_NAME=sam-nextjs-slongdotexe-bootstrap
REGION=ap-southeast-2
PROFILE=slongdotexe
APPLICATION=nextjs
OUTPUTS=''
ENVIRONMENTS=''
TARGET=''
OUTPUT_TARGET=''
export AWS_PAGER=''

output() {
  local key="$1"
  jq -er --arg key "$key" '.[] | select(.OutputKey == $key) | .OutputValue | select(length > 0)' <<< "$OUTPUTS"
}

set_variable() {
  local name="$1"
  local value="$2"
  gh variable set "$name" --repo "$REPO" --env "$TARGET" --body "$value"
}

while (( $# > 0 )); do
  case "$1" in
    --repo|--stack-name|--region|--profile|--application)
      if (( $# < 2 )) || [[ -z "$2" || "$2" == --* ]]; then
        printf 'ERROR: %s requires a value.\n' "$1" >&2
        exit 1
      fi
      case "$1" in
        --repo) REPO="$2" ;;
        --stack-name) STACK_NAME="$2" ;;
        --region) REGION="$2" ;;
        --profile) PROFILE="$2" ;;
        --application) APPLICATION="$2" ;;
      esac
      shift 2
      ;;
    *) printf 'ERROR: Unknown argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done

if [[ ! "$APPLICATION" =~ ^[a-z][a-z0-9-]*$ ]]; then
  printf 'ERROR: --application must be a lowercase application identifier.\n' >&2
  exit 1
fi

OUTPUTS="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --region "$REGION" --profile "$PROFILE" --query 'Stacks[0].Outputs' --output json)"

output RepositoryPrefix >/dev/null
output ApplicationResourcePrefix >/dev/null

ENVIRONMENTS="$(gh api "repos/$REPO/environments" --jq '.environments[].name')"

for TARGET in development production preview preview-infrastructure; do
  if ! grep -Fxq "$TARGET" <<< "$ENVIRONMENTS"; then
    gh api --method PUT "repos/$REPO/environments/$TARGET" --silent
  fi

  case "$TARGET" in
    development) OUTPUT_TARGET=Development ;;
    production) OUTPUT_TARGET=Production ;;
    preview|preview-infrastructure) OUTPUT_TARGET=Preview ;;
  esac

  set_variable AWS_REGION "$REGION"
  set_variable AWS_ARTIFACT_BUCKET "$(output ArtifactBucket)"
  if [[ "$TARGET" == preview-infrastructure ]]; then
    set_variable AWS_ARTIFACT_PREFIX "$(output PreviewInfrastructureArtifactPrefix)/$APPLICATION"
  else
    set_variable AWS_ARTIFACT_PREFIX "$(output "${OUTPUT_TARGET}ArtifactPrefix")/$APPLICATION"
  fi

  if [[ "$TARGET" != preview-infrastructure ]]; then
    if [[ "$TARGET" == preview ]]; then
      set_variable AWS_DEPLOY_ROLE_ARN "$(output PreviewDeployRoleArn)"
      set_variable AWS_CLOUDFORMATION_ROLE_ARN "$(output PreviewExecutionRoleArn)"
    else
      set_variable AWS_DEPLOY_ROLE_ARN "$(output "${OUTPUT_TARGET}PipelineExecutionRoleArn")"
      set_variable AWS_CLOUDFORMATION_ROLE_ARN "$(output "${OUTPUT_TARGET}CloudFormationExecutionRoleArn")"
    fi
    set_variable AWS_RUNTIME_PERMISSIONS_BOUNDARY_ARN "$(output "${OUTPUT_TARGET}RuntimePermissionsBoundaryArn")"
  fi

  if [[ "$TARGET" != preview ]]; then
    set_variable AWS_INFRA_DEPLOY_ROLE_ARN "$(output "${OUTPUT_TARGET}InfrastructureDeployRoleArn")"
    set_variable AWS_INFRA_CLOUDFORMATION_ROLE_ARN "$(output "${OUTPUT_TARGET}InfrastructureExecutionRoleArn")"
    set_variable AWS_INFRA_ARTIFACT_BUCKET "$(output EdgeArtifactBucket)"
    if [[ "$TARGET" == preview-infrastructure ]]; then
      set_variable AWS_INFRA_ARTIFACT_PREFIX "$(output PreviewInfrastructureArtifactPrefix)/$APPLICATION"
    else
      set_variable AWS_INFRA_ARTIFACT_PREFIX "$(output "${OUTPUT_TARGET}ArtifactPrefix")/infrastructure/$APPLICATION"
    fi
    set_variable AWS_INFRA_RUNTIME_PERMISSIONS_BOUNDARY_ARN "$(output InfrastructureRuntimePermissionsBoundaryArn)"
  fi

  printf 'Configured %s variables.\n' "$TARGET"
done