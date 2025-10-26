#!/bin/bash

# VYBE Frontend Deployment Script
# This script builds and deploys the frontend to AWS S3 + CloudFront
# with proper MIME types and cache invalidation

set -e

# Configuration
S3_BUCKET="vybe-frontend-assets"
CLOUDFRONT_DIST_ID="E1XZ4DBIHC5C4S"
REGION="us-east-1"

echo "🚀 VYBE Frontend Deployment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 1: Build the frontend
echo "📦 Step 1: Building frontend..."
cd "$(dirname "$0")/../frontend"

# Check if we need to build with Vite
if [ -f "vite.config.ts" ]; then
  echo "   Building with Vite..."
  npm run build
  BUILD_DIR="dist"
else
  echo "   No build step needed (using source files)"
  BUILD_DIR="."
fi

echo "✅ Build complete"
echo ""

# Step 2: Upload files to S3 with proper Content-Type
echo "📤 Step 2: Uploading to S3 with correct MIME types..."

# Function to upload file with correct Content-Type
upload_with_content_type() {
  local file="$1"
  local bucket="$2"
  local key="$3"

  # Determine Content-Type based on file extension
  case "${file##*.}" in
    js|mjs|cjs|jsx)
      content_type="application/javascript"
      ;;
    ts|tsx)
      content_type="application/javascript"
      ;;
    json)
      content_type="application/json"
      ;;
    html)
      content_type="text/html"
      ;;
    css)
      content_type="text/css"
      ;;
    png)
      content_type="image/png"
      ;;
    jpg|jpeg)
      content_type="image/jpeg"
      ;;
    gif)
      content_type="image/gif"
      ;;
    svg)
      content_type="image/svg+xml"
      ;;
    woff)
      content_type="font/woff"
      ;;
    woff2)
      content_type="font/woff2"
      ;;
    ttf)
      content_type="font/ttf"
      ;;
    *)
      content_type="application/octet-stream"
      ;;
  esac

  aws s3 cp "$file" "s3://${bucket}/${key}" \
    --content-type "$content_type" \
    --region "$REGION" \
    --acl public-read
}

# Upload all files with correct MIME types
if [ "$BUILD_DIR" = "dist" ]; then
  # For Vite build, sync the dist directory
  echo "   Syncing dist directory..."

  # Upload JavaScript files with correct Content-Type
  find dist -type f \( -name "*.js" -o -name "*.mjs" -o -name "*.cjs" \) | while read -r file; do
    key="${file#dist/}"
    echo "   Uploading $key (application/javascript)"
    aws s3 cp "$file" "s3://${S3_BUCKET}/${key}" \
      --content-type "application/javascript" \
      --region "$REGION" \
      --acl public-read
  done

  # Upload HTML files
  find dist -type f -name "*.html" | while read -r file; do
    key="${file#dist/}"
    echo "   Uploading $key (text/html)"
    aws s3 cp "$file" "s3://${S3_BUCKET}/${key}" \
      --content-type "text/html" \
      --region "$REGION" \
      --acl public-read
  done

  # Upload CSS files
  find dist -type f -name "*.css" | while read -r file; do
    key="${file#dist/}"
    echo "   Uploading $key (text/css)"
    aws s3 cp "$file" "s3://${S3_BUCKET}/${key}" \
      --content-type "text/css" \
      --region "$REGION" \
      --acl public-read
  done

  # Upload other asset files
  find dist -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.gif" -o -name "*.svg" \) | while read -r file; do
    key="${file#dist/}"
    ext="${file##*.}"
    case "$ext" in
      png) ct="image/png" ;;
      jpg|jpeg) ct="image/jpeg" ;;
      gif) ct="image/gif" ;;
      svg) ct="image/svg+xml" ;;
    esac
    echo "   Uploading $key ($ct)"
    aws s3 cp "$file" "s3://${S3_BUCKET}/${key}" \
      --content-type "$ct" \
      --region "$REGION" \
      --acl public-read
  done
else
  # For non-build deployment, upload essential files
  echo "   Uploading HTML pages..."
  for file in *.html; do
    [ -f "$file" ] || continue
    echo "   Uploading $file (text/html)"
    aws s3 cp "$file" "s3://${S3_BUCKET}/${file}" \
      --content-type "text/html" \
      --region "$REGION" \
      --acl public-read
  done

  echo "   Uploading JavaScript files..."
  for file in *.js; do
    [ -f "$file" ] || continue
    echo "   Uploading $file (application/javascript)"
    aws s3 cp "$file" "s3://${S3_BUCKET}/${file}" \
      --content-type "application/javascript" \
      --region "$REGION" \
      --acl public-read
  done

  # Upload config.js specifically
  if [ -f "config.js" ]; then
    echo "   Uploading config.js (application/javascript)"
    aws s3 cp config.js "s3://${S3_BUCKET}/config.js" \
      --content-type "application/javascript" \
      --region "$REGION" \
      --acl public-read
  fi

  # Upload collab-client.js if exists
  if [ -f "collab-client.js" ]; then
    echo "   Uploading collab-client.js (application/javascript)"
    aws s3 cp collab-client.js "s3://${S3_BUCKET}/collab-client.js" \
      --content-type "application/javascript" \
      --region "$REGION" \
      --acl public-read
  fi
fi

echo "✅ Upload complete"
echo ""

# Step 3: Invalidate CloudFront cache
echo "🔄 Step 3: Invalidating CloudFront cache..."
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DIST_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)

echo "   Invalidation created: $INVALIDATION_ID"
echo "   Waiting for invalidation to complete..."

aws cloudfront wait invalidation-completed \
  --distribution-id "$CLOUDFRONT_DIST_ID" \
  --id "$INVALIDATION_ID"

echo "✅ Invalidation complete"
echo ""

# Step 4: Verify deployment
echo "📊 Step 4: Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Deployment complete!"
echo ""
echo "CloudFront URL: https://d1dut83snnf5pc.cloudfront.net"
echo ""
echo "To verify MIME types:"
echo "  curl -I https://d1dut83snnf5pc.cloudfront.net/config.js"
echo "  curl -I https://d1dut83snnf5pc.cloudfront.net/assets/workspace-DfWVdbQR.js"
echo ""
echo "Look for: Content-Type: application/javascript"
echo ""
