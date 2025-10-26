# Resolving 401 Errors Behind CloudFront

When the frontend is served from CloudFront but API requests terminate at an ALB or API Gateway, CloudFront must forward the `Authorization` header and query-string parameters. Without this configuration, the backend never receives the Cognito JWT and responds with `401 Unauthorized`.

## Quick Fix (CLI)

```
bash scripts/create-cloudfront-auth-policy.sh E1XZ4DBIHC5C4S api/*
```

The script will:
1. Create (or reuse) an **Origin Request Policy** named `muse-forward-authorization-header` that forwards all viewer headers (including `Authorization`) and all query strings.
2. Apply that policy to the `api/*` behavior on distribution `E1XZ4DBIHC5C4S`.
3. Output when the change is submitted (propagation typically takes 10–15 minutes).

## Manual Console Steps

1. Open **CloudFront** → Distribution `E1XZ4DBIHC5C4S`.
2. Edit the `api/*` behavior.
3. Under **Origin request policy**, choose **Create policy**:
   - Headers: `All viewer headers` (CloudFront does not allow whitelisting `Authorization` alone via the API).
   - Query strings: `All`.
   - Cookies: `None`.
4. Save the behavior.
5. Wait for the deployment to finish.

## Frontend Configuration Tips

- The frontend now supports overriding the backend URL via query parameter or hash:
  - `?backend=https://your-alb-url.com`
  - `?api=https://your-alb-url.com`
  - `#apiBase=https://your-alb-url.com`
- If no override is provided, it falls back to same-origin requests, which works once CloudFront forwards headers correctly.

## Verification

1. After the CloudFront change deploys, reload the app.
2. Open DevTools → Network → `api/projects/user/<id>` and confirm the request returns `200` (include `Authorization` header in request details).
3. If you still receive `401`:
   - Clear local storage tokens and sign in again.
   - Confirm the Cognito pool/client IDs used by the backend match the login configuration.
