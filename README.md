# Gmail AI Auto-Reply Bot

A production-ready Gmail auto-reply bot that runs on Google Cloud Platform. It reads incoming emails, filters out noise (newsletters, marketing, automated messages), and uses **Gemini Flash** to decide whether a reply is needed — then sends one automatically.

```
Gmail Inbox
  → Gmail Watch API
  → Google Pub/Sub
  → Cloud Run (this service)
  → Gemini Flash (decision + reply generation)
  → Gmail API (send reply)
```

---

## Prerequisites

### Tools (install these first)

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | https://nodejs.org |
| Google Cloud SDK (`gcloud`) | latest | https://cloud.google.com/sdk/docs/install |
| Docker | latest | https://docs.docker.com/get-docker/ |

### GCP APIs to enable

Run this once after creating/selecting your GCP project:

```bash
gcloud config set project YOUR_PROJECT_ID

gcloud services enable \
  gmail.googleapis.com \
  pubsub.googleapis.com \
  run.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
```

### Accounts / access you need

- A **Google Workspace** account (or Gmail account) whose inbox you want to monitor
- A **GCP project** with billing enabled
- A **Gemini API key** — get one at https://aistudio.google.com/app/apikey

---

## Setup: Step by Step

### 1. Clone and install

```bash
git clone <your-repo-url> gmail-ai-bot
cd gmail-ai-bot
npm install
```

---

### 2. Create the GCP Service Account

This service account is what the bot uses to call Gmail, Firestore, and Secret Manager.

```bash
# Create the service account
gcloud iam service-accounts create gmail-ai-bot-sa \
  --display-name="Gmail AI Bot Service Account"

# Grant Firestore access
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:gmail-ai-bot-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# Grant Secret Manager access
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:gmail-ai-bot-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Grant Cloud Run invoker (needed for Pub/Sub push auth)
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:gmail-ai-bot-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

# Download the JSON key (keep this safe — never commit it)
gcloud iam service-accounts keys create ./gmail-sa-key.json \
  --iam-account=gmail-ai-bot-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

---

### 3. Enable Domain-Wide Delegation (for Gmail access)

The service account needs permission to read and send email on behalf of your Gmail account.

**If you use Google Workspace:**

1. Go to [Google Workspace Admin Console](https://admin.google.com) → Security → API Controls → Domain-wide Delegation
2. Click **Add new** and enter:
   - **Client ID**: the `client_id` from your `gmail-sa-key.json`
   - **OAuth scopes**:
     ```
     https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/gmail.modify
     ```

**If you use a personal Gmail account:**

Personal Gmail does not support domain-wide delegation. Instead:
1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → OAuth consent screen — configure it
2. Go to Credentials → Create Credentials → OAuth 2.0 Client ID
3. Use the OAuth flow to generate a refresh token for your account
4. Store the full OAuth credentials JSON as `GMAIL_SERVICE_ACCOUNT_KEY` in Secret Manager (same format, just different auth type)

---

### 4. Store secrets in Secret Manager

```bash
# Gmail service account key
gcloud secrets create GMAIL_SERVICE_ACCOUNT_KEY --replication-policy="automatic"
gcloud secrets versions add GMAIL_SERVICE_ACCOUNT_KEY --data-file=./gmail-sa-key.json

# Gemini API key
echo -n "YOUR_GEMINI_API_KEY" | \
  gcloud secrets versions add GEMINI_API_KEY --data-file=-
# (create the secret first if it doesn't exist)
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"
echo -n "YOUR_GEMINI_API_KEY" | \
  gcloud secrets versions add GEMINI_API_KEY --data-file=-

# API auth key (used to protect the /api/v1/* config endpoints)
# Generate a strong random value:
openssl rand -hex 32 | \
  gcloud secrets versions add API_AUTH_KEY --data-file=-
gcloud secrets create API_AUTH_KEY --replication-policy="automatic"
openssl rand -hex 32 > /tmp/api-key.txt
gcloud secrets versions add API_AUTH_KEY --data-file=/tmp/api-key.txt
rm /tmp/api-key.txt

