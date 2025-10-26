#!/bin/bash

# Test the projects API to see what it returns
echo "Testing API for abrahambhatti user (3478e488-4031-70f6-91d3-e849f0a9cf3f)..."
echo ""

# We need a valid token, so let's just check the raw DynamoDB query that the backend would do
echo "=== Projects for user 3478e488-4031-70f6-91d3-e849f0a9cf3f ==="
aws dynamodb query \
  --table-name vybe-project-collaborators \
  --index-name userId-index \
  --key-condition-expression "userId = :userId" \
  --expression-attribute-values '{":userId":{"S":"3478e488-4031-70f6-91d3-e849f0a9cf3f"}}' \
  --output json | jq -r '.Items[] | "ProjectID: \(.projectId.S), Role: \(.role.S)"'

echo ""
echo "=== Checking project 66b2c30e-2509-442d-809a-66781f43d074 details ==="
aws dynamodb get-item \
  --table-name vybe-projects \
  --key '{"projectId":{"S":"66b2c30e-2509-442d-809a-66781f43d074"}}' \
  --output json | jq '{projectId: .Item.projectId.S, name: .Item.name.S, ownerId: .Item.ownerId.S, deleted: .Item.deleted}'

echo ""
echo "This project should appear in 'Shared with Me' because:"
echo "  - User 3478e488-4031-70f6-91d3-e849f0a9cf3f has role 'editor'"
echo "  - Owner is 44d89478-30f1-70e0-7a2a-d2cb28227745 (different user)"
echo "  - userRole should be 'editor' in API response"
