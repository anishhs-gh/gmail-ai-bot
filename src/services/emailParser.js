'use strict';

/**
 * Parses a raw Gmail API message object into a normalized structure.
 */
function parseMessage(raw) {
  const headers = extractHeaders(raw.payload.headers || []);

  return {
    messageId: raw.id,
    threadId: raw.threadId,
    labelIds: raw.labelIds || [],
    sender: parseSenderHeader(headers.get('from') || ''),
    subject: headers.get('subject') || '(no subject)',
    body: extractBody(raw.payload),
    headers,
    inReplyTo: headers.get('in-reply-to') || null,
    references: headers.get('references') || null,
    messageIdHeader: headers.get('message-id') || null,
    timestamp: raw.internalDate ? new Date(parseInt(raw.internalDate)) : new Date(),
  };
}

function extractHeaders(headerArray) {
  const map = new Map();
  for (const h of headerArray) {
    map.set(h.name.toLowerCase(), h.value);
  }
  return map;
}

function parseSenderHeader(from) {
  const match = from.match(/^(?:"?([^"<]*)"?\s*)?<?([^>]+)>?$/);
  if (match) {
    return { name: (match[1] || '').trim(), email: match[2].trim().toLowerCase() };
  }
  return { name: '', email: from.trim().toLowerCase() };
}

function extractBody(payload) {
  let plain = '';
  let html = '';

  if (payload.mimeType === 'text/plain') {
    plain = decodeBase64(payload.body?.data || '');
  } else if (payload.mimeType === 'text/html') {
    html = decodeBase64(payload.body?.data || '');
  } else if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain') {
        plain = decodeBase64(part.body?.data || '');
      } else if (part.mimeType === 'text/html') {
        html = decodeBase64(part.body?.data || '');
      } else if (part.parts) {
        // Nested multipart
        const nested = extractBody(part);
        plain = plain || nested.plain;
        html = html || nested.html;
      }
    }
  }

  return { plain: stripQuotedReplies(plain), html };
}

function decodeBase64(data) {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// Remove quoted reply content (lines starting with >, "On ... wrote:" blocks)
function stripQuotedReplies(text) {
  const lines = text.split('\n');
  const cleaned = [];
  for (const line of lines) {
    if (line.trimStart().startsWith('>')) continue;
    if (/^On .+wrote:$/.test(line.trim())) break; // stop at "On ... wrote:"
    cleaned.push(line);
  }
  return cleaned.join('\n').trim();
}

module.exports = { parseMessage };
