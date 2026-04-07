const express = require('express');
const router = express.Router();

// GET /api/pets - Todas las mascotas (con paginación)
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const result = req.indexer.getAllPets({ page, limit });
  res.json({ success: true, ...result });
});

// GET /api/pets/lost - Mascotas perdidas (on-chain + off-chain, con paginación y filtros)
router.get('/lost', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const zone = req.query.zone || undefined;
  const result = req.indexer.getLostPets({ page, limit, zone });
  res.json({ success: true, ...result });
});

// GET /api/pets/found - Mascotas encontradas (on-chain + off-chain, con paginación y filtros)
router.get('/found', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const zone = req.query.zone || undefined;
  const result = req.indexer.getFoundPets({ page, limit, zone });
  res.json({ success: true, ...result });
});

// GET /api/pets/owner/:address - Mascotas por dueño (on-chain NFT owner)
router.get('/owner/:address', (req, res) => {
  const address = req.params.address;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ success: false, error: 'Direccion Ethereum invalida' });
  }
  const pets = req.indexer.getPetsByOwner(address);
  res.json({ success: true, data: pets, total: pets.length });
});

// GET /api/pets/:id - Mascota por ID (on-chain)
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) {
    return res.status(400).json({ success: false, error: 'ID debe ser un numero positivo' });
  }
  const pet = req.indexer.getPet(id);
  if (!pet) return res.status(404).json({ success: false, error: 'Mascota no encontrada' });
  res.json({ success: true, data: pet });
});

module.exports = router;
