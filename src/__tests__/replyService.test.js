'use strict';

const mockSet = jest.fn();
const mockCommit = jest.fn().mockResolvedValue(undefined);
const mockBatch = jest.fn(() => ({ set: mockSet, commit: mockCommit }));
const mockDoc = jest.fn(() => ({}));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));

jest.mock('../utils/firestoreClient', () => ({
  getFirestore: () => ({ batch: mockBatch, collection: mockCollection }),
  COLLECTIONS: {
    replies: 'replied_threads',
    senderRateLimits: 'sender_rate_limits',
  },
  writeWithRetry: jest.fn(),
}));

const mockSendMessage = jest.fn().mockResolvedValue({ id: 'sent-msg-123' });
jest.mock('../services/gmailService', () => ({
  sendMessage: (...args) => mockSendMessage(...args),
}));

const { sendReply } = require('../services/replyService');

const baseParsedEmail = {
  messageId: 'msg123',
  threadId: 'thread456',
  sender: { name: 'Alice', email: 'alice@example.com' },
  subject: 'Can you help?',
  messageIdHeader: '<original@example.com>',
  references: null,
};

const baseConfig = {
  senderName: 'AI Assistant',
  replySignature: '',
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GMAIL_USER_EMAIL = 'bot@example.com';
  mockSendMessage.mockResolvedValue({ id: 'sent-msg-123' });
  mockCommit.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.GMAIL_USER_EMAIL;
});

describe('replyService.sendReply', () => {
  describe('email composition', () => {
    it('calls sendMessage with a base64url encoded payload', async () => {
      await sendReply(baseParsedEmail, 'Hello back!', baseConfig, { intent: 'question', confidence: 0.9 });
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const [encoded, threadId] = mockSendMessage.mock.calls[0];
      expect(typeof encoded).toBe('string');
      expect(threadId).toBe('thread456');
      // Verify it's valid base64url
      const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
      expect(decoded).toContain('Hello back!');
    });

    it('includes Re: prefix in subject when not already present', async () => {
      await sendReply(baseParsedEmail, 'Reply text', baseConfig, { intent: 'question', confidence: 0.9 });
      const [encoded] = mockSendMessage.mock.calls[0];
      const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
      expect(decoded).toContain('Subject: Re: Can you help?');
    });

    it('does not double-prefix Re: in subject', async () => {
      const email = { ...baseParsedEmail, subject: 'Re: Can you help?' };
      await sendReply(email, 'Reply text', baseConfig, { intent: 'question', confidence: 0.9 });
      const [encoded] = mockSendMessage.mock.calls[0];
      const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
      expect(decoded).not.toContain('Re: Re:');
    });

    it('includes From and To headers', async () => {
      await sendReply(baseParsedEmail, 'Reply', baseConfig, { intent: 'question', confidence: 0.9 });
      const [encoded] = mockSendMessage.mock.calls[0];
      const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
      expect(decoded).toContain('From: AI Assistant <bot@example.com>');
      expect(decoded).toContain('To: Alice <alice@example.com>');
    });

    it('includes In-Reply-To header', async () => {
      await sendReply(baseParsedEmail, 'Reply', baseConfig, { intent: 'question', confidence: 0.9 });
      const [encoded] = mockSendMessage.mock.calls[0];
      const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
      expect(decoded).toContain('In-Reply-To: <original@example.com>');
    });

    it('appends signature when configured', async () => {
      const config = { ...baseConfig, replySignature: 'Sent by AI' };
      await sendReply(baseParsedEmail, 'Reply body', config, { intent: 'question', confidence: 0.9 });
      const [encoded] = mockSendMessage.mock.calls[0];
      const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
      expect(decoded).toContain('Sent by AI');
    });

    it('does not add signature delimiter when signature is empty', async () => {
      await sendReply(baseParsedEmail, 'Reply body', baseConfig, { intent: 'question', confidence: 0.9 });
      const [encoded] = mockSendMessage.mock.calls[0];
      const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
      expect(decoded).not.toContain('\n--\n');
    });
  });

  describe('firestore recording', () => {
    it('commits a batch with two records after sending', async () => {
      await sendReply(baseParsedEmail, 'Reply', baseConfig, { intent: 'question', confidence: 0.9 });
      expect(mockBatch).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledTimes(2);
      expect(mockCommit).toHaveBeenCalledTimes(1);
    });

    it('records correct thread data in replied_threads', async () => {
      await sendReply(baseParsedEmail, 'Reply', baseConfig, { intent: 'question', confidence: 0.9 });
      const firstSetCall = mockSet.mock.calls[0];
      const data = firstSetCall[1];
      expect(data.threadId).toBe('thread456');
      expect(data.sender).toBe('alice@example.com');
      expect(data.intent).toBe('question');
      expect(data.confidence).toBe(0.9);
      expect(data.sentMessageId).toBe('sent-msg-123');
    });

    it('records sender in rate-limit collection', async () => {
      await sendReply(baseParsedEmail, 'Reply', baseConfig, { intent: 'question', confidence: 0.9 });
      const secondSetCall = mockSet.mock.calls[1];
      const data = secondSetCall[1];
      expect(data.sender).toBe('alice@example.com');
      expect(data.threadId).toBe('thread456');
      expect(data.repliedAt).toBeInstanceOf(Date);
    });
  });

  describe('return value', () => {
    it('returns the sent message object', async () => {
      const result = await sendReply(baseParsedEmail, 'Reply', baseConfig, { intent: 'question', confidence: 0.9 });
      expect(result).toEqual({ id: 'sent-msg-123' });
    });
  });
});
