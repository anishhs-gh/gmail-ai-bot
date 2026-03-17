'use strict';

let mockFirestore;

jest.mock('../utils/firestoreClient', () => ({
  getFirestore: () => mockFirestore,
  COLLECTIONS: {
    config: 'system_config',
    replies: 'replied_threads',
    watchState: 'gmail_watch',
    senderRateLimits: 'sender_rate_limits',
  },
}));

const { shouldProcess } = require('../services/filterEngine');

function makeFirestoreMock({ threadExists = false, rateLimitSize = 0 } = {}) {
  const whereChain = {
    where: jest.fn(),
    get: jest.fn().mockResolvedValue({ size: rateLimitSize }),
  };
  whereChain.where.mockReturnValue(whereChain);

  return {
    collection: jest.fn((name) => {
      if (name === 'replied_threads') {
        return {
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ exists: threadExists }),
          })),
        };
      }
      // sender_rate_limits
      return { where: jest.fn().mockReturnValue(whereChain) };
    }),
  };
}

const baseEmail = {
  sender: { email: 'sender@example.com', name: 'Sender' },
  subject: 'Hello there',
  body: { plain: 'Can you help me with something?' },
  headers: new Map(),
  threadId: 'thread123',
};

const baseConfig = {
  active: true,
  replyEnabled: true,
  blacklistedEmails: [],
  blacklistedDomains: [],
  whitelistedEmails: [],
  ignoreSubjectPatterns: [],
  ignoreBodyPatterns: [],
  replyOncePerThread: true,
  maxRepliesPerSenderPerHour: 2,
};

beforeEach(() => {
  process.env.GMAIL_USER_EMAIL = 'bot@example.com';
  mockFirestore = makeFirestoreMock();
});

afterEach(() => {
  delete process.env.GMAIL_USER_EMAIL;
});

