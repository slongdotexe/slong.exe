#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

sam deploy --template-file "$SCRIPT_DIR/../templates/iam/template-deployment-access.yaml" \
	--config-file "$SCRIPT_DIR/../templates/iam/samconfig.toml" "$@"
