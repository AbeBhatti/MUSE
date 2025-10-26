#!/bin/bash

set -e

DIST_ID="E1XZ4DBIHC5C4S"

echo "🔧 Fixing CloudFront Authorization headers..."
echo ""

# Get the current distribution config
echo "📥 Fetching distribution configuration..."
aws cloudfront get-distribution-config --id "$DIST_ID" > /tmp/cf-config.json

ETAG=$(cat /tmp/cf-config.json | jq -r '.ETag')
CONFIG=$(cat /tmp/cf-config.json | jq '.DistributionConfig')

# Update the api/* behavior to forward Authorization header
echo "✏️  Updating api/* behavior to forward Authorization header..."
UPDATED_CONFIG=$(echo "$CONFIG" | jq '(.CacheBehaviors.Items[] | select(.PathPattern == "api/*") | .ForwardedValues.Headers.Items) += ["Authorization"]')

# Enable query string forwarding (might be needed)
UPDATED_CONFIG=$(echo "$UPDATED_CONFIG" | jq '(.CacheBehaviors.Items[] | select(.PathPattern == "api/*") | .ForwardedValues.QueryString) = true')

echo "$UPDATED_CONFIG" > /tmp/cf-config-updated.json

echo "⚠️  WARNING: This will take the distribution out of deployed state temporarily."
echo "The distribution will remain accessible but won't accept new changes until this completes."
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]
then
    echo "Aborted."
    exit 1
fi

echo "🚀 Updating distribution..."
aws cloudfront update-distribution \
  --id "$DIST_ID" \
  --if-match "$ETAG" \
  --distribution-config file:///tmp/cf-config-updated.json \
  --query 'Distribution.{Id:Id,Status:Status,DomainName:DomainName}' \
  --output table

echo ""
echo "✅ Distribution updated!"
echo "⏳ Waiting for deployment to complete (this may take 10-15 minutes)..."
echo "You can check status with:"
echo "  aws cloudfront get-distribution --id $DIST_ID --query 'Distribution.Status'"
echo ""
echo "Or manually in AWS Console: CloudFront > Distributions > $DIST_ID"

