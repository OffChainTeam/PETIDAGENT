require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Indexer } = require('./indexer');
const { rateLimit, securityHeaders, errorHandler } = require('./middleware/security');
const petsRouter = require('./routes/pets');
const reportsRouter = require('./routes/reports');
const paymentsRouter = require('./routes/payments');
const communityRouter = require('./routes/community');
const faucetRouter = require('./routes/faucet');

const app = express();
const PORT = process.env.PORT || 3001;

// Seguridad: headers y rate limiting
app.use(securityHeaders);
app.use(rateLimit(60000, 100));
app.disable('x-powered-by');

// CORS - dinámico para dev y producción
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3000',
];
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}
app.use(cors({
  origin: function (origin, callback) {
    // Permitir requests sin origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // En desarrollo, permitir cualquier localhost/127.0.0.1
    if (origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)) {
      return callback(null, true);
    }
    // En producción, permitir dominios de Render (.onrender.com)
    if (origin.match(/\.onrender\.com$/)) {
      return callback(null, true);
    }
    callback(null, true); // Permitir todo por ahora (hackathon)
  },
  credentials: true,
}));
app.use(express.json({ limit: '10kb' }));

// Arranque async: primero inicializa la BD, luego arranca el servidor
async function bootstrap() {
  const indexer = new Indexer();

  // Inicializar Supabase antes de aceptar requests
  await indexer.offChain.init();

  // Iniciar indexador blockchain
  indexer.start();

  // Inyectar indexador en las rutas
  app.use((req, res, next) => {
    req.indexer = indexer;
    next();
  });

  // Rutas
  app.use('/api/pets', petsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/community', communityRouter);
  app.use('/api/faucet', faucetRouter);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      version: '1.0.0',
      network: process.env.CHAIN_ID || '5700',
      contract: process.env.CONTRACT_ADDRESS || '',
      indexedPets: indexer.getPetsCount(),
      indexedReports: indexer.getReportsCount(),
      uptime: process.uptime(),
    });
  });

  // Estadísticas
  app.get('/api/stats', (req, res) => {
    const stats = indexer.getStats();
    res.json(stats);
  });

  // Error handler global (debe ir al final)
  app.use(errorHandler);

  app.listen(PORT, () => {
    console.log(`[PetID Backend] Servidor en http://localhost:${PORT}`);
    console.log(`[PetID Backend] Red: ${process.env.CHAIN_ID || '5700'}`);
    console.log(`[PetID Backend] Contrato: ${process.env.CONTRACT_ADDRESS || 'No configurado'}`);
  });
}

bootstrap().catch(err => {
  console.error('[PetID Backend] Error fatal al iniciar:', err.message);
  process.exit(1);
});
