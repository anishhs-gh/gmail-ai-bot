'use strict';

const { getFirestore, COLLECTIONS, writeWithRetry } = require('../utils/firestoreClient');
const defaultConfig = require('../../config/defaultConfig');
const logger = require('../utils/logger');

const CACHE_TTL_MS = parseInt(process.env.CONFIG_CACHE_TTL_MS) || 60_000;

let _cache = null;
let _cacheExpiry = 0;

function getDocRef() {
  return getFirestore().collection(COLLECTIONS.config).doc('email_rules');
}

async function getConfig() {
  if (_cache && Date.now() < _cacheExpiry) return _cache;

  try {
    const snap = await getDocRef().get();
    const stored = snap.exists ? snap.data() : {};
    _cache = { ...defaultConfig, ...stored };
    _cacheExpiry = Date.now() + CACHE_TTL_MS;
    return _cache;
  } catch (err) {
    logger.error('Failed to load config from Firestore, using cache or defaults', err);
    return _cache || { ...defaultConfig };
  }
}

async function updateConfig(updates) {
  const allowed = new Set(Object.keys(defaultConfig));
  const sanitized = {};
  for (const [k, v] of Object.entries(updates)) {
    if (!allowed.has(k)) throw new Error(`Unknown config field: ${k}`);
    sanitized[k] = v;
  }
  await writeWithRetry(getDocRef(), sanitized, { merge: true });
  _cache = null;
  logger.info('Config updated', { fields: Object.keys(sanitized) });
}

async function addToList(field, value) {
  const { FieldValue } = require('@google-cloud/firestore');
  await getDocRef().set({ [field]: FieldValue.arrayUnion(value) }, { merge: true });
  _cache = null;
}

async function removeFromList(field, value) {
  const { FieldValue } = require('@google-cloud/firestore');
  await getDocRef().set({ [field]: FieldValue.arrayRemove(value) }, { merge: true });
  _cache = null;
}

function invalidateCache() {
  _cache = null;
  _cacheExpiry = 0;
}

module.exports = { getConfig, updateConfig, addToList, removeFromList, invalidateCache };
