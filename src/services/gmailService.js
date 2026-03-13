'use strict';

const { google } = require('googleapis');
const { getFirestore, COLLECTIONS, writeWithRetry } = require('../utils/firestoreClient');
const logger = require('../utils/logger');

let _gmail = null;

async function getGmailClient() {
  if (_gmail) return _gmail;

  const keyJson = process.env.GMAIL_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error('GMAIL_SERVICE_ACCOUNT_KEY not set');

  const credentials = JSON.parse(keyJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
  });

  // Domain-wide delegation: impersonate the target Gmail account
  const authClient = await auth.getClient();
  if (authClient.subject !== undefined) {
    authClient.subject = process.env.GMAIL_USER_EMAIL;
  } else {
    // JWT client
    authClient._subject = process.env.GMAIL_USER_EMAIL;
  }

  _gmail = google.gmail({ version: 'v1', auth: authClient });
  return _gmail;
}

/**
 * Register Gmail push notifications to a Pub/Sub topic.
 */
async function setupWatch() {
  const gmail = await getGmailClient();
  const topicName = process.env.PUBSUB_TOPIC;
  if (!topicName) throw new Error('PUBSUB_TOPIC not set');

  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName,
      labelIds: ['INBOX'],
      labelFilterBehavior: 'INCLUDE',
    },
  });

  const { historyId, expiration } = res.data;
  logger.info('Gmail watch registered', { historyId, expiration });

  // Persist historyId baseline and expiration
  await writeWithRetry(
    getFirestore().collection(COLLECTIONS.watchState).doc('current'),
    { historyId, expiration: parseInt(expiration), updatedAt: new Date() }
  );

  return { historyId, expiration };
}

/**
 * Fetch new message IDs since the given historyId.
 */
async function fetchNewMessages(startHistoryId) {
  const gmail = await getGmailClient();
  const messageIds = [];
  let pageToken;

  do {
    const res = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      labelId: 'INBOX',
      ...(pageToken && { pageToken }),
    });

    const records = res.data.history || [];
    for (const record of records) {
      for (const added of record.messagesAdded || []) {
        messageIds.push(added.message.id);
      }
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return [...new Set(messageIds)]; // deduplicate
}

/**
 * Fetch the full message payload.
 */
async function fetchMessage(messageId) {
  const gmail = await getGmailClient();
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return res.data;
}

/**
 * Send a raw RFC 2822 email (base64url encoded), preserving thread.
 */
async function sendMessage(rawEmailBase64, threadId) {
  const gmail = await getGmailClient();
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: rawEmailBase64,
      threadId,
    },
  });
  return res.data;
}

/**
 * Read the last stored historyId from Firestore.
 */
async function getStoredHistoryId() {
  const doc = await getFirestore().collection(COLLECTIONS.watchState).doc('current').get();
  if (!doc.exists) throw new Error('No stored historyId found');
  return doc.data().historyId;
}

/**
 * Update the stored historyId in Firestore after processing.
 */
async function updateStoredHistoryId(historyId) {
  await writeWithRetry(
    getFirestore().collection(COLLECTIONS.watchState).doc('current'),
    { historyId, updatedAt: new Date() },
    { merge: true }
  );
}

module.exports = { setupWatch, fetchNewMessages, fetchMessage, sendMessage, getStoredHistoryId, updateStoredHistoryId };
