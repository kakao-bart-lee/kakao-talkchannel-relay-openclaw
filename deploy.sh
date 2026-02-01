#!/bin/bash
set -e

# Configuration (matches existing Cloud Run deployment)
SERVICE_NAME="kakao-talkchannel-relay"
REGION="asia-northeast3"
PROJECT_ID="${PROJECT_ID:-{PROJECT_ID}}"
CLOUD_SQL_INSTANCE="{PROJECT_ID}:asia-northeast3:{INSTANCE_NAME}"
VPC_CONNECTOR="{VPC_CONNECTOR}"

echo "Deploying $SERVICE_NAME to Cloud Run..."
echo "  Project: $PROJECT_ID"
echo "  Region:  $REGION"

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --concurrency 100 \
  --timeout 60s \
  --cpu-boost \
  --add-cloudsql-instances "$CLOUD_SQL_INSTANCE" \
  --vpc-connector "$VPC_CONNECTOR" \
  --set-env-vars "LOG_LEVEL=info,CALLBACK_TTL_SECONDS=55" \
  --set-secrets "DATABASE_URL=kakao-relay-database-url:latest,REDIS_URL=kakao-relay-redis-url:latest,ADMIN_PASSWORD=kakao-relay-admin-password:latest,PORTAL_SESSION_SECRET=kakao-relay-session-secret:latest,ADMIN_SESSION_SECRET=kakao-relay-session-secret:latest"

echo ""
echo "Deployment complete!"
gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format 'value(status.url)'
