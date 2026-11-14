#!/usr/bin/env bash
set -euo pipefail

repo=slongdotexe/slong.exe
stack=sam-nextjs-slongdotexe-bootstrap
region=ap-southeast-2
profile=slongdotexe
application=nextjs

while (( $# > 0 )); do
  case "$1" in
    --repo|--stack-name|--region|--profile|--application)
      if (( $# < 2 )) || [[ -z "$2" || "$2" == --* ]]; then
        printf 'ERROR: %s requires a value.\n' "$1" >&2
        exit 1
      fi
      case "$1" in
        --repo) repo="$2" ;;
        --stack-name) stack="$2" ;;
        --region) region="$2" ;;
        --profile) profile="$2" ;;
        --application) application="$2" ;;
      esac
      shift 2
      ;;
    *) printf 'ERROR: Unknown argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done

if [[ ! "$application" =~ ^[a-z][a-z0-9-]*$ ]]; then
  printf 'ERROR: --application must be a lowercase application identifier.\n' >&2
  exit 1
fi

outputs="$(aws cloudformation describe-stacks --stack-name "$stack" \
  --region "$region" --profile "$profile" --query 'Stacks[0].Outputs' --output json)"

output() {
  jq -er --arg key "$1" '.[] | select(.OutputKey == $key) | .OutputValue | select(length > 0)' <<< "$outputs"
}

output RepositoryPrefix >/dev/null
output ApplicationResourcePrefix >/dev/null

set_variable() {
  gh variable set "$1" --repo "$repo" --env "$target" --body "$2"
}

environments="$(gh api "repos/$repo/environments" --jq '.environments[].name')"

for target in development production preview preview-infrastructure; do
  if ! grep -Fxq "$target" <<< "$environments"; then
    gh api --method PUT "repos/$repo/environments/$target" --silent
  fi

  case "$target" in
    development) output_target=Development ;;
    production) output_target=Production ;;
    preview|preview-infrastructure) output_target=Preview ;;
  esac

  set_variable AWS_REGION "$region"
  set_variable AWS_ARTIFACT_BUCKET "$(output ArtifactBucket)"
  if [[ "$target" == preview-infrastructure ]]; then
    set_variable AWS_ARTIFACT_PREFIX "$(output PreviewInfrastructureArtifactPrefix)/$application"
  else
    set_variable AWS_ARTIFACT_PREFIX "$(output "${output_target}ArtifactPrefix")/$application"
  fi

  if [[ "$target" != preview-infrastructure ]]; then
    if [[ "$target" == preview ]]; then
      set_variable AWS_DEPLOY_ROLE_ARN "$(output PreviewDeployRoleArn)"
      set_variable AWS_CLOUDFORMATION_ROLE_ARN "$(output PreviewExecutionRoleArn)"
    else
      set_variable AWS_DEPLOY_ROLE_ARN "$(output "${output_target}PipelineExecutionRoleArn")"
      set_variable AWS_CLOUDFORMATION_ROLE_ARN "$(output "${output_target}CloudFormationExecutionRoleArn")"
    fi
    set_variable AWS_RUNTIME_PERMISSIONS_BOUNDARY_ARN "$(output "${output_target}RuntimePermissionsBoundaryArn")"
  fi

  if [[ "$target" != preview ]]; then
    set_variable AWS_INFRA_DEPLOY_ROLE_ARN "$(output "${output_target}InfrastructureDeployRoleArn")"
    set_variable AWS_INFRA_CLOUDFORMATION_ROLE_ARN "$(output "${output_target}InfrastructureExecutionRoleArn")"
    set_variable AWS_INFRA_ARTIFACT_BUCKET "$(output EdgeArtifactBucket)"
    if [[ "$target" == preview-infrastructure ]]; then
      set_variable AWS_INFRA_ARTIFACT_PREFIX "$(output PreviewInfrastructureArtifactPrefix)/$application"
    else
      set_variable AWS_INFRA_ARTIFACT_PREFIX "$(output "${output_target}ArtifactPrefix")/infrastructure/$application"
    fi
    set_variable AWS_INFRA_RUNTIME_PERMISSIONS_BOUNDARY_ARN "$(output InfrastructureRuntimePermissionsBoundaryArn)"
  fi

  printf 'Configured %s variables.\n' "$target"
done