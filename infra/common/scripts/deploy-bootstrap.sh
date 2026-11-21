#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

sam deploy --template-file "$SCRIPT_DIR/../templates/bootstrap/template-s3.yaml" "$@"
sam deploy --template-file "$SCRIPT_DIR/../templates/bootstrap/template-edge.yaml" "$@"