# Tip: save that API key somewhere safe — you'll need it to call /api/v1/* endpoints
```

> After this step, delete `./gmail-sa-key.json` from your local machine — it's now safely in Secret Manager.

---

### 5. Set up Firestore

```bash
# Create a Firestore database in Native mode (us-central1 recommended)
gcloud firestore databases create --location=us-central1
```

Create the initial config document. You can do this in the [Firestore Console](https://console.cloud.google.com/firestore) or via CLI:

```bash
# Using the Firebase Admin SDK or just the console:
# Collection: system_config
# Document:   email_rules
# Fields (all optional — defaults are in config/defaultConfig.js):
{
  "active": false,           ← set to true when ready to go live
  "replyEnabled": true,
  "blacklistedEmails": [],
  "blacklistedDomains": [],
  "whitelistedEmails": [],
  "ignoreSubjectPatterns": [],
  "ignoreBodyPatterns": [],
  "replyOncePerThread": true,
  "maxRepliesPerSenderPerHour": 2,
  "minConfidence": 0.75,
  "replySignature": "Sent by AI assistant",
  "senderName": "Your Name"
}
```

---

### 6. Set up Pub/Sub

```bash
# Create the topic
gcloud pubsub topics create gmail-notifications

# Grant Gmail permission to publish to this topic
gcloud pubsub topics add-iam-policy-binding gmail-notifications \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

The push subscription is created *after* Cloud Run is deployed (you need the URL first — see step 8).

---

### 7. Create the Artifact Registry repository

```bash
gcloud artifacts repositories create gmail-ai-bot \
  --repository-format=docker \
  --location=us-central1 \
  --description="Gmail AI Bot container images"
```

---

### 8. Deploy to Cloud Run

Update the substitution variables in `cloudbuild.yaml` to match your project, then run:

```bash
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions=\
_REGION=us-central1,\
_SERVICE_NAME=gmail-ai-bot,\
_AR_REPO=gmail-ai-bot,\
_GMAIL_USER_EMAIL=you@yourdomain.com,\
_PUBSUB_TOPIC=projects/YOUR_PROJECT_ID/topics/gmail-notifications
```

After deploy completes, get your Cloud Run service URL:

```bash
gcloud run services describe gmail-ai-bot \
  --region=us-central1 \
  --format="value(status.url)"
# Example output: https://gmail-ai-bot-abc123-uc.a.run.app
```

---

### 9. Create the Pub/Sub push subscription

Replace `YOUR_CLOUD_RUN_URL` with the URL from step 8.

```bash
# Create a service account for Pub/Sub to authenticate with Cloud Run
gcloud iam service-accounts create pubsub-invoker \
  --display-name="Pub/Sub Cloud Run Invoker"

gcloud run services add-iam-policy-binding gmail-ai-bot \
  --region=us-central1 \
  --member="serviceAccount:pubsub-invoker@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

# Create the push subscription
gcloud pubsub subscriptions create gmail-push-sub \
  --topic=gmail-notifications \
  --push-endpoint=YOUR_CLOUD_RUN_URL/webhook \
  --push-auth-service-account=pubsub-invoker@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --ack-deadline=60 \
  --min-retry-delay=10s \
  --max-retry-delay=300s
```

---

### 10. Set up Cloud Scheduler (Gmail Watch refresh)

Gmail watch notifications expire after 7 days. This job renews them every 6 days.

```bash
# Get your API key from Secret Manager
gcloud secrets versions access latest --secret=API_AUTH_KEY

# Create the scheduler job
gcloud scheduler jobs create http gmail-watch-refresh \
  --location=us-central1 \
  --schedule="0 9 */6 * *" \
  --uri="YOUR_CLOUD_RUN_URL/api/v1/gmail/refresh-watch" \
  --http-method=POST \
  --headers="Authorization=Bearer YOUR_API_KEY,Content-Type=application/json" \
  --attempt-deadline=30s \
  --description="Refreshes Gmail push notification watch every 6 days"
```

---

### 11. Activate the bot

