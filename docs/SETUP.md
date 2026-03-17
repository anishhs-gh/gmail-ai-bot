# Gmail AI Bot — Full GCP Setup Guide

This guide covers every step to deploy the Gmail AI Bot on Google Cloud Platform, including fixes for common issues encountered during setup.

---

## Prerequisites

Install these tools first:

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | https://nodejs.org |
| Google Cloud SDK (`gcloud`) | latest | https://cloud.google.com/sdk/docs/install |
| Docker | latest | https://docs.docker.com/get-docker/ |

You also need:
- A **GCP project** with billing enabled
- A **Gemini API key** from https://aistudio.google.com/app/apikey
- A **Gmail or Google Workspace account** whose inbox you want to monitor

---

## Step 1 — Authenticate and set your project

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

---

## Step 2 — Enable required GCP APIs

```bash
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

---

## Step 3 — Create the Service Account

```bash
gcloud iam service-accounts create gmail-ai-bot-sa \
  --display-name="Gmail AI Bot Service Account"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:gmail-ai-bot-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:gmail-ai-bot-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:gmail-ai-bot-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

---

## Step 4 — Grant Gmail Access

### If you have a Google Workspace account

1. Go to [Google Workspace Admin Console](https://admin.google.com)
2. Navigate to **Security → API Controls → Domain-wide Delegation**
3. Click **Add new** and enter:
   - **Client ID**: the `client_id` value from your service account key JSON
   - **OAuth scopes**:
     ```
     https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/gmail.modify
     ```

### If you have a personal @gmail.com account

> Note: The Admin Console is only for Google Workspace accounts. Personal Gmail accounts must use OAuth 2.0.

#### 4a — Configure OAuth consent screen (GCP Console GUI)

1. Go to [GCP Console](https://console.cloud.google.com) → **APIs & Services → OAuth consent screen**
2. Choose **External** (only option for personal Gmail) → click **Create**

   > **Why External?** "Internal" is only available to Google Workspace organizations. "External" with Testing mode still behaves privately — only accounts you add as test users can access it.

3. Fill in:
   - App name: `Gmail AI Bot`
   - User support email: your Gmail
   - Developer contact email: your Gmail
4. Click through **Scopes** and **Test users** screens
5. On **Test users**: click **Add users** → add your Gmail address
6. Click **Save and Continue**

#### 4b — Create OAuth 2.0 credentials (GCP Console GUI)

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Desktop app**
3. Name it anything → click **Create**
4. Download the JSON → save as `oauth_client.json` in the project root

#### 4c — Generate a refresh token

Install the auth library locally:

```bash
npm install @google-cloud/local-auth
```

Create `get_token.js` in the project root:

```js
const { authenticate } = require('@google-cloud/local-auth');
const path = require('path');

async function main() {
  const auth = await authenticate({
    keyfilePath: path.join(__dirname, 'oauth_client.json'),
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
  });
  console.log(JSON.stringify(auth.credentials, null, 2));
}

main();
```

```bash
node get_token.js
```

A browser will open — sign in with your Gmail and allow access. Copy the printed JSON output.

#### 4d — Build the credentials JSON

Create `gmail_oauth_creds.json`:

```json
{
  "type": "authorized_user",
  "client_id": "YOUR_CLIENT_ID",
  "client_secret": "YOUR_CLIENT_SECRET",
  "refresh_token": "YOUR_REFRESH_TOKEN"
}
```

- `client_id` and `client_secret` come from `oauth_client.json`
- `refresh_token` comes from the output of `get_token.js`

---

## Step 5 — Store secrets in Secret Manager

```bash
# Gmail credentials
gcloud secrets create GMAIL_SERVICE_ACCOUNT_KEY --replication-policy="automatic"
gcloud secrets versions add GMAIL_SERVICE_ACCOUNT_KEY --data-file=./gmail_oauth_creds.json

# Gemini API key
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets versions add GEMINI_API_KEY --data-file=-

# API auth key (protects the /api/v1/* endpoints)
gcloud secrets create API_AUTH_KEY --replication-policy="automatic"
openssl rand -hex 32 > /tmp/api-key.txt
gcloud secrets versions add API_AUTH_KEY --data-file=/tmp/api-key.txt
cat /tmp/api-key.txt   # save this value — you'll need it to call the API
rm /tmp/api-key.txt

# Clean up local credential files
rm oauth_client.json gmail_oauth_creds.json get_token.js
```

---

## Step 6 — Create Firestore database

```bash
gcloud firestore databases create --location=us-central1
```

Then in the [Firestore Console](https://console.cloud.google.com/firestore), create:
- **Collection**: `system_config`
- **Document**: `email_rules`
- Leave fields at defaults (the app populates them from `config/defaultConfig.js`)

---

## Step 7 — Set up Pub/Sub

```bash
gcloud pubsub topics create gmail-notifications

gcloud pubsub topics add-iam-policy-binding gmail-notifications \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

---

## Step 8 — Create Artifact Registry repository

```bash
gcloud artifacts repositories create gmail-ai-bot \
  --repository-format=docker \
  --location=us-central1 \
  --description="Gmail AI Bot container images"
```

---

## Step 9 — Deploy to Cloud Run

### 9a — Grant Cloud Build service accounts permission to act as the bot SA

```bash
# Cloud Build SA
gcloud iam service-accounts add-iam-policy-binding gmail-ai-bot-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --member="serviceAccount:YOUR_PROJECT_NUMBER@cloudbuild.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Compute SA (used by Cloud Build for deployment)
gcloud iam service-accounts add-iam-policy-binding gmail-ai-bot-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --member="serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

> Find your project number with: `gcloud projects describe YOUR_PROJECT_ID --format="value(projectNumber)"`

### 9b — Submit the build

Run as a single line (do not use backslash line continuations in zsh — they cause parsing errors):

```bash
gcloud builds submit --config=cloudbuild.yaml --substitutions=_REGION=us-central1,_SERVICE_NAME=gmail-ai-bot,_AR_REPO=gmail-ai-bot,_GMAIL_USER_EMAIL=you@gmail.com,_PUBSUB_TOPIC=projects/YOUR_PROJECT_ID/topics/gmail-notifications,_PUBSUB_AUDIENCE=YOUR_CLOUD_RUN_URL
```

> `_PUBSUB_AUDIENCE` must be the exact Cloud Run service URL (e.g. `https://gmail-ai-bot-vqcfpb6dsq-uc.a.run.app`). Get it from step 9c below. On first deploy, omit it — then redeploy with the correct URL once you have it.

### 9c — Get the Cloud Run service URL

```bash
gcloud run services describe gmail-ai-bot \
  --region=us-central1 \
  --format="value(status.url)"
# Example: https://gmail-ai-bot-vqcfpb6dsq-uc.a.run.app
```

### 9d — Allow unauthenticated access

The app uses its own Bearer token auth for the API. Allow Cloud Run to pass requests through to the app:

```bash
gcloud run services set-iam-policy gmail-ai-bot --region=us-central1 /dev/stdin <<'EOF'
bindings:
- members:
  - allUsers
  role: roles/run.invoker
EOF
```

---

## Step 10 — Create Pub/Sub push subscription

```bash
gcloud iam service-accounts create pubsub-invoker \
  --display-name="Pub/Sub Cloud Run Invoker"

gcloud run services add-iam-policy-binding gmail-ai-bot \
  --region=us-central1 \
  --member="serviceAccount:pubsub-invoker@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

gcloud pubsub subscriptions create gmail-push-sub \
  --topic=gmail-notifications \
  --push-endpoint=YOUR_CLOUD_RUN_URL/webhook \
  --push-auth-service-account=pubsub-invoker@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --ack-deadline=60 \
  --min-retry-delay=10s \
  --max-retry-delay=300s
```

---

## Step 11 — Set up Cloud Scheduler

Gmail watch tokens expire every 7 days. This job renews them every 6 days:

```bash
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

## Step 12 — Start Gmail watch and activate the bot

```bash
# Start the Gmail watch (registers the Pub/Sub push notifications)
curl -X POST YOUR_CLOUD_RUN_URL/api/v1/gmail/refresh-watch \
  -H "Authorization: Bearer YOUR_API_KEY"

# Activate the bot (starts at inactive by default for safety)
curl -X PATCH YOUR_CLOUD_RUN_URL/api/v1/config \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"active": true}'

# Verify everything is running
curl YOUR_CLOUD_RUN_URL/api/v1/status \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## Build Troubleshooting

### `SHORT_SHA` is empty — invalid Docker tag

**Symptom:** `invalid argument "...gmail-ai-bot:" for "-t, --tag" flag`

**Cause:** `gcloud builds submit` only populates `SHORT_SHA` if the source is a connected git repo with at least one commit.

**Fix:** Initialize a git repo and make a commit before submitting:
```bash
git init
git add .
git commit -m "initial commit"
```

### Missing `googleapis` module

**Symptom:** `Error: Cannot find module 'googleapis'` in Cloud Run logs

**Fix:**
```bash
npm install googleapis
git add package.json package-lock.json
git commit -m "add googleapis dependency"
# then redeploy
```

### `iam.serviceaccounts.actAs` permission denied

**Symptom:** `Permission 'iam.serviceaccounts.actAs' denied on service account ...`

**Fix:** Grant the permission to both Cloud Build service accounts:
```bash
gcloud iam service-accounts add-iam-policy-binding gmail-ai-bot-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --member="serviceAccount:YOUR_PROJECT_NUMBER@cloudbuild.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

gcloud iam service-accounts add-iam-policy-binding gmail-ai-bot-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --member="serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

### `${PROJECT_ID}` not resolving in `cloudbuild.yaml`

**Symptom:** Service account name shows `gmail-ai-bot-sa@${PROJECT_ID}.iam.gserviceaccount.com` literally

**Cause:** `${PROJECT_ID}` inside substitution default values in `cloudbuild.yaml` is not further resolved.

**Fix:** Hardcode the project ID in the `_SERVICE_ACCOUNT` default value in `cloudbuild.yaml`:
```yaml
_SERVICE_ACCOUNT: gmail-ai-bot-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

### Container fails to start — secrets not loading

**Symptom:** `Failed to load secret: GEMINI_API_KEY` in Cloud Run logs

**Fix:** Ensure all three secrets exist in Secret Manager:
```bash
gcloud secrets list --project=YOUR_PROJECT_ID
# Must show: GMAIL_SERVICE_ACCOUNT_KEY, GEMINI_API_KEY, API_AUTH_KEY
```

Create any missing ones (see Step 5).

### 401 Unauthorized on API endpoints

**Symptom:** Cloud Run returns HTML `401 Unauthorized` before reaching the app

**Cause:** Cloud Run deployed with `--no-allow-unauthenticated` blocks all requests at the infrastructure level.

**Fix:** Open access at the Cloud Run level (the app handles auth via Bearer token):
```bash
gcloud run services set-iam-policy gmail-ai-bot --region=us-central1 /dev/stdin <<'EOF'
bindings:
- members:
  - allUsers
  role: roles/run.invoker
EOF
```

### `gcloud builds submit` substitutions parsing error

**Symptom:** `zsh: command not found: --config=cloudbuild.yaml`

**Cause:** Backslash line continuations in zsh break the command across multiple shell invocations.

**Fix:** Always run the `gcloud builds submit` command as a single line with no line breaks.

---

### Webhook rejects all Pub/Sub messages — `Invalid Pub/Sub token`

**Symptom:** Emails arrive but are never processed. Logs show `Invalid Pub/Sub token` on every webhook call.

**Cause:** The `PUBSUB_AUDIENCE` env var doesn't match the actual Cloud Run URL. The `cloudbuild.yaml` template generates an incorrect URL (missing the random hash in the hostname).

**Fix:** Update the env var directly on the running service:
```bash
gcloud run services update gmail-ai-bot \
  --region=us-central1 \
  --update-env-vars="PUBSUB_AUDIENCE=YOUR_CLOUD_RUN_URL"
```

For future deploys, pass `_PUBSUB_AUDIENCE` as a substitution (see step 9b).

---

## Logging

### View live Cloud Run logs

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=gmail-ai-bot" \
  --limit=50 \
  --format="value(textPayload,jsonPayload.message)" \
  --project=YOUR_PROJECT_ID
```

### Filter to last N minutes

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=gmail-ai-bot" \
  --limit=50 \
  --format="value(textPayload,jsonPayload.message)" \
  --project=YOUR_PROJECT_ID \
  --freshness=5m
```

Change `5m` to `1h`, `30m`, etc. as needed.

### Check secrets exist

```bash
gcloud secrets list --project=YOUR_PROJECT_ID
# Should show: GMAIL_SERVICE_ACCOUNT_KEY, GEMINI_API_KEY, API_AUTH_KEY
```

### Check Cloud Run env vars

```bash
gcloud run services describe gmail-ai-bot \
  --region=us-central1 \
  --format="value(spec.template.spec.containers[0].env)" \
  --project=YOUR_PROJECT_ID
```

### Update a single env var without redeploying

```bash
gcloud run services update gmail-ai-bot \
  --region=us-central1 \
  --update-env-vars="VAR_NAME=value" \
  --project=YOUR_PROJECT_ID
```
