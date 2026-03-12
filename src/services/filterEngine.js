'use strict';

const { getFirestore, COLLECTIONS } = require('../utils/firestoreClient');
const logger = require('../utils/logger');

const AUTOMATED_HEADERS = [
  'auto-submitted',
  'x-autoreply',
  'x-autorespond',
  'list-id',
  'list-unsubscribe',
];

const BULK_PRECEDENCE = new Set(['bulk', 'list', 'junk']);

/**
 * Returns { shouldProcess: boolean, reason: string }
 */
async function shouldProcess(parsedEmail, config) {
  const { sender, subject, body, headers, threadId } = parsedEmail;
  const senderEmail = sender.email.toLowerCase();
  const senderDomain = senderEmail.split('@')[1] || '';

  // 1. Self-send guard
  const botEmail = (process.env.GMAIL_USER_EMAIL || '').toLowerCase();
  if (senderEmail === botEmail) {
    return skip('self-send');
  }

  // 2. Auto-reply header guard
  for (const h of AUTOMATED_HEADERS) {
    if (headers.has(h)) {
      const val = headers.get(h).toLowerCase();
      if (h === 'auto-submitted' && val === 'no') continue;
      return skip(`automated-header:${h}`);
    }
  }

  const precedence = headers.get('precedence');
  if (precedence && BULK_PRECEDENCE.has(precedence.toLowerCase())) {
    return skip('bulk-precedence');
  }

  // 3. Global kill switch
  if (!config.active || !config.replyEnabled) {
    return skip('bot-inactive');
  }

  // 4. Blacklist checks
  if (config.blacklistedEmails.includes(senderEmail)) {
    return skip('blacklisted-email');
  }
  if (config.blacklistedDomains.some(d => senderDomain === d || senderDomain.endsWith('.' + d))) {
    return skip('blacklisted-domain');
  }

  // 5. Whitelist (if non-empty, only whitelisted senders pass)
  if (config.whitelistedEmails.length > 0 && !config.whitelistedEmails.includes(senderEmail)) {
    return skip('not-whitelisted');
  }

  // 6. Subject pattern filters
  const subjectLower = subject.toLowerCase();
  for (const pattern of config.ignoreSubjectPatterns) {
    if (subjectLower.includes(pattern.toLowerCase())) {
      return skip(`subject-pattern:${pattern}`);
    }
  }

  // 7. Body pattern filters
  const bodyLower = (body.plain || '').toLowerCase();
  for (const pattern of config.ignoreBodyPatterns) {
    if (bodyLower.includes(pattern.toLowerCase())) {
      return skip(`body-pattern:${pattern}`);
    }
  }

  // 8. Thread deduplication
  if (config.replyOncePerThread) {
    const alreadyReplied = await hasRepliedToThread(threadId);
    if (alreadyReplied) {
      return skip('already-replied-to-thread');
    }
  }

  // 9. Sender rate limit
  const rateExceeded = await isSenderRateLimited(senderEmail, config.maxRepliesPerSenderPerHour);
  if (rateExceeded) {
    return skip('sender-rate-limit');
  }

  return { shouldProcess: true, reason: 'passed-all-filters' };
}

async function hasRepliedToThread(threadId) {
  const db = getFirestore();
  const doc = await db.collection(COLLECTIONS.replies).doc(threadId).get();
  return doc.exists;
}

async function isSenderRateLimited(senderEmail, maxPerHour) {
  const db = getFirestore();
  const oneHourAgo = new Date(Date.now() - 3600_000);
  const snap = await db
    .collection(COLLECTIONS.senderRateLimits)
    .where('sender', '==', senderEmail)
    .where('repliedAt', '>', oneHourAgo)
    .get();
  return snap.size >= maxPerHour;
}

function skip(reason) {
  logger.debug('Email filtered', { reason });
  return { shouldProcess: false, reason };
}

module.exports = { shouldProcess };