The bot starts with `active: false` for safety. Once everything is deployed and tested, turn it on:

```bash
curl -X PATCH YOUR_CLOUD_RUN_URL/api/v1/config \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"active": true}'
```

---

## Config API Reference

All endpoints require `Authorization: Bearer YOUR_API_KEY`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/config` | Get full current config |
| `PATCH` | `/api/v1/config` | Update any config fields |
| `GET` | `/api/v1/status` | Health + config summary |
| `POST` | `/api/v1/config/blacklist/email` | Add email to blacklist — body: `{"email":"x@y.com"}` |
| `DELETE` | `/api/v1/config/blacklist/email/:email` | Remove email from blacklist |
| `POST` | `/api/v1/config/blacklist/domain` | Add domain — body: `{"domain":"example.com"}` |
| `DELETE` | `/api/v1/config/blacklist/domain/:domain` | Remove domain |
| `POST` | `/api/v1/config/whitelist` | Add email to whitelist — body: `{"email":"x@y.com"}` |
| `DELETE` | `/api/v1/config/whitelist/:email` | Remove from whitelist |
| `POST` | `/api/v1/config/pattern/add` | Add filter pattern — body: `{"field":"ignoreSubjectPatterns","pattern":"weekly"}` |
| `POST` | `/api/v1/config/pattern/remove` | Remove filter pattern |
| `POST` | `/api/v1/gmail/refresh-watch` | Manually refresh Gmail watch |

### Examples

```bash
# Disable the bot instantly (no redeploy needed)
curl -X PATCH YOUR_CLOUD_RUN_URL/api/v1/config \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"active": false}'

# Blacklist a sender
curl -X POST YOUR_CLOUD_RUN_URL/api/v1/config/blacklist/email \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "alerts@noisyservice.com"}'

# Block an entire domain
curl -X POST YOUR_CLOUD_RUN_URL/api/v1/config/blacklist/domain \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"domain": "marketing.com"}'

# Raise the Gemini confidence threshold (more conservative replies)
curl -X PATCH YOUR_CLOUD_RUN_URL/api/v1/config \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"minConfidence": 0.9}'
```

---

## Local Development

```bash
cp .env.example .env
# Fill in your values — for local dev you can set the secret env vars directly in .env

npm run dev
```

To simulate a Pub/Sub push notification locally:

```bash
# Encode a test payload
echo -n '{"emailAddress":"you@yourdomain.com","historyId":"12345"}' | base64

# Send it to the local webhook
curl -X POST http://localhost:8080/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "data": "<base64-encoded-payload>",
      "messageId": "test-001"
    }
  }'
```

> Note: locally the Pub/Sub JWT validation is skipped if `PUBSUB_AUDIENCE` is not set.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| No emails being processed | Bot is inactive | `PATCH /config` with `{"active":true}` |
| `historyId` errors in logs | Watch expired or historyId gap | Call `POST /api/v1/gmail/refresh-watch` |
| Gemini returning non-JSON | Model hallucination | Already handled — falls back to `shouldReply: false` |
| Duplicate replies | Firestore write failed after send | Check Firestore permissions; consider retrying write before send |
| 401 on `/webhook` | Pub/Sub JWT not verified | Ensure `PUBSUB_AUDIENCE` matches your Cloud Run URL exactly |
| Secrets not loading | Missing Secret Manager roles | Re-check service account has `roles/secretmanager.secretAccessor` |

---

## Architecture Notes

- **Idempotency**: The webhook returns HTTP 200 immediately. Processing is async. If it fails silently, Pub/Sub will not retry — this avoids duplicate-reply storms. Transient failures (Gemini 503) are retried internally with exponential backoff.
- **Loop prevention**: Four independent guards — self-send check, `Auto-Submitted` header, `List-Id` header, and per-thread Firestore dedup.
- **Config hot-reload**: Firestore config changes take effect within 60 seconds (the cache TTL) without any redeployment.
- **Scale**: Cloud Run scales to zero when idle (~50 emails/day = near-zero cost). Scales horizontally for bursts. Firestore handles concurrent writes safely.
