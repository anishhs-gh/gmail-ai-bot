'use strict';

const express = require('express');
const { validateApiKey } = require('../middleware/authMiddleware');
const configService = require('../services/configService');
const gmailService = require('../services/gmailService');
const logger = require('../utils/logger');

const router = express.Router();

// All config routes require auth
router.use(validateApiKey);

// GET /api/v1/config
router.get('/config', async (req, res) => {
  try {
    const config = await configService.getConfig();
    res.json({ ok: true, config });
  } catch (err) {
    logger.error('GET /config failed', err);
    res.status(500).json({ error: 'Failed to load config' });
  }
});

// PATCH /api/v1/config
router.patch('/config', async (req, res) => {
  try {
    await configService.updateConfig(req.body);
    const config = await configService.getConfig();
    res.json({ ok: true, config });
  } catch (err) {
    logger.error('PATCH /config failed', err);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/v1/config/blacklist/email
router.post('/config/blacklist/email', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });
  try {
    await configService.addToList('blacklistedEmails', email.toLowerCase());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/v1/config/blacklist/email/:email
router.delete('/config/blacklist/email/:email', async (req, res) => {
  try {
    await configService.removeFromList('blacklistedEmails', req.params.email.toLowerCase());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/config/blacklist/domain
router.post('/config/blacklist/domain', async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'Invalid domain' });
  try {
    await configService.addToList('blacklistedDomains', domain.toLowerCase());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/v1/config/blacklist/domain/:domain
router.delete('/config/blacklist/domain/:domain', async (req, res) => {
  try {
    await configService.removeFromList('blacklistedDomains', req.params.domain.toLowerCase());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/config/whitelist
router.post('/config/whitelist', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });
  try {
    await configService.addToList('whitelistedEmails', email.toLowerCase());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/v1/config/whitelist/:email
router.delete('/config/whitelist/:email', async (req, res) => {
  try {
    await configService.removeFromList('whitelistedEmails', req.params.email.toLowerCase());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/config/pattern/add
router.post('/config/pattern/add', async (req, res) => {
  const { field, pattern } = req.body;
  const allowed = ['ignoreSubjectPatterns', 'ignoreBodyPatterns'];
  if (!allowed.includes(field)) return res.status(400).json({ error: `field must be one of: ${allowed.join(', ')}` });
  if (!pattern) return res.status(400).json({ error: 'pattern required' });
  try {
    await configService.addToList(field, pattern);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/config/pattern/remove
router.post('/config/pattern/remove', async (req, res) => {
  const { field, pattern } = req.body;
  const allowed = ['ignoreSubjectPatterns', 'ignoreBodyPatterns'];
  if (!allowed.includes(field)) return res.status(400).json({ error: `field must be one of: ${allowed.join(', ')}` });
  try {
    await configService.removeFromList(field, pattern);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/gmail/refresh-watch  (also called by Cloud Scheduler)
router.post('/gmail/refresh-watch', async (req, res) => {
  try {
    const result = await gmailService.setupWatch();
    logger.info('Gmail watch refreshed via API');
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('Failed to refresh Gmail watch', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/status
router.get('/status', async (req, res) => {
  try {
    const config = await configService.getConfig();
    res.json({
      ok: true,
      active: config.active,
      replyEnabled: config.replyEnabled,
      blacklistedEmailsCount: config.blacklistedEmails.length,
      blacklistedDomainsCount: config.blacklistedDomains.length,
      whitelistedEmailsCount: config.whitelistedEmails.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
