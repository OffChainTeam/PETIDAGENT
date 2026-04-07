/**
 * PETID Agent REST API
 * Exposes the agent capabilities as HTTP endpoints.
 * Also serves as webhook receiver for Telegram in production.
 */
const express = require('express');
const cors = require('cors');

function createApiServer(agent, telegramProxy, openclawAdapter, blockchain, discordProxy) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50kb' }));
  app.disable('x-powered-by');

  // ── Health ──────────────────────────────────────────────
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'petid-agent',
      version: '2.0.0',
      network: 'zkTanenbaum (zkSYS Testnet)',
      chainId: 57057,
      blockchain: blockchain ? blockchain.isConnected() : false,
      discord: discordProxy ? discordProxy.isReady() : false,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Agent Status ────────────────────────────────────────
  app.get('/agent/status', (req, res) => {
    res.json(agent.getStatus());
  });

  // ── Chat (proxy to agent) ───────────────────────────────
  app.post('/agent/message', async (req, res) => {
    const { message, userId } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    try {
      const reply = await agent.processMessage(message, userId || 'api-user');
      res.json({ reply, userId: userId || 'api-user', timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Report Lost Pet ─────────────────────────────────────
  app.post('/agent/report', async (req, res) => {
    const { name, species, breed, color, lastSeen, location, ownerContact, reward } = req.body;
    if (!name || !location || !ownerContact) {
      return res.status(400).json({ error: 'name, location and ownerContact are required' });
    }

    try {
      const report = await agent.reportLostPet({ name, species, breed, color, lastSeen, location, ownerContact, reward });
      const published = await agent.publishToChannels(report);
      res.json({ success: true, report, published });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Generate Alert ──────────────────────────────────────
  app.post('/agent/alert', async (req, res) => {
    const petData = req.body;
    if (!petData.name || !petData.location) {
      return res.status(400).json({ error: 'name and location are required' });
    }

    try {
      const alert = await agent.generateAlert(petData);
      res.json({ alert, petData, timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Search Groups ───────────────────────────────────────
  app.get('/agent/groups', async (req, res) => {
    const { query, limit } = req.query;
    try {
      if (query) {
        const result = await agent.searchPetGroups(query);
        res.json(result);
      } else {
        const groups = agent.indexer.getTopGroups(parseInt(limit) || 10);
        const stats = agent.indexer.getStats();
        res.json({ groups, stats });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Add Group to Index ──────────────────────────────────
  app.post('/agent/groups', (req, res) => {
    const { name, platform, location, members, activity, relevance, url, tags } = req.body;
    if (!name || !platform || !location) {
      return res.status(400).json({ error: 'name, platform and location are required' });
    }

    const result = agent.indexer.addGroup({ name, platform, location, members: members || 0, activity: activity || 50, relevance: relevance || 50, url: url || '', tags: tags || [] });
    res.json(result);
  });

  // ── OpenClaw Endpoints ──────────────────────────────────
  app.get('/openclaw/manifest', (req, res) => {
    res.json(openclawAdapter.getManifest());
  });

  app.get('/openclaw/status', (req, res) => {
    res.json(openclawAdapter.reportStatus());
  });

  app.post('/openclaw/execute', async (req, res) => {
    const { taskId, input } = req.body;
    if (!taskId) return res.status(400).json({ error: 'taskId is required' });

    try {
      const result = await openclawAdapter.executeTask(taskId, input || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Telegram Webhook (production) ──────────────────────
  app.post('/telegram/webhook', (req, res) => {
    res.sendStatus(200);
    if (telegramProxy) {
      telegramProxy.processWebhookUpdate(req.body);
    }
  });

  // ── Blockchain Endpoints ──────────────────────────────
  app.get('/chain/stats', async (req, res) => {
    if (!blockchain || !blockchain.isConnected()) {
      return res.json({ connected: false, message: 'Blockchain not connected' });
    }
    try {
      const stats = await blockchain.getOnChainStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/chain/pet/:petId', async (req, res) => {
    if (!blockchain || !blockchain.isConnected()) {
      return res.json({ connected: false, message: 'Blockchain not connected' });
    }
    try {
      const pet = await blockchain.getPet(parseInt(req.params.petId));
      res.json(pet);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/chain/lost', async (req, res) => {
    if (!blockchain || !blockchain.isConnected()) {
      return res.json({ connected: false, message: 'Blockchain not connected' });
    }
    try {
      const lost = await blockchain.getLostPets(parseInt(req.query.limit) || 50);
      res.json(lost);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/chain/info', (req, res) => {
    res.json(blockchain ? blockchain.getInfo() : { connected: false });
  });

  // ── Business Model / Tokenomics ─────────────────────────
  app.get('/tokenomics', (req, res) => {
    res.json({
      token: 'PET',
      chain: 'zkTanenbaum (zkSYS Testnet)',
      chainId: 57057,
      explorer: 'https://explorer-zk.tanenbaum.io',
      contractAddress: process.env.CONTRACT_ADDRESS || '0x7Ff5e0f9c8bb86422D5d1a6560b8cD67e8d99289',
      revenueModel: {
        lostPetAlert: { priceUSD: 2.99, description: 'Priority alert published to top 50 groups' },
        premiumSearch: { priceUSD: 0.99, description: 'AI-powered search with matching score' },
        shelterPartnership: { priceMonthlyUSD: 49, description: 'Shelter dashboard + unlimited alerts' },
        agentSubscription: { priceMonthlyUSD: 9.99, description: 'Personal PETID agent for your pets' },
      },
      tokenomics: {
        revenueShareToPetHolders: '5%',
        burnMechanism: '2% of each transaction burned',
        emission: 'Inflationary — 1M PET/month for community rewards',
        rewardPool: '10% of revenue to pet finders',
        ecosystemFund: '20% for shelter partnerships and expansion',
      },
      projections: {
        year1: { users: 50000, revenueUSD: 180000, petHolderShareUSD: 9000 },
        year2: { users: 250000, revenueUSD: 900000, petHolderShareUSD: 45000 },
        year3: { users: 1000000, revenueUSD: 3600000, petHolderShareUSD: 180000 },
      },
      socialImpact: {
        targetRecoveryRate: '70%',
        currentRateWithoutPetID: '10%',
        petsLostAnnuallyPeru: 1000000,
        estimatedPetsSaved: '350,000/year at full scale',
      },
    });
  });

  return app;
}

module.exports = { createApiServer };
