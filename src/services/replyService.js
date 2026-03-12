'use strict';

const { getFirestore, COLLECTIONS, writeWithRetry } = require('../utils/firestoreClient');
const { sendMessage } = require('./gmailService');
const logger = require('../utils/logger');

/**
 * Compose and send a reply, then record it in Firestore.
 */
async function sendReply(parsedEmail, replyBody, config, geminiDecision) {
  const senderEmail = process.env.GMAIL_USER_EMAIL;
  const senderName = config.senderName || 'AI Assistant';
  const signature = config.replySignature ? `\n\n--\n${config.replySignature}` : '';

  const fullBody = replyBody + signature;
  const subject = parsedEmail.subject.toLowerCase().startsWith('re:')
    ? parsedEmail.subject
    : `Re: ${parsedEmail.subject}`;

  const raw = buildRawEmail({
    from: `${senderName} <${senderEmail}>`,
    to: `${parsedEmail.sender.name} <${parsedEmail.sender.email}>`,
    subject,
    inReplyTo: parsedEmail.messageIdHeader,
    references: buildReferences(parsedEmail),
    body: fullBody,
  });

  const encoded = Buffer.from(raw).toString('base64url');

  logger.info('Sending reply', {
    messageId: parsedEmail.messageId,
    threadId: parsedEmail.threadId,
    to: parsedEmail.sender.email,
  });

  const sent = await sendMessage(encoded, parsedEmail.threadId);

  // Record in Firestore for deduplication
  const db = getFirestore();
  const batch = db.batch();

  // Thread-level dedup record
  batch.set(db.collection(COLLECTIONS.replies).doc(parsedEmail.threadId), {
    threadId: parsedEmail.threadId,
    messageId: parsedEmail.messageId,
    sentMessageId: sent.id,
    sender: parsedEmail.sender.email,
    subject: parsedEmail.subject,
    repliedAt: new Date(),
    intent: geminiDecision.intent,
    confidence: geminiDecision.confidence,
  });

  // Sender rate-limit record
  batch.set(db.collection(COLLECTIONS.senderRateLimits).doc(), {
    sender: parsedEmail.sender.email,
    threadId: parsedEmail.threadId,
    repliedAt: new Date(),
  });

  await batch.commit();

  logger.info('Reply sent and recorded', { sentMessageId: sent.id });
  return sent;
}

function buildReferences(parsedEmail) {
  const parts = [];
  if (parsedEmail.references) parts.push(parsedEmail.references);
  if (parsedEmail.messageIdHeader) parts.push(parsedEmail.messageIdHeader);
  return parts.join(' ').trim() || undefined;
}

function buildRawEmail({ from, to, subject, inReplyTo, references, body }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: quoted-printable`,
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push('', body);
  return lines.join('\r\n');
}

function encodeSubject(subject) {
  // Encode non-ASCII in RFC 2047 format
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
}

module.exports = { sendReply };
