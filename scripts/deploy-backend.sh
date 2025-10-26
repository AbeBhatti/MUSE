#!/bin/bash

# Deploy backend to AWS ECS
# This script builds, pushes, and deploys the backend service

set -e

echo "🚀 Starting backend deployment..."

# Configuration
AWS_REGION="us-east-1"
AWS_ACCOUNT_ID="707071241239"
ECR_REPOSITORY="muse-backend"
ECS_CLUSTER="muse-cluster"
ECS_SERVICE="muse-backend-service"
IMAGE_TAG="${1:-latest-$(date +%s)}"

# Full image name
IMAGE_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY}:${IMAGE_TAG}"

echo "📦 Image: ${IMAGE_URI}"

# Navigate to backend directory
cd "$(dirname "$0")/../backend"

# Login to ECR
echo "🔐 Logging in to ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

# Build Docker image
echo "🏗️  Building Docker image..."
docker build --platform linux/amd64 -t ${ECR_REPOSITORY}:${IMAGE_TAG} -t ${IMAGE_URI} .

# Push to ECR
echo "📤 Pushing image to ECR..."
docker push ${IMAGE_URI}

# Get current task definition
echo "📋 Updating task definition..."
TASK_DEFINITION=$(aws ecs describe-task-definition --task-definition muse-backend --region ${AWS_REGION})

# Extract container definitions and update image
NEW_CONTAINER_DEFS=$(echo $TASK_DEFINITION | jq --arg IMAGE "${IMAGE_URI}" '.taskDefinition.containerDefinitions[0].image = $IMAGE | .taskDefinition.containerDefinitions')

# Register new task definition
NEW_TASK_DEF=$(aws ecs register-task-definition \
  --region ${AWS_REGION} \
  --family muse-backend \
  --task-role-arn $(echo $TASK_DEFINITION | jq -r '.taskDefinition.taskRoleArn') \
  --execution-role-arn $(echo $TASK_DEFINITION | jq -r '.taskDefinition.executionRoleArn') \
  --network-mode $(echo $TASK_DEFINITION | jq -r '.taskDefinition.networkMode') \
  --container-definitions "${NEW_CONTAINER_DEFS}" \
  --requires-compatibilities $(echo $TASK_DEFINITION | jq -r '.taskDefinition.requiresCompatibilities[]') \
  --cpu $(echo $TASK_DEFINITION | jq -r '.taskDefinition.cpu') \
  --memory $(echo $TASK_DEFINITION | jq -r '.taskDefinition.memory'))

NEW_REVISION=$(echo $NEW_TASK_DEF | jq -r '.taskDefinition.revision')

echo "✅ Registered task definition revision: ${NEW_REVISION}"

# Update ECS service
echo "🔄 Updating ECS service..."
aws ecs update-service \
  --cluster ${ECS_CLUSTER} \
  --service ${ECS_SERVICE} \
  --task-definition muse-backend:${NEW_REVISION} \
  --region ${AWS_REGION} \
  --force-new-deployment

echo "⏳ Waiting for deployment to complete..."
aws ecs wait services-stable \
  --cluster ${ECS_CLUSTER} \
  --services ${ECS_SERVICE} \
  --region ${AWS_REGION}

echo "✅ Backend deployment complete!"
echo "🎉 Image: ${IMAGE_URI}"
echo "📝 Task definition: muse-backend:${NEW_REVISION}"
