#!/usr/bin/env bash
set -euo pipefail

repo=slongdotexe/slong.exe
project=sam-nextjs-slongdotexe
account=206665440523

set_variable() {
  gh variable set "$1" --repo "$repo" --env "$target" --body "$2"
}

environments="$(gh api "repos/$repo/environments" --jq '.environments[].name')"

for target in development production preview preview-infrastructure; do
  if ! grep -Fxq "$target" <<< "$environments"; then
    gh api --method PUT "repos/$repo/environments/$target" --silent
  fi

  set_variable AWS_REGION ap-southeast-2
  set_variable AWS_ARTIFACT_BUCKET "$project-templates-$account-ap-southeast-2"
  set_variable AWS_ARTIFACT_PREFIX "$project/$target"

  if [[ "$target" != preview-infrastructure ]]; then
    set_variable AWS_DEPLOY_ROLE_ARN "arn:aws:iam::$account:role/$project-$target-app-deploy"
    set_variable AWS_CLOUDFORMATION_ROLE_ARN "arn:aws:iam::$account:role/$project-$target-app-execution"
    set_variable AWS_RUNTIME_PERMISSIONS_BOUNDARY_ARN "arn:aws:iam::$account:policy/$project-$target-runtime-boundary"
  fi

  if [[ "$target" != preview ]]; then
    infrastructure_target="$target"
    if [[ "$target" == preview-infrastructure ]]; then
      infrastructure_target=preview
    fi
    set_variable AWS_INFRA_DEPLOY_ROLE_ARN "arn:aws:iam::$account:role/$project-$infrastructure_target-infra-deploy"
    set_variable AWS_INFRA_CLOUDFORMATION_ROLE_ARN "arn:aws:iam::$account:role/$project-$infrastructure_target-infra-execution"
    set_variable AWS_INFRA_ARTIFACT_BUCKET "$project-artifacts-$account-us-east-1"
    set_variable AWS_INFRA_ARTIFACT_PREFIX "$project/$target/infrastructure"
    if [[ "$target" == preview-infrastructure ]]; then
      set_variable AWS_INFRA_ARTIFACT_PREFIX "$project/$target"
    fi
    set_variable AWS_INFRA_RUNTIME_PERMISSIONS_BOUNDARY_ARN "arn:aws:iam::$account:policy/$project-infra-runtime-boundary"
  fi

  printf 'Configured %s variables.\n' "$target"
done