describe('filterEngine.shouldProcess', () => {
  describe('passes', () => {
    it('passes a legitimate email through all filters', async () => {
      const result = await shouldProcess(baseEmail, baseConfig);
      expect(result.shouldProcess).toBe(true);
      expect(result.reason).toBe('passed-all-filters');
    });

    it('allows auto-submitted: no', async () => {
      const email = { ...baseEmail, headers: new Map([['auto-submitted', 'no']]) };
      const result = await shouldProcess(email, baseConfig);
      expect(result.shouldProcess).toBe(true);
    });

    it('allows sender on whitelist', async () => {
      const config = { ...baseConfig, whitelistedEmails: ['sender@example.com'] };
      const result = await shouldProcess(baseEmail, config);
      expect(result.shouldProcess).toBe(true);
    });
  });

  describe('loop prevention', () => {
    it('blocks self-send', async () => {
      const email = { ...baseEmail, sender: { email: 'bot@example.com', name: 'Bot' } };
      const result = await shouldProcess(email, baseConfig);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('self-send');
    });

    it('blocks auto-submitted header', async () => {
      const email = { ...baseEmail, headers: new Map([['auto-submitted', 'auto-replied']]) };
      const result = await shouldProcess(email, baseConfig);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('automated-header:auto-submitted');
    });

    it('blocks list-id header', async () => {
      const email = { ...baseEmail, headers: new Map([['list-id', '<list.example.com>']]) };
      const result = await shouldProcess(email, baseConfig);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('automated-header:list-id');
    });

    it('blocks list-unsubscribe header', async () => {
      const email = { ...baseEmail, headers: new Map([['list-unsubscribe', '<https://example.com>']]) };
      const result = await shouldProcess(email, baseConfig);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('automated-header:list-unsubscribe');
    });

    it('blocks bulk precedence', async () => {
      const email = { ...baseEmail, headers: new Map([['precedence', 'bulk']]) };
      const result = await shouldProcess(email, baseConfig);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('bulk-precedence');
    });

    it('blocks list precedence', async () => {
      const email = { ...baseEmail, headers: new Map([['precedence', 'list']]) };
      const result = await shouldProcess(email, baseConfig);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('bulk-precedence');
    });
  });

  describe('global kill switch', () => {
    it('blocks when active is false', async () => {
      const result = await shouldProcess(baseEmail, { ...baseConfig, active: false });
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('bot-inactive');
    });

    it('blocks when replyEnabled is false', async () => {
      const result = await shouldProcess(baseEmail, { ...baseConfig, replyEnabled: false });
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('bot-inactive');
    });
  });

  describe('blacklist', () => {
    it('blocks blacklisted email', async () => {
      const config = { ...baseConfig, blacklistedEmails: ['sender@example.com'] };
      const result = await shouldProcess(baseEmail, config);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('blacklisted-email');
    });

    it('blocks exact domain match', async () => {
      const config = { ...baseConfig, blacklistedDomains: ['example.com'] };
      const result = await shouldProcess(baseEmail, config);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('blacklisted-domain');
    });

    it('blocks subdomain of blacklisted domain', async () => {
      const email = { ...baseEmail, sender: { email: 'user@sub.example.com', name: 'User' } };
      const config = { ...baseConfig, blacklistedDomains: ['example.com'] };
      const result = await shouldProcess(email, config);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('blacklisted-domain');
    });

    it('does not block unrelated domain', async () => {
      const config = { ...baseConfig, blacklistedDomains: ['other.com'] };
      const result = await shouldProcess(baseEmail, config);
      expect(result.shouldProcess).toBe(true);
    });
  });

  describe('whitelist', () => {
    it('blocks non-whitelisted sender when whitelist is non-empty', async () => {
      const config = { ...baseConfig, whitelistedEmails: ['other@example.com'] };
      const result = await shouldProcess(baseEmail, config);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('not-whitelisted');
    });

    it('does not apply whitelist when empty', async () => {
      const config = { ...baseConfig, whitelistedEmails: [] };
      const result = await shouldProcess(baseEmail, config);
      expect(result.shouldProcess).toBe(true);
    });
  });

  describe('pattern filters', () => {
    it('blocks matching subject pattern (case-insensitive)', async () => {
      const config = { ...baseConfig, ignoreSubjectPatterns: ['newsletter'] };
      const email = { ...baseEmail, subject: 'Weekly Newsletter' };
      const result = await shouldProcess(email, config);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toContain('subject-pattern');
    });

    it('blocks matching body pattern', async () => {
      const config = { ...baseConfig, ignoreBodyPatterns: ['unsubscribe'] };
      const email = { ...baseEmail, body: { plain: 'Click to unsubscribe here.' } };
      const result = await shouldProcess(email, config);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toContain('body-pattern');
    });

    it('does not block non-matching subject', async () => {
      const config = { ...baseConfig, ignoreSubjectPatterns: ['newsletter'] };
      const result = await shouldProcess(baseEmail, config);
      expect(result.shouldProcess).toBe(true);
    });
  });

  describe('deduplication and rate limiting', () => {
    it('blocks already-replied thread', async () => {
      mockFirestore = makeFirestoreMock({ threadExists: true });
      const result = await shouldProcess(baseEmail, baseConfig);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('already-replied-to-thread');
    });

    it('skips thread check when replyOncePerThread is false', async () => {
      mockFirestore = makeFirestoreMock({ threadExists: true, rateLimitSize: 0 });
      const config = { ...baseConfig, replyOncePerThread: false };
      const result = await shouldProcess(baseEmail, config);
      expect(result.shouldProcess).toBe(true);
    });

    it('blocks rate-limited sender', async () => {
      mockFirestore = makeFirestoreMock({ threadExists: false, rateLimitSize: 2 });
      const result = await shouldProcess(baseEmail, baseConfig);
      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('sender-rate-limit');
    });

    it('allows sender below rate limit', async () => {
      mockFirestore = makeFirestoreMock({ threadExists: false, rateLimitSize: 1 });
      const result = await shouldProcess(baseEmail, baseConfig);
      expect(result.shouldProcess).toBe(true);
    });
  });
});
