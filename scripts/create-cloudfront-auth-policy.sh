#!/usr/bin/env bash
set -euo pipefail

# This script ensures that a CloudFront distribution forwards the Authorization
# header and all query strings to the origin for the specified cache behavior.
# Usage:
#   ./scripts/create-cloudfront-auth-policy.sh [DISTRIBUTION_ID] [PATH_PATTERN]
# Defaults:
#   DISTRIBUTION_ID=E1XZ4DBIHC5C4S
#   PATH_PATTERN=api/*

DIST_ID="${1:-E1XZ4DBIHC5C4S}"
PATH_PATTERN="${2:-api/*}"
POLICY_NAME="${POLICY_NAME:-muse-forward-authorization-header}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required but not found in PATH" >&2
  exit 1
fi

echo "Using distribution: ${DIST_ID}"
echo "Target cache behavior: ${PATH_PATTERN}"

# Locate or create the origin request policy that forwards Authorization header.
POLICY_ID="$(aws cloudfront list-origin-request-policies \
  --type custom \
  --query "OriginRequestPolicyList.Items[?Name=='${POLICY_NAME}'].Id" \
  --output text 2>/dev/null || true)"

if [[ -z "${POLICY_ID}" || "${POLICY_ID}" == "None" ]]; then
  echo "Creating new origin request policy..."
  cat > "${TMP_DIR}/origin-request-policy.json" <<'JSON'
{
  "Name": "muse-forward-authorization-header",
  "Comment": "Forward Authorization header and all query strings for API requests",
  "HeadersConfig": {
    "HeaderBehavior": "allViewer"
  },
  "CookiesConfig": {
    "CookieBehavior": "none"
  },
  "QueryStringsConfig": {
    "QueryStringBehavior": "all"
  }
}
JSON
  
  aws cloudfront create-origin-request-policy \
    --origin-request-policy-config file://${TMP_DIR}/origin-request-policy.json > /dev/null 2>&1 || true
  
  # Retrieve the policy ID (whether we just created it or it already existed)
  POLICY_ID="$(aws cloudfront list-origin-request-policies \
    --type custom \
    --query "OriginRequestPolicyList.Items[?Name=='${POLICY_NAME}'].Id" \
    --output text)"
  echo "Using origin request policy ${POLICY_ID}"
else
  echo "Re-using existing origin request policy ${POLICY_ID}"
fi

# Fetch current distribution config and ETag.
ETAG="$(aws cloudfront get-distribution-config \
  --id "${DIST_ID}" \
  --query 'ETag' \
  --output text)"

aws cloudfront get-distribution-config \
  --id "${DIST_ID}" \
  --query 'DistributionConfig' \
  --output json > "${TMP_DIR}/distribution-config.json"

python3 - <<'PY' "${TMP_DIR}/distribution-config.json" "${TMP_DIR}/updated-config.json" "${PATH_PATTERN}" "${POLICY_ID}"
import json
import sys

config_path, output_path, path_pattern, policy_id = sys.argv[1:5]

with open(config_path, "r", encoding="utf-8") as f:
    config = json.load(f)

behaviors = config.get("CacheBehaviors", {})
items = behaviors.get("Items") or []

target = None
for item in items:
    if item.get("PathPattern") == path_pattern:
        target = item
        break

if target is None:
    raise SystemExit(f"Cache behavior with path pattern '{path_pattern}' not found.")

target["OriginRequestPolicyId"] = policy_id
target.pop("ForwardedValues", None)  # Remove legacy config if present.

with open(output_path, "w", encoding="utf-8") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
PY

aws cloudfront update-distribution \
  --id "${DIST_ID}" \
  --if-match "${ETAG}" \
  --distribution-config file://"${TMP_DIR}/updated-config.json" \
  >/dev/null

echo "Updated distribution ${DIST_ID} to use origin request policy ${POLICY_ID} for ${PATH_PATTERN}."
echo "Changes may take several minutes to propagate."
