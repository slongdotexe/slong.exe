#!/usr/bin/env bash
set -euo pipefail

repo=slongdotexe/slong.exe
project=sam-nextjs-slongdotexe
account=206665440523

set_variable() {
  gh variable set "$1" --repo "$repo" --env "$target" --body "$2"
}

environments="$(gh api "repos/$repo/environments" --jq '.environments[].name')"

for target in preview preview-infrastructure; do
  if ! grep -Fxq "$target" <<< "$environments"; then
    gh api --method PUT "repos/$repo/environments/$target" --silent
  fi

  set_variable AWS_REGION ap-southeast-2
  set_variable AWS_ARTIFACT_BUCKET sam-nextjs-slongdotexe-bootstrap-artifacts-d9v6zxsihsy7
  set_variable AWS_ARTIFACT_PREFIX "$project/$target"

  if [[ "$target" == preview ]]; then
    set_variable AWS_DEPLOY_ROLE_ARN "arn:aws:iam::$account:role/$project-preview-app-deploy"
    set_variable AWS_CLOUDFORMATION_ROLE_ARN "arn:aws:iam::$account:role/$project-preview-app-execution"
    set_variable AWS_RUNTIME_PERMISSIONS_BOUNDARY_ARN "arn:aws:iam::$account:policy/$project-preview-runtime-boundary"
  else
    set_variable AWS_INFRA_DEPLOY_ROLE_ARN "arn:aws:iam::$account:role/$project-preview-infra-deploy"
    set_variable AWS_INFRA_CLOUDFORMATION_ROLE_ARN "arn:aws:iam::$account:role/$project-preview-infra-execution"
    set_variable AWS_INFRA_ARTIFACT_BUCKET "$project-artifacts-$account-us-east-1"
    set_variable AWS_INFRA_ARTIFACT_PREFIX "$project/preview-infrastructure"
    set_variable AWS_INFRA_RUNTIME_PERMISSIONS_BOUNDARY_ARN "arn:aws:iam::$account:policy/$project-infra-runtime-boundary"
  fi

  printf 'Configured %s variables.\n' "$target"
done