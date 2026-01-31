#!/bin/bash
set -e

# Configuration
SERVICE_NAME="${SERVICE_NAME:-kakao-relay}"
REGION="${REGION:-asia-northeast3}"
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project)}"

echo "Deploying $SERVICE_NAME to Cloud Run..."
echo "  Project: $PROJECT_ID"
echo "  Region:  $REGION"

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 256Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --timeout 60s

echo "Deployment complete!"
echo "Service URL: $(gcloud run services describe $SERVICE_NAME --region $REGION --format 'value(status.url)')"
