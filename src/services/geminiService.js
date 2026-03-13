'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');

let _genAI = null;

function getGenAI() {
  if (!_genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');
    _genAI = new GoogleGenerativeAI(apiKey);
  }
  return _genAI;
}

/**
 * Sends email to Gemini and returns { intent, shouldReply, reply, confidence }
 */
async function decide(parsedEmail, config) {
  const model = getGenAI().getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });

  const emailContent = buildEmailContent(parsedEmail);
  const prompt = `${config.systemPrompt}\n\nEmail content:\n\n${emailContent}`;

  logger.debug('Sending email to Gemini', { messageId: parsedEmail.messageId });

  const rawResponse = await callWithRetry(model, prompt);
  const decision = parseGeminiResponse(rawResponse);

  logger.info('Gemini decision', {
    messageId: parsedEmail.messageId,
    intent: decision.intent,
    shouldReply: decision.shouldReply,
    confidence: decision.confidence,
  });

  return decision;
}

function buildEmailContent(parsedEmail) {
  return [
    `From: ${parsedEmail.sender.name} <${parsedEmail.sender.email}>`,
    `Subject: ${parsedEmail.subject}`,
    `Date: ${parsedEmail.timestamp.toISOString()}`,
    '',
    parsedEmail.body.plain || '(no plain text body)',
  ].join('\n');
}

async function callWithRetry(model, prompt, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      lastErr = err;
      const status = err.status || err.code;
      if (status !== 429 && status !== 503) throw err;
      const delay = 1000 * Math.pow(2, attempt);
      logger.warn('Gemini rate limit / unavailable, retrying', { attempt, delay });
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function parseGeminiResponse(raw) {
  const fallback = { intent: 'other', shouldReply: false, reply: '', confidence: 0 };
  try {
    // Try direct parse first
    return { ...fallback, ...JSON.parse(raw) };
  } catch (_) {
    // Extract JSON from prose or code fences
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
    if (match) {
      try {
        return { ...fallback, ...JSON.parse(match[1]) };
      } catch (_) {}
    }
    logger.warn('Failed to parse Gemini response as JSON', { raw: raw.slice(0, 200) });
    return fallback;
  }
}

module.exports = { decide };
