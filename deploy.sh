#!/bin/bash
set -e

# Configuration (matches existing Cloud Run deployment)
SERVICE_NAME="kakao-talkchannel-relay"
REGION="asia-northeast3"
PROJECT_ID="${PROJECT_ID:-haruto-snow}"
CLOUD_SQL_INSTANCE="haruto-snow:asia-northeast3:arkana-sandbox"

# Required secrets (must be created in Secret Manager):
#   - kakao-relay-database-url: PostgreSQL connection string
#   - kakao-relay-redis-url: Redis connection string (required for SSE pub/sub)
#   - kakao-relay-admin-password: Admin login password
#   - kakao-relay-session-secret: Session signing secret
#
# Create Redis secret if not exists:
#   gcloud secrets create kakao-relay-redis-url --project $PROJECT_ID
#   echo -n "redis://host:6379" | gcloud secrets versions add kakao-relay-redis-url --data-file=-

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
  --set-env-vars "LOG_LEVEL=info,CALLBACK_TTL_SECONDS=55" \
  --set-secrets "DATABASE_URL=kakao-relay-database-url:latest,REDIS_URL=kakao-relay-redis-url:latest,ADMIN_PASSWORD=kakao-relay-admin-password:latest,PORTAL_SESSION_SECRET=kakao-relay-session-secret:latest,ADMIN_SESSION_SECRET=kakao-relay-session-secret:latest"

echo ""
echo "Deployment complete!"
gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format 'value(status.url)'
