# Quick Fix: 401 Unauthorized Error

## Problem
You're getting 401 errors because the frontend is trying to make API requests to CloudFront, but your backend API is running on an Application Load Balancer (ALB).

## Immediate Solution

### Option 1: Use Query Parameter (Quick Fix)
Access your app with the ALB URL as a query parameter:

```
https://d1dut83snnf5pc.cloudfront.net?backend=https://your-alb-url.elb.amazonaws.com
```

Replace `your-alb-url.elb.amazonaws.com` with your actual ALB DNS name.

### Option 2: Find Your ALB URL
Run this command to find your ALB:

```bash
aws elbv2 describe-load-balancers --region us-east-1 \
  --query 'LoadBalancers[].DNSName' \
  --output text
```

This will output your ALB URL (e.g., `vybe-alb-1234567890.us-east-1.elb.amazonaws.com`)

## Permanent Fix

### Step 1: Create Production Config File

Create a new file `frontend/config.prod.js`:

```javascript
window.BACKEND_URL = 'http://YOUR-ALB-DNS-HERE';
```

### Step 2: Upload to S3

```bash
# Replace YOUR-BUCKET with your S3 bucket name
aws s3 cp frontend/config.prod.js s3://YOUR-BUCKET/config.js
```

### Step 3: Invalidate CloudFront Cache

```bash
# Get your CloudFront distribution ID
CF_ID=$(aws cloudfront list-distributions --query 'DistributionList.Items[0].Id' --output text)

# Invalidate cache
aws cloudfront create-invalidation --distribution-id $CF_ID --paths '/*'
```

## Better Solution: Configure CloudFront to Forward /api/* Requests

1. Go to AWS Console > CloudFront
2. Select your distribution (`d1dut83snnf5pc`)
3. Create a new behavior:
   - Path pattern: `/api/*`
   - Origin: Your ALB DNS
   - Viewer protocol policy: Redirect HTTP to HTTPS
   - Cache policy: Disabled
   - Origin request policy: All headers
4. Set header forwarding to include `Authorization`
5. Create invalidations

## Test

After applying the fix, reload your app and check the browser console. You should see:
```
🔧 Backend URL: http://your-alb-url.elb.amazonaws.com
```

Instead of the 401 errors, you should now see successful API responses.

## Troubleshooting

If you still get 401 errors:

1. **Check token expiration**: Your JWT token might have expired. Try logging in again.
2. **Check ALB security groups**: Make sure the ALB allows traffic from CloudFront (0.0.0.0/0 on port 80/443).
3. **Check backend logs**: 
   ```bash
   aws logs tail /ecs/vybe-backend --follow
   ```

## Verify ALB is Running

Check if your ECS tasks are running:

```bash
aws ecs list-tasks --cluster vybe-cluster
```

Check ALB target health:

```bash
aws elbv2 describe-target-health \
  --target-group-arn $(aws elbv2 describe-target-groups \
    --query 'TargetGroups[0].TargetGroupArn' --output text)
```

