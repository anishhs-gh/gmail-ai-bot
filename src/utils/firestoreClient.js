'use strict';

const { Firestore } = require('@google-cloud/firestore');

let _instance = null;

function getFirestore() {
  if (!_instance) {
    _instance = new Firestore({
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
    });
  }
  return _instance;
}

const COLLECTIONS = {
  config: 'system_config',
  replies: 'replied_threads',
  watchState: 'gmail_watch',
  senderRateLimits: 'sender_rate_limits',
};

async function writeWithRetry(docRef, data, options = {}, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (options.merge) {
        await docRef.set(data, { merge: true });
      } else {
        await docRef.set(data);
      }
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

module.exports = { getFirestore, COLLECTIONS, writeWithRetry };
