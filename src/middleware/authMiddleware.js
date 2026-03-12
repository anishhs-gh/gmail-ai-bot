'use strict';

const crypto = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');
const logger = require('../utils/logger');

const pubsubClient = new OAuth2Client();

/**
 * Validates Bearer API key for config management routes.
 */
function validateApiKey(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  const validKey = process.env.API_AUTH_KEY || '';
  if (!token || !timingSafeCompare(token, validKey)) {
    logger.warn('Unauthorized config API request', { ip: req.ip, path: req.path });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/**
 * Validates Pub/Sub push JWT on the /webhook route.
 */
async function validatePubSubToken(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    logger.warn('Missing Pub/Sub auth token');
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const audience = process.env.PUBSUB_AUDIENCE || process.env.CLOUD_RUN_URL;
    if (audience) {
      await pubsubClient.verifyIdToken({ idToken: token, audience });
    }
    next();
  } catch (err) {
    logger.warn('Invalid Pub/Sub token', { error: err.message });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function timingSafeCompare(a, b) {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) {
      // Still run the compare to avoid timing leak on length
      crypto.timingSafeEqual(ba, ba);
      return false;
    }
    return crypto.timingSafeEqual(ba, bb);
  } catch (_) {
    return false;
  }
}

module.exports = { validateApiKey, validatePubSubToken };
