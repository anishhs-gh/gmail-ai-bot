'use strict';

const { parseMessage } = require('../services/emailParser');

function b64url(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function buildMessage(overrides = {}) {
  return {
    id: 'msg123',
    threadId: 'thread456',
    labelIds: ['INBOX', 'UNREAD'],
    internalDate: '1700000000000',
    payload: {
      headers: [
        { name: 'From', value: 'John Doe <john@example.com>' },
        { name: 'Subject', value: 'Test email' },
        { name: 'Message-ID', value: '<msg-id@example.com>' },
      ],
      mimeType: 'text/plain',
      body: { data: b64url('Hello, world!') },
    },
    ...overrides,
  };
}

describe('emailParser.parseMessage', () => {
  describe('basic fields', () => {
    it('parses message id, thread id, and labels', () => {
      const result = parseMessage(buildMessage());
      expect(result.messageId).toBe('msg123');
      expect(result.threadId).toBe('thread456');
      expect(result.labelIds).toEqual(['INBOX', 'UNREAD']);
    });

    it('parses timestamp from internalDate', () => {
      const result = parseMessage(buildMessage());
      expect(result.timestamp).toEqual(new Date(1700000000000));
    });

    it('falls back to current time when internalDate is missing', () => {
      const before = Date.now();
      const result = parseMessage(buildMessage({ internalDate: undefined }));
      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('parses message-id header', () => {
      const result = parseMessage(buildMessage());
      expect(result.messageIdHeader).toBe('<msg-id@example.com>');
    });

    it('defaults subject to (no subject) when missing', () => {
      const msg = buildMessage();
      msg.payload.headers = [{ name: 'From', value: 'a@b.com' }];
      expect(parseMessage(msg).subject).toBe('(no subject)');
    });
  });

  describe('sender parsing', () => {
    it('parses display name and email', () => {
      const result = parseMessage(buildMessage());
      expect(result.sender.name).toBe('John Doe');
      expect(result.sender.email).toBe('john@example.com');
    });

    it('parses sender with no display name', () => {
      const msg = buildMessage();
      msg.payload.headers = [
        { name: 'From', value: '<plain@example.com>' },
        { name: 'Subject', value: 'Hi' },
      ];
      const result = parseMessage(msg);
      expect(result.sender.email).toBe('plain@example.com');
      expect(result.sender.name).toBe('');
    });

    it('normalises sender email to lowercase', () => {
      const msg = buildMessage();
      msg.payload.headers = [
        { name: 'From', value: 'User <User@Example.COM>' },
        { name: 'Subject', value: 'Hi' },
      ];
      expect(parseMessage(msg).sender.email).toBe('user@example.com');
    });

    it('parses quoted display name', () => {
      const msg = buildMessage();
      msg.payload.headers = [
        { name: 'From', value: '"Jane Smith" <jane@example.com>' },
        { name: 'Subject', value: 'Hi' },
      ];
      expect(parseMessage(msg).sender.name).toBe('Jane Smith');
    });
  });

  describe('body extraction', () => {
    it('decodes a plain text body', () => {
      const result = parseMessage(buildMessage());
      expect(result.body.plain).toBe('Hello, world!');
      expect(result.body.html).toBe('');
    });

    it('decodes an html body', () => {
      const msg = buildMessage();
      msg.payload.mimeType = 'text/html';
      msg.payload.body = { data: b64url('<p>HTML</p>') };
      const result = parseMessage(msg);
      expect(result.body.html).toBe('<p>HTML</p>');
      expect(result.body.plain).toBe('');
    });

    it('extracts both parts from multipart/alternative', () => {
      const msg = buildMessage();
      msg.payload = {
        headers: msg.payload.headers,
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: b64url('Plain text') } },
          { mimeType: 'text/html', body: { data: b64url('<p>HTML</p>') } },
        ],
      };
      const result = parseMessage(msg);
      expect(result.body.plain).toBe('Plain text');
      expect(result.body.html).toBe('<p>HTML</p>');
    });

    it('handles base64url encoded data (- and _ chars)', () => {
      // base64url uses - and _ instead of + and /
      const text = 'Hello+World/Test';
      const msg = buildMessage();
      msg.payload.body = { data: b64url(text) };
      expect(parseMessage(msg).body.plain).toBe(text);
    });
  });

  describe('quoted reply stripping', () => {
    it('removes lines starting with >', () => {
      const body = 'New content\n> Quoted line\n> Another quoted';
      const msg = buildMessage();
      msg.payload.body = { data: b64url(body) };
      const result = parseMessage(msg).body.plain;
      expect(result).toContain('New content');
      expect(result).not.toContain('> Quoted');
    });

    it('stops at "On ... wrote:" line', () => {
      const body = 'New reply\nOn Mon, Jan 1 2024, John wrote:\nOriginal message';
      const msg = buildMessage();
      msg.payload.body = { data: b64url(body) };
      expect(parseMessage(msg).body.plain).toBe('New reply');
    });

    it('keeps content before quoted block', () => {
      const body = 'My reply here\n> old stuff';
      const msg = buildMessage();
      msg.payload.body = { data: b64url(body) };
      expect(parseMessage(msg).body.plain).toBe('My reply here');
    });
  });

  describe('reply headers', () => {
    it('parses In-Reply-To and References headers', () => {
      const msg = buildMessage();
      msg.payload.headers.push({ name: 'In-Reply-To', value: '<prev@example.com>' });
      msg.payload.headers.push({ name: 'References', value: '<ref1@example.com>' });
      const result = parseMessage(msg);
      expect(result.inReplyTo).toBe('<prev@example.com>');
      expect(result.references).toBe('<ref1@example.com>');
    });

    it('returns null for missing reply headers', () => {
      const result = parseMessage(buildMessage());
      expect(result.inReplyTo).toBeNull();
      expect(result.references).toBeNull();
    });
  });
});
