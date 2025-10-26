# AWS Deployment Guide - VYBE DAW
## Complete Step-by-Step Production Deployment

This guide provides detailed instructions for deploying your VYBE collaborative DAW to AWS infrastructure.

---

## 📋 Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Deployment Options](#deployment-options)
4. [Option A: Quick Deployment (ECS Fargate)](#option-a-ecs-fargate-recommended)
5. [Option B: Cost-Effective (EC2)](#option-b-ec2-cost-effective)
6. [Option C: Serverless (Lambda + API Gateway)](#option-c-serverless-websockets)
7. [Frontend Deployment (S3 + CloudFront)](#frontend-deployment)
8. [Domain & SSL Configuration](#domain--ssl)
9. [Monitoring & Logging](#monitoring--logging)
10. [Cost Breakdown](#cost-breakdown)

---

## 🏗 Architecture Overview

### Current Local Architecture
```
┌─────────────┐
│   Browser   │
│  (Vite Dev) │
└──────┬──────┘
       │ HTTP/WS
┌──────▼──────────────┐     ┌──────────────┐
│  Node.js Backend    │────→│ AWS Cognito  │
│  (Express+Socket.io)│     │  (Auth)      │
│  Port 1234          │     └──────────────┘
└──────┬──────────────┘
       │                     ┌──────────────┐
       └────────────────────→│  DynamoDB    │
                             │  (4 Tables)  │
                             └──────────────┘
```

### Production AWS Architecture (Recommended)
```
┌──────────────┐
│    Users     │
└──────┬───────┘
       │ HTTPS
┌──────▼───────────────┐
│   Route 53 (DNS)     │
│  vybe.yourname.com   │
└──────┬───────────────┘
       │
┌──────▼───────────────┐
│   CloudFront (CDN)   │
│   SSL Certificate    │
└──────┬───────────────┘
       │
       ├─────────────────────┬────────────────────┐
       │                     │                    │
┌──────▼───────┐    ┌────────▼─────────┐  ┌──────▼──────────┐
│  S3 Bucket   │    │  Application     │  │  Application    │
│  (Frontend)  │    │  Load Balancer   │  │  Load Balancer  │
│  Static      │    │  (WebSocket)     │  │  (API)          │
│  Assets      │    │  Sticky Sessions │  │                 │
└──────────────┘    └────────┬─────────┘  └────────┬────────┘
                             │                     │
                    ┌────────▼─────────┐  ┌────────▼────────┐
                    │  ECS Fargate     │  │  ECS Fargate    │
                    │  WebSocket Svc   │  │  API Service    │
                    │  (Socket.io)     │  │  (REST API)     │
                    │  Auto-scaling    │  │  Auto-scaling   │
                    └────────┬─────────┘  └────────┬────────┘
                             │                     │
                    ┌────────▼─────────────────────▼────────┐
                    │      ElastiCache Redis               │
                    │      (Socket.io Adapter)             │
                    └──────────────────────────────────────┘
                             │
                    ┌────────┴─────────────────────────────┐
                    │                                      │
              ┌─────▼──────┐                   ┌──────────▼─────┐
              │  Cognito   │                   │   DynamoDB     │
              │  (Auth)    │                   │   (Data)       │
              └────────────┘                   └────────────────┘
```

---

## ✅ Prerequisites

### 1. AWS Account Setup
- AWS Account with billing enabled
- AWS CLI installed and configured
- IAM user with AdministratorAccess (or specific permissions)

### 2. Domain Name (Optional but Recommended)
- Register domain via Route 53 or external provider
- Example: `vybe.yourname.com`

### 3. Local Tools
```bash
# Install AWS CLI
brew install awscli  # macOS
# or: pip install awscli

# Install AWS CDK (optional, for infrastructure as code)
npm install -g aws-cdk

# Install Docker
# Download from https://docker.com

# Verify installations
aws --version
docker --version
```

### 4. Configure AWS CLI
```bash
aws configure
# AWS Access Key ID: YOUR_KEY
# AWS Secret Access Key: YOUR_SECRET
# Default region name: us-east-1
# Default output format: json
```

---

## 🚀 Deployment Options Comparison

| Feature | ECS Fargate | EC2 | Lambda |
|---------|-------------|-----|--------|
| **Setup Complexity** | Medium | Medium | High |
| **Monthly Cost** | $75-150 | $30-60 | $50-100 |
| **WebSocket Support** | ✅ Excellent | ✅ Excellent | ⚠️ Limited (60s timeout) |
| **Auto-scaling** | ✅ Built-in | ⚠️ Manual setup | ✅ Built-in |
| **Maintenance** | ✅ Low | ❌ High | ✅ Low |
| **Best For** | Production | Small budget | API-only apps |

**Recommendation**: ECS Fargate for production, EC2 for development/testing

---

## 🎯 Option A: ECS Fargate (Recommended)

### Step 1: Create Dockerfile

Create `/Users/rishits/VYBE/backend/Dockerfile`:

```dockerfile
FROM node:20-alpine

# Install Python for audio processing (if needed)
RUN apk add --no-cache python3 py3-pip

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Expose port
EXPOSE 1234

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:1234/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "server.js"]
```

### Step 2: Add Health Check Endpoint

Add to `backend/server.js` (before the WebSocket section):

```javascript
// Health check endpoint for ECS
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});
```

### Step 3: Build and Push Docker Image

```bash
# Navigate to backend
cd /Users/rishits/VYBE/backend

# Build Docker image
docker build -t vybe-backend:latest .

# Test locally
docker run -p 1234:1234 --env-file .env vybe-backend:latest

# Create ECR repository
aws ecr create-repository --repository-name vybe-backend --region us-east-1

# Get ECR login
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Tag image
docker tag vybe-backend:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/vybe-backend:latest

# Push to ECR
docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/vybe-backend:latest
```

### Step 4: Create ECS Cluster

```bash
# Create cluster
aws ecs create-cluster \
  --cluster-name vybe-cluster \
  --region us-east-1

# Create task execution role
aws iam create-role \
  --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Attach policies
aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

### Step 5: Create Task Definition

Create `task-definition.json`:

```json
{
  "family": "vybe-backend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::YOUR_ACCOUNT_ID:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::YOUR_ACCOUNT_ID:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "vybe-backend",
      "image": "YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/vybe-backend:latest",
      "portMappings": [
        {
          "containerPort": 1234,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "PORT", "value": "1234"},
        {"name": "AWS_REGION", "value": "us-east-1"}
      ],
      "secrets": [
        {
          "name": "COGNITO_USER_POOL_ID",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:vybe/cognito:COGNITO_USER_POOL_ID::"
        },
        {
          "name": "COGNITO_CLIENT_ID",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:vybe/cognito:COGNITO_CLIENT_ID::"
        },
        {
          "name": "COGNITO_CLIENT_SECRET",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:vybe/cognito:COGNITO_CLIENT_SECRET::"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/vybe-backend",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

Register task:
```bash
aws ecs register-task-definition --cli-input-json file://task-definition.json
```

### Step 6: Create Application Load Balancer

```bash
# Create security group for ALB
aws ec2 create-security-group \
  --group-name vybe-alb-sg \
  --description "Security group for VYBE ALB" \
  --vpc-id YOUR_VPC_ID

# Allow HTTP/HTTPS traffic
aws ec2 authorize-security-group-ingress \
  --group-id sg-XXXXX \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
  --group-id sg-XXXXX \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0

# Create ALB
aws elbv2 create-load-balancer \
  --name vybe-alb \
  --subnets subnet-XXXXX subnet-YYYYY \
  --security-groups sg-XXXXX \
  --scheme internet-facing \
  --type application \
  --ip-address-type ipv4

# Create target group with sticky sessions (for WebSocket)
aws elbv2 create-target-group \
  --name vybe-backend-tg \
  --protocol HTTP \
  --port 1234 \
  --vpc-id YOUR_VPC_ID \
  --target-type ip \
  --health-check-path /health \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3

# Enable sticky sessions
aws elbv2 modify-target-group-attributes \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:YOUR_ACCOUNT_ID:targetgroup/vybe-backend-tg/XXXXX \
  --attributes Key=stickiness.enabled,Value=true Key=stickiness.type,Value=lb_cookie Key=stickiness.lb_cookie.duration_seconds,Value=86400

# Create listener
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:us-east-1:YOUR_ACCOUNT_ID:loadbalancer/app/vybe-alb/XXXXX \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:us-east-1:YOUR_ACCOUNT_ID:targetgroup/vybe-backend-tg/XXXXX
```

### Step 7: Create ECS Service

```bash
aws ecs create-service \
  --cluster vybe-cluster \
  --service-name vybe-backend-service \
  --task-definition vybe-backend \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-XXXXX,subnet-YYYYY],securityGroups=[sg-XXXXX],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:us-east-1:YOUR_ACCOUNT_ID:targetgroup/vybe-backend-tg/XXXXX,containerName=vybe-backend,containerPort=1234"
```

### Step 8: Setup Auto-scaling

```bash
# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/vybe-cluster/vybe-backend-service \
  --min-capacity 2 \
  --max-capacity 10

# Create scaling policy (CPU-based)
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/vybe-cluster/vybe-backend-service \
  --policy-name vybe-cpu-scaling \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    },
    "ScaleInCooldown": 300,
    "ScaleOutCooldown": 60
  }'
```

### Step 9: Setup ElastiCache Redis (for WebSocket Scaling)

```bash
# Create security group for Redis
aws ec2 create-security-group \
  --group-name vybe-redis-sg \
  --description "Security group for VYBE Redis" \
  --vpc-id YOUR_VPC_ID

# Allow Redis traffic from ECS tasks
aws ec2 authorize-security-group-ingress \
  --group-id sg-REDIS \
  --protocol tcp \
  --port 6379 \
  --source-group sg-ECS

# Create Redis cluster
aws elasticache create-cache-cluster \
  --cache-cluster-id vybe-redis \
  --cache-node-type cache.t3.micro \
  --engine redis \
  --engine-version 7.0 \
  --num-cache-nodes 1 \
  --security-group-ids sg-REDIS \
  --cache-subnet-group-name YOUR_SUBNET_GROUP
```

Update backend code to use Redis adapter:

```bash
cd /Users/rishits/VYBE/backend
npm install @socket.io/redis-adapter redis
```

Add to `server.js`:

```javascript
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const pubClient = createClient({ url: `redis://${process.env.REDIS_HOST}:6379` });
const subClient = pubClient.duplicate();

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
  console.log('✅ Redis adapter connected');
});
```

---

## 💰 Option B: EC2 (Cost-Effective)

### Step 1: Launch EC2 Instance

```bash
# Create key pair
aws ec2 create-key-pair \
  --key-name vybe-keypair \
  --query 'KeyMaterial' \
  --output text > vybe-keypair.pem

chmod 400 vybe-keypair.pem

# Launch t3.small instance
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t3.small \
  --key-name vybe-keypair \
  --security-group-ids sg-XXXXX \
  --subnet-id subnet-XXXXX \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=vybe-backend}]'
```

### Step 2: Install Dependencies

```bash
# SSH into instance
ssh -i vybe-keypair.pem ec2-user@YOUR_INSTANCE_IP

# Install Node.js
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# Install Python
sudo yum install -y python3 python3-pip

# Install PM2 (process manager)
sudo npm install -g pm2

# Clone your repository or upload code
# Option 1: Upload via SCP
scp -i vybe-keypair.pem -r /Users/rishits/VYBE/backend ec2-user@YOUR_INSTANCE_IP:~/

# Install dependencies
cd ~/backend
npm install
```

### Step 3: Configure Environment

```bash
# Create .env file
cat > .env << EOF
AWS_REGION=us-east-1
COGNITO_USER_POOL_ID=us-east-1_EWLQNHfPY
COGNITO_CLIENT_ID=42p4i1prmhnvglhsrsevh8veg3
COGNITO_CLIENT_SECRET=your-secret-here
DYNAMODB_USERS_TABLE=vybe-users
DYNAMODB_PROJECTS_TABLE=vybe-projects
DYNAMODB_COLLABORATORS_TABLE=vybe-project-collaborators
DYNAMODB_BEATS_TABLE=vybe-beats
PORT=1234
NODE_ENV=production
FRONTEND_URL=https://your-domain.com
EOF
```

### Step 4: Start with PM2

```bash
# Start application
pm2 start server.js --name vybe-backend

# Configure PM2 to start on boot
pm2 startup
pm2 save

# Monitor
pm2 monit
```

### Step 5: Setup Nginx Reverse Proxy

```bash
# Install Nginx
sudo amazon-linux-extras install nginx1

# Configure Nginx
sudo cat > /etc/nginx/conf.d/vybe.conf << EOF
upstream vybe_backend {
    server localhost:1234;
}

server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://vybe_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # WebSocket timeouts
        proxy_read_timeout 86400;
    }
}
EOF

# Start Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## ⚡ Option C: Serverless WebSockets

**Note**: Lambda has 60-second timeout limit, which may not work well for long-lived WebSocket connections. Consider this only if you can redesign to use API Gateway WebSocket with connection management.

---

## 🌐 Frontend Deployment

### Step 1: Build Frontend

```bash
cd /Users/rishits/VYBE/frontend

# Install dependencies
npm install

# Build for production
npm run build

# Output will be in frontend/dist/
```

### Step 2: Create S3 Bucket

```bash
# Create bucket
aws s3 mb s3://vybe-frontend-YOUR-UNIQUE-ID --region us-east-1

# Upload files
aws s3 sync dist/ s3://vybe-frontend-YOUR-UNIQUE-ID/ --delete

# Configure bucket for static website hosting
aws s3 website s3://vybe-frontend-YOUR-UNIQUE-ID/ \
  --index-document index.html \
  --error-document index.html
```

### Step 3: Create CloudFront Distribution

```bash
# Create distribution
aws cloudfront create-distribution \
  --origin-domain-name vybe-frontend-YOUR-UNIQUE-ID.s3.amazonaws.com \
  --default-root-object index.html
```

Or use AWS Console:
1. Go to CloudFront → Create Distribution
2. Origin Domain: `vybe-frontend-YOUR-UNIQUE-ID.s3.amazonaws.com`
3. Default Root Object: `index.html`
4. Price Class: Use Only North America and Europe
5. Alternate Domain Names: `vybe.yourname.com`
6. SSL Certificate: Request ACM certificate
7. Create Distribution

### Step 4: Update Frontend Configuration

Update WebSocket URLs in production build:

```javascript
// frontend/app.js
const WS_URL = process.env.NODE_ENV === 'production'
  ? 'wss://api.yourname.com'
  : 'ws://localhost:1234';

const provider = new WebsocketProvider(
  WS_URL,
  'beat-room-main',
  ydoc
);
```

Update `vite.config.ts`:

```typescript
export default {
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV)
  }
}
```

---

## 🔐 Domain & SSL

### Step 1: Request SSL Certificate

```bash
# Request certificate in us-east-1 (required for CloudFront)
aws acm request-certificate \
  --domain-name vybe.yourname.com \
  --subject-alternative-names "*.vybe.yourname.com" \
  --validation-method DNS \
  --region us-east-1
```

### Step 2: Validate Certificate

1. Get validation CNAME records:
```bash
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:YOUR_ACCOUNT_ID:certificate/XXXXX
```

2. Add CNAME records to your DNS provider (Route 53 or external)

### Step 3: Configure Route 53

```bash
# Create hosted zone (if using Route 53)
aws route53 create-hosted-zone \
  --name vybe.yourname.com \
  --caller-reference $(date +%s)

# Create A record for frontend (CloudFront)
# Create A record for backend (ALB)
```

Example Route 53 records:
- `vybe.yourname.com` → CloudFront Distribution (A record - Alias)
- `api.vybe.yourname.com` → Application Load Balancer (A record - Alias)

---

## 📊 Monitoring & Logging

### CloudWatch Dashboard

```bash
# Create log group
aws logs create-log-group --log-group-name /ecs/vybe-backend

# Create CloudWatch dashboard
aws cloudwatch put-dashboard \
  --dashboard-name vybe-dashboard \
  --dashboard-body file://dashboard.json
```

### Alarms

```bash
# High CPU alarm
aws cloudwatch put-metric-alarm \
  --alarm-name vybe-high-cpu \
  --alarm-description "Alert when CPU exceeds 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2

# Error rate alarm
aws cloudwatch put-metric-alarm \
  --alarm-name vybe-high-errors \
  --alarm-description "Alert on high error rate" \
  --metric-name 5XXError \
  --namespace AWS/ApplicationELB \
  --statistic Sum \
  --period 60 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1
```

---

## 💵 Cost Breakdown

### Monthly Estimates (Production - Moderate Traffic)

| Service | Configuration | Monthly Cost |
|---------|---------------|--------------|
| **ECS Fargate** | 2 tasks (0.5 vCPU, 1GB RAM) | $75 |
| **Application Load Balancer** | 1 ALB | $25 |
| **ElastiCache Redis** | cache.t3.micro | $15 |
| **DynamoDB** | On-demand, 10M requests | $30 |
| **Cognito** | 10,000 MAUs | $0 (free tier) |
| **S3** | 50GB storage, 100k requests | $5 |
| **CloudFront** | 100GB data transfer | $15 |
| **Route 53** | 1 hosted zone | $0.50 |
| **Data Transfer** | 100GB outbound | $10 |
| **CloudWatch Logs** | 10GB logs | $5 |
| **Secrets Manager** | 3 secrets | $1.20 |
| **Total** | | **~$181.70/month** |

### Cost Optimization Tips

1. **Use Reserved Instances** for predictable workloads (-40%)
2. **Enable S3 Intelligent Tiering** for old files (-50%)
3. **Use CloudFront Compression** to reduce data transfer (-30%)
4. **Set DynamoDB Auto-scaling** to scale down during low traffic
5. **Use ECS Fargate Spot** for non-critical tasks (-70%)

---

## 🚦 Deployment Checklist

### Pre-Deployment
- [ ] Test application locally with production configuration
- [ ] Review and update environment variables
- [ ] Setup AWS credentials and permissions
- [ ] Register domain name
- [ ] Request SSL certificates

### Backend Deployment
- [ ] Create Dockerfile
- [ ] Add health check endpoint
- [ ] Build and test Docker image locally
- [ ] Create ECR repository
- [ ] Push image to ECR
- [ ] Create ECS cluster and task definition
- [ ] Setup Application Load Balancer with sticky sessions
- [ ] Create ECS service
- [ ] Configure auto-scaling
- [ ] Setup ElastiCache Redis
- [ ] Update Socket.io to use Redis adapter

### Frontend Deployment
- [ ] Update API endpoints to production URLs
- [ ] Build production bundle
- [ ] Create S3 bucket
- [ ] Upload files to S3
- [ ] Create CloudFront distribution
- [ ] Configure SSL certificate
- [ ] Update DNS records

### Security
- [ ] Store secrets in AWS Secrets Manager
- [ ] Configure IAM roles with least privilege
- [ ] Enable VPC security groups
- [ ] Setup WAF rules (optional)
- [ ] Enable CloudTrail for audit logging

### Monitoring
- [ ] Create CloudWatch dashboard
- [ ] Setup CloudWatch alarms
- [ ] Configure log retention policies
- [ ] Setup SNS notifications for critical alerts
- [ ] Test monitoring and alerts

### Testing
- [ ] Test authentication flow
- [ ] Test WebSocket connections
- [ ] Test real-time collaboration
- [ ] Load test with expected traffic
- [ ] Test auto-scaling behavior
- [ ] Verify SSL certificates
- [ ] Test from different geographic locations

---

## 🔧 Troubleshooting

### WebSocket Connection Issues

**Problem**: WebSocket connections dropping

**Solutions**:
1. Verify ALB has sticky sessions enabled
2. Check security group allows WebSocket upgrade
3. Increase ALB idle timeout (default 60s → 300s)
4. Verify ECS tasks are healthy

### Redis Connection Issues

**Problem**: Socket.io adapter not connecting to Redis

**Solutions**:
1. Verify ECS security group allows outbound to Redis
2. Check Redis endpoint and port
3. Review CloudWatch logs for connection errors

### High Costs

**Problem**: Unexpected high AWS bills

**Solutions**:
1. Review CloudWatch metrics to find bottlenecks
2. Enable ECS Fargate Spot for dev/staging
3. Reduce DynamoDB read/write capacity
4. Enable S3 Intelligent Tiering
5. Use CloudFront compression

---

## 📚 Next Steps

1. **CI/CD Pipeline**: Setup GitHub Actions for automated deployments
2. **Backup Strategy**: Configure DynamoDB point-in-time recovery
3. **Multi-Region**: Deploy to multiple regions for low latency
4. **CDN Optimization**: Configure CloudFront cache policies
5. **Security Hardening**: Enable AWS WAF and Shield

---

## 📞 Support Resources

- AWS Documentation: https://docs.aws.amazon.com/
- ECS Fargate Guide: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/
- Socket.io Scaling: https://socket.io/docs/v4/using-multiple-nodes/
- AWS Pricing Calculator: https://calculator.aws/

---

**Last Updated**: 2025-10-26
