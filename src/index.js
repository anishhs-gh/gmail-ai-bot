'use strict';

const express = require('express');
const { loadSecrets } = require('./utils/secretManager');
const { setupWatch, fetchNewMessages, fetchMessage, updateStoredHistoryId, getStoredHistoryId } = require('./services/gmailService');
const { parseMessage } = require('./services/emailParser');
const { shouldProcess } = require('./services/filterEngine');
const { decide } = require('./services/geminiService');
const { sendReply } = require('./services/replyService');
const { getConfig } = require('./services/configService');
const { validatePubSubToken } = require('./middleware/authMiddleware');
const apiRoutes = require('./routes/apiRoutes');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Health check (no auth required)
app.get('/health', (req, res) => res.json({ ok: true }));

// Pub/Sub webhook — Gmail push notifications
app.post('/webhook', validatePubSubToken, async (req, res) => {
  // Acknowledge immediately to prevent Pub/Sub retry storm
  res.status(200).send('ok');

  const message = req.body?.message;
  if (!message?.data) {
    logger.warn('Received webhook with no message data');
    return;
  }

  let notification;
  try {
    notification = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
  } catch (err) {
    logger.error('Failed to decode Pub/Sub message', err);
    return;
  }

  const { historyId } = notification;
  if (!historyId) {
    logger.warn('Pub/Sub notification missing historyId', { notification });
    return;
  }

  logger.runWithTrace(message.messageId, () => processHistoryId(historyId));
});

// Config management API
app.use('/api/v1', apiRoutes);

async function processHistoryId(notificationHistoryId) {
  logger.info('Processing Gmail history', { historyId: notificationHistoryId });

  // Use the last stored historyId as startHistoryId (Gmail returns records
  // strictly greater than startHistoryId, so using the notification's own
  // historyId would always return nothing)
  let startHistoryId;
  try {
    startHistoryId = await getStoredHistoryId();
  } catch (err) {
    logger.warn('Could not read stored historyId, falling back to notification historyId', { error: err.message });
    startHistoryId = notificationHistoryId;
  }

  let messageIds;
  try {
    messageIds = await fetchNewMessages(startHistoryId);
  } catch (err) {
    logger.error('Failed to fetch new messages', err, { historyId: startHistoryId });
    return;
  }

  // Update stored historyId to the notification's value so next call starts from here
  try {
    await updateStoredHistoryId(notificationHistoryId);
  } catch (err) {
    logger.warn('Failed to update stored historyId', { error: err.message });
  }

  if (messageIds.length === 0) {
    logger.debug('No new messages in history', { historyId });
    return;
  }

  logger.info(`Processing ${messageIds.length} new message(s)`);
  const config = await getConfig();

  for (const messageId of messageIds) {
    await processMessage(messageId, config);
  }
}

async function processMessage(messageId, config) {
  logger.info('Processing message', { messageId });

  let raw;
  try {
    raw = await fetchMessage(messageId);
  } catch (err) {
    logger.error('Failed to fetch message', err, { messageId });
    return;
  }

  let parsedEmail;
  try {
    parsedEmail = parseMessage(raw);
  } catch (err) {
    logger.error('Failed to parse message', err, { messageId });
    return;
  }

  logger.debug('Parsed email', {
    messageId,
    threadId: parsedEmail.threadId,
    sender: parsedEmail.sender.email,
    subject: parsedEmail.subject,
  });

  // Apply filtering rules
  const filterResult = await shouldProcess(parsedEmail, config);
  if (!filterResult.shouldProcess) {
    logger.info('Email filtered, skipping', { messageId, reason: filterResult.reason });
    return;
  }

  // Ask Gemini
  let decision;
  try {
    decision = await decide(parsedEmail, config);
  } catch (err) {
    logger.error('Gemini decision failed, skipping reply', err, { messageId });
    return;
  }

  if (!decision.shouldReply) {
    logger.info('Gemini decided no reply needed', { messageId, intent: decision.intent });
    return;
  }

  if (decision.confidence < config.minConfidence) {
    logger.info('Gemini confidence below threshold, skipping', {
      messageId,
      confidence: decision.confidence,
      threshold: config.minConfidence,
    });
    return;
  }

  if (!decision.reply || decision.reply.trim() === '') {
    logger.warn('Gemini said shouldReply but provided no reply text', { messageId });
    return;
  }

  // Send reply
  try {
    await sendReply(parsedEmail, decision.reply, config, decision);
  } catch (err) {
    logger.error('Failed to send reply', err, { messageId });
  }
}

async function start() {
  try {
    await loadSecrets();
  } catch (err) {
    logger.critical('Failed to load secrets, exiting', { error: err.message });
    process.exit(1);
  }

  // Ensure Gmail watch is active on startup
  try {
    await setupWatch();
  } catch (err) {
    logger.warn('Gmail watch setup failed on startup (may already be active)', { error: err.message });
  }

  app.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
  });
}

// Graceful shutdown for Cloud Run SIGTERM
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

if (require.main === module) {
  start();
}

module.exports = app;
