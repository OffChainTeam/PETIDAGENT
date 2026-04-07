require('dotenv').config();
const { PetIDAgent } = require('./agent');
const { TelegramProxy } = require('./proxy');
const { DiscordProxy } = require('./discordProxy');
const { createApiServer } = require('./api');
const { OpenClawAdapter } = require('./openclawAdapter');
const { SuperDappConnector } = require('./superdapp');
const { BlockchainConnector } = require('./blockchain');

const PORT = process.env.PORT || 3002;

async function bootstrap() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║         🐾  PETID Agent v2.0.0  🐾           ║');
  console.log('║   Autonomous Pet Recovery AI Agent            ║');
  console.log('║   zkTanenbaum (zkSYS Testnet) — Chain 57057  ║');
  console.log('║   Hackathon Syscoin PoB IV — Final Demo       ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // 1. Connect to blockchain (zkTanenbaum)
  console.log('[Boot] Connecting to zkTanenbaum (zkSYS Testnet)...');
  const blockchain = new BlockchainConnector();
  await blockchain.connect();

  // 2. Initialize core agent with blockchain
  console.log('[Boot] Initializing PETID AI Agent (Cerebras)...');
  const agent = new PetIDAgent(blockchain);

  // 3. Initialize OpenClaw adapter
  console.log('[Boot] Initializing OpenClaw adapter...');
  const openclawAdapter = new OpenClawAdapter(agent);
  await openclawAdapter.registerAgent();

  // 4. Connect to SuperDapp
  console.log('[Boot] Connecting to SuperDapp Syscoin...');
  const superdapp = new SuperDappConnector();
  await superdapp.connectToSuperDapp();

  // 5. Initialize Telegram proxy
  console.log('[Boot] Starting Telegram proxy bot...');
  const telegramProxy = new TelegramProxy(agent);
  telegramProxy.start();

  // 5.1 Connect Telegram bot to agent for real group publishing
  if (telegramProxy.bot) {
    agent.telegramBot = telegramProxy.bot;
    console.log(`[Boot] Telegram group publishing: ${agent.telegramGroupIds.length > 0 ? agent.telegramGroupIds.length + ' groups configured' : 'No TELEGRAM_GROUP_IDS configured'}`);
  }

  // 6. Initialize Discord proxy (Syscoin official server)
  console.log('[Boot] Starting Discord proxy bot...');
  const discordProxy = new DiscordProxy(agent, blockchain);
  await discordProxy.start();

  // 7. Start REST API
  const app = createApiServer(agent, telegramProxy, openclawAdapter, blockchain, discordProxy);
  app.listen(PORT, () => {
    console.log('');
    console.log(`[API]  REST API running at http://localhost:${PORT}`);
    console.log(`[API]  Health:     GET  http://localhost:${PORT}/health`);
    console.log(`[API]  Chat:       POST http://localhost:${PORT}/agent/message`);
    console.log(`[API]  Report:     POST http://localhost:${PORT}/agent/report`);
    console.log(`[API]  Groups:     GET  http://localhost:${PORT}/agent/groups`);
    console.log(`[API]  Blockchain: GET  http://localhost:${PORT}/chain/stats`);
    console.log(`[API]  Tokenomics: GET  http://localhost:${PORT}/tokenomics`);
    console.log(`[API]  OpenClaw:   GET  http://localhost:${PORT}/openclaw/status`);
    console.log('');
    console.log(`[Bot]  Telegram: @petid_agent_bot`);
    console.log(`[Bot]  Discord:  ${discordProxy.isReady() ? '✅ Connected' : '⏳ Connecting...'}`);
    console.log(`[Net]  zkTanenbaum Chain ID: ${process.env.CHAIN_ID || 57057}`);
    console.log(`[Net]  Contract: ${process.env.CONTRACT_ADDRESS || '0x7Ff5e0f9c8bb86422D5d1a6560b8cD67e8d99289'}`);
    console.log(`[Net]  Explorer: ${process.env.EXPLORER_URL || 'https://explorer-zk.tanenbaum.io'}`);
    console.log('');
    console.log('✅ PETID Agent v2.0 is LIVE — Telegram + Discord + zkTanenbaum!');
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[Shutdown] PETID Agent shutting down gracefully...');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('[Shutdown] PETID Agent stopped.');
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    console.error('[Fatal] Uncaught exception:', err.message);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[Fatal] Unhandled rejection:', reason);
  });
}

bootstrap().catch((err) => {
  console.error('[Boot] Fatal error during startup:', err.message);
  console.error(err.stack);
  process.exit(1);
});
