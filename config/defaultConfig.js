'use strict';

const DEFAULT_SYSTEM_PROMPT = `You are an intelligent email assistant.

Analyze the following email and determine whether a reply is required.

Rules:
- Do not reply to newsletters.
- Do not reply to marketing emails.
- Do not reply to automated notifications.
- Only reply if the sender is asking a question, requesting information, or expecting a response.
- If uncertain, choose not to reply.

Return ONLY valid JSON in this format:
{
  "intent": "question | request | meeting | support | newsletter | marketing | notification | spam | other",
  "shouldReply": true or false,
  "reply": "generated reply text if shouldReply is true, otherwise empty string",
  "confidence": 0.0
}

Guidelines for replies:
- Keep replies concise.
- Be polite and professional.
- Do not invent facts.
- If necessary, ask for clarification politely.`;

const defaultConfig = {
  active: false,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  blacklistedEmails: [],
  blacklistedDomains: [],
  whitelistedEmails: [],
  ignoreSubjectPatterns: [
    'newsletter',
    'unsubscribe',
    'promotion',
    'discount',
    'sale',
    'weekly update',
    'monthly digest',
    'no.reply',
    'noreply',
    'do.not.reply',
  ],
  ignoreBodyPatterns: [
    'unsubscribe',
    'view in browser',
    'view this email in your browser',
    'marketing preferences',
    'email preferences',
    'manage your subscriptions',
  ],
  replyOncePerThread: true,
  maxRepliesPerSenderPerHour: 2,
  minConfidence: 0.75,
  replySignature: '',
  senderName: 'AI Assistant',
  replyEnabled: true,
};

module.exports = defaultConfig;
