'use strict';

const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const logger = require('./logger');

const client = new SecretManagerServiceClient();
const cache = new Map();

const REQUIRED_SECRETS = [
  'GMAIL_SERVICE_ACCOUNT_KEY',
  'GEMINI_API_KEY',
  'API_AUTH_KEY',
];

async function getSecret(secretName, version = 'latest') {
  const cacheKey = `${secretName}@${version}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const name = `projects/${project}/secrets/${secretName}/versions/${version}`;

  const [secretVersion] = await client.accessSecretVersion({ name });
  const value = secretVersion.payload.data.toString('utf8');
  cache.set(cacheKey, value);
  return value;
}

async function loadSecrets() {
  logger.info('Loading secrets from Secret Manager...');
  const missing = [];

  for (const secretName of REQUIRED_SECRETS) {
    if (process.env[secretName]) continue; // already set (e.g. local dev)
    try {
      process.env[secretName] = await getSecret(secretName);
      logger.info(`Loaded secret: ${secretName}`);
    } catch (err) {
      logger.error(`Failed to load secret: ${secretName}`, err);
      missing.push(secretName);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required secrets: ${missing.join(', ')}`);
  }

  logger.info('All secrets loaded successfully');
}

module.exports = { loadSecrets, getSecret };
