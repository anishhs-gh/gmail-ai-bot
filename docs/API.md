# Gmail AI Bot — API Reference

All endpoints require the following header:

```
Authorization: Bearer YOUR_API_KEY
```

Base URL: `YOUR_CLOUD_RUN_URL`

---

## Config

### GET /api/v1/config

Returns the full current configuration.

```bash
curl YOUR_CLOUD_RUN_URL/api/v1/config \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Response:**
```json
{
  "ok": true,
  "config": {
    "active": true,
    "replyEnabled": true,
    "senderName": "AI Assistant",
    "replySignature": "",
    "minConfidence": 0.75,
    "replyOncePerThread": true,
    "maxRepliesPerSenderPerHour": 2,
    "blacklistedEmails": [],
    "blacklistedDomains": [],
    "whitelistedEmails": [],
    "ignoreSubjectPatterns": [],
    "ignoreBodyPatterns": [],
    "systemPrompt": "..."
  }
}
```

---

### PATCH /api/v1/config

Update any config fields. Only the fields you send are changed.

```bash
curl -X PATCH YOUR_CLOUD_RUN_URL/api/v1/config \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"active": true}'
```

**Patchable fields:**

| Field | Type | Description |
|-------|------|-------------|
| `active` | boolean | Master switch — enables/disables the bot |
| `replyEnabled` | boolean | Whether to actually send replies |
| `senderName` | string | Name shown in reply signatures |
| `replySignature` | string | Appended to every reply |
| `minConfidence` | number (0–1) | Minimum Gemini confidence score to send a reply |
| `replyOncePerThread` | boolean | Only reply once per email thread |
| `maxRepliesPerSenderPerHour` | number | Rate limit per sender |
| `systemPrompt` | string | Full prompt sent to Gemini |

**Examples:**

Disable the bot instantly (no redeploy needed):
```bash
curl -X PATCH YOUR_CLOUD_RUN_URL/api/v1/config \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"active": false}'
```

Set sender name and signature:
```bash
curl -X PATCH YOUR_CLOUD_RUN_URL/api/v1/config \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"senderName": "Anish", "replySignature": "Sent by my AI assistant"}'
```

Raise confidence threshold (more conservative — fewer replies):
```bash
curl -X PATCH YOUR_CLOUD_RUN_URL/api/v1/config \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"minConfidence": 0.9}'
```

---

## Status

### GET /api/v1/status

Returns a health summary.

```bash
curl YOUR_CLOUD_RUN_URL/api/v1/status \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Response:**
```json
{
  "ok": true,
  "active": true,
  "replyEnabled": true,
  "blacklistedEmailsCount": 0,
  "blacklistedDomainsCount": 0,
  "whitelistedEmailsCount": 0
}
```

---

## Blacklist

### POST /api/v1/config/blacklist/email

Block a specific email address from triggering replies.

```bash
curl -X POST YOUR_CLOUD_RUN_URL/api/v1/config/blacklist/email \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "alerts@noisyservice.com"}'
```

---

### DELETE /api/v1/config/blacklist/email/:email

Remove an email address from the blacklist.

```bash
curl -X DELETE YOUR_CLOUD_RUN_URL/api/v1/config/blacklist/email/alerts@noisyservice.com \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

### POST /api/v1/config/blacklist/domain

Block all emails from a domain.

```bash
curl -X POST YOUR_CLOUD_RUN_URL/api/v1/config/blacklist/domain \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"domain": "marketing.com"}'
```

---

### DELETE /api/v1/config/blacklist/domain/:domain

Remove a domain from the blacklist.

```bash
curl -X DELETE YOUR_CLOUD_RUN_URL/api/v1/config/blacklist/domain/marketing.com \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## Whitelist

### POST /api/v1/config/whitelist

Add an email to the whitelist. Whitelisted senders bypass all filters and always get a reply if Gemini decides one is needed.

```bash
curl -X POST YOUR_CLOUD_RUN_URL/api/v1/config/whitelist \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "boss@company.com"}'
```

---

### DELETE /api/v1/config/whitelist/:email

Remove an email from the whitelist.

```bash
curl -X DELETE YOUR_CLOUD_RUN_URL/api/v1/config/whitelist/boss@company.com \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## Filter Patterns

Patterns are matched against email subjects or bodies using case-insensitive substring matching.

### POST /api/v1/config/pattern/add

Add a filter pattern to `ignoreSubjectPatterns` or `ignoreBodyPatterns`.

```bash
curl -X POST YOUR_CLOUD_RUN_URL/api/v1/config/pattern/add \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"field": "ignoreSubjectPatterns", "pattern": "weekly digest"}'
```

Valid `field` values: `ignoreSubjectPatterns`, `ignoreBodyPatterns`

---

### POST /api/v1/config/pattern/remove

Remove a filter pattern.

```bash
curl -X POST YOUR_CLOUD_RUN_URL/api/v1/config/pattern/remove \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"field": "ignoreSubjectPatterns", "pattern": "weekly digest"}'
```

---

## Gmail

### POST /api/v1/gmail/refresh-watch

Manually refreshes the Gmail push notification watch. Gmail watches expire after 7 days — Cloud Scheduler calls this automatically every 6 days. Call it manually if you suspect the watch has expired.

```bash
curl -X POST YOUR_CLOUD_RUN_URL/api/v1/gmail/refresh-watch \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Response:**
```json
{
  "ok": true,
  "historyId": "2598006",
  "expiration": "1773963219818"
}
```

---

## Webhook (internal)

### POST /webhook

Receives Pub/Sub push notifications from Gmail. This endpoint is called automatically by Google Pub/Sub and should not be called manually. It validates the Pub/Sub JWT token and processes incoming email notifications.
