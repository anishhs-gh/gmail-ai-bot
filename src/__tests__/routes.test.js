'use strict';

// Mock all external dependencies before requiring the app
jest.mock('../utils/secretManager', () => ({
  loadSecrets: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/firestoreClient', () => ({
  getFirestore: jest.fn(),
  COLLECTIONS: {
    config: 'system_config',
    replies: 'replied_threads',
    watchState: 'gmail_watch',
    senderRateLimits: 'sender_rate_limits',
  },
  writeWithRetry: jest.fn(),
}));

const mockGetStoredHistoryId = jest.fn().mockResolvedValue('100');
const mockUpdateStoredHistoryId = jest.fn().mockResolvedValue(undefined);
const mockFetchNewMessages = jest.fn().mockResolvedValue([]);
const mockSetupWatch = jest.fn().mockResolvedValue({ historyId: '100', expiration: '9999' });

jest.mock('../services/gmailService', () => ({
  setupWatch: (...args) => mockSetupWatch(...args),
  fetchNewMessages: (...args) => mockFetchNewMessages(...args),
  fetchMessage: jest.fn(),
  sendMessage: jest.fn(),
  getStoredHistoryId: (...args) => mockGetStoredHistoryId(...args),
  updateStoredHistoryId: (...args) => mockUpdateStoredHistoryId(...args),
}));

jest.mock('../services/configService', () => ({
  getConfig: jest.fn().mockResolvedValue({
    active: true,
    replyEnabled: true,
    blacklistedEmails: [],
    blacklistedDomains: [],
    whitelistedEmails: [],
    ignoreSubjectPatterns: [],
    ignoreBodyPatterns: [],
    replyOncePerThread: true,
    maxRepliesPerSenderPerHour: 2,
    minConfidence: 0.75,
  }),
}));

jest.mock('../services/filterEngine', () => ({
  shouldProcess: jest.fn().mockResolvedValue({ shouldProcess: false, reason: 'test' }),
}));

const request = require('supertest');
const app = require('../index');

beforeEach(() => {
  jest.clearAllMocks();
  // Ensure PUBSUB_AUDIENCE is unset so JWT validation is skipped
  delete process.env.PUBSUB_AUDIENCE;
});

describe('GET /health', () => {
  it('returns 200 with ok: true', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('POST /webhook', () => {
  const validPayload = {
    message: {
      data: Buffer.from(JSON.stringify({ emailAddress: 'bot@test.com', historyId: '12345' })).toString('base64'),
      messageId: 'pubsub-msg-1',
    },
  };

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).post('/webhook').send(validPayload);
    expect(res.status).toBe(401);
  });

  it('returns 200 immediately with a valid bearer token', async () => {
    const res = await request(app)
      .post('/webhook')
      .set('Authorization', 'Bearer any-token-when-no-audience')
      .send(validPayload);
    expect(res.status).toBe(200);
  });

  it('returns 200 even with no message data (graceful handling)', async () => {
    const res = await request(app)
      .post('/webhook')
      .set('Authorization', 'Bearer any-token')
      .send({ message: {} });
    expect(res.status).toBe(200);
  });

  it('returns 200 for empty body (no message field)', async () => {
    const res = await request(app)
      .post('/webhook')
      .set('Authorization', 'Bearer any-token')
      .send({});
    expect(res.status).toBe(200);
  });

  it('calls getStoredHistoryId when processing a valid notification', async () => {
    // Wait for async processing by checking the mock was called
    await request(app)
      .post('/webhook')
      .set('Authorization', 'Bearer any-token')
      .send(validPayload);

    // Give async processing a tick to run
    await new Promise(resolve => setImmediate(resolve));

    expect(mockGetStoredHistoryId).toHaveBeenCalledTimes(1);
  });
});

describe('unknown routes', () => {
  it('returns 404 for undefined routes', async () => {
    const res = await request(app).get('/nonexistent');
    expect(res.status).toBe(404);
  });
});
