const express = require('express');
const { ReportType, ExtendedStatus } = require('../store/OffChainStore');
const router = express.Router();

// Sanitizar inputs
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'&]/g, c => ({
    '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;'
  }[c]));
}

// =========== ON-CHAIN REPORTS (sightings) ===========

// GET /api/reports - Todos los reportes on-chain
router.get('/', (req, res) => {
  const reports = req.indexer.getAllReports();
  res.json({ success: true, data: reports, total: reports.length });
});

// GET /api/reports/pet/:petId - Reportes on-chain de una mascota
router.get('/pet/:petId', (req, res) => {
  const petId = parseInt(req.params.petId);
  if (isNaN(petId) || petId < 1) {
    return res.status(400).json({ success: false, error: 'petId debe ser un numero positivo' });
  }
  const reports = req.indexer.getReportsForPet(petId);
  res.json({ success: true, data: reports, total: reports.length });
});

// =========== OFF-CHAIN REPORTS (lost/found sin apropiacion) ===========

// GET /api/reports/off-chain - Reportes off-chain con filtros
router.get('/off-chain', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const type = req.query.type || undefined;
    const zone = req.query.zone || undefined;
    const reporter = req.query.reporter || undefined;
    const parentReportId = req.query.parentReportId || undefined;
    const resolved = req.query.resolved !== undefined ? req.query.resolved === 'true' : undefined;

    const result = await req.indexer.offChain.getReports({ type, zone, reporter, parentReportId, resolved, page, limit });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/reports/stats?reporter=<addr> - Estadisticas para /profile
router.get('/stats', async (req, res) => {
  try {
    const reporter = (req.query.reporter || '').toLowerCase();
    if (!reporter) return res.json({ success: true, data: { reports: 0, sightings: 0, resolved: 0, points: 0 } });

    const all = await req.indexer.offChain.getReports({ reporter, limit: 1000 });
    const items = all.data || [];

    const reports = items.filter(r => r.type === 'LOST_REPORT' || r.type === 'FOUND_REPORT').length;
    const sightings = items.filter(r => r.type === 'SIGHTING' || r.type === 'SIGHTING_ABANDONED').length;
    const resolved = items.filter(r => r.resolved).length;

    // Puntos: +10 reporte con foto, +5 sin foto, +15 avistamiento con foto, +50 resuelto
    let points = 0;
    items.forEach(r => {
      if (r.resolved) { points += 50; return; }
      if (r.type === 'SIGHTING' || r.type === 'SIGHTING_ABANDONED') {
        points += r.photoUrl ? 15 : 5;
      } else if (r.type === 'LOST_REPORT' || r.type === 'FOUND_REPORT') {
        points += r.photoUrl ? 10 : 5;
      }
    });

    res.json({ success: true, data: { reports, sightings, resolved, points } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/reports/off-chain/:id - Reporte off-chain por ID
router.get('/off-chain/:id', async (req, res) => {
  try {
    const report = await req.indexer.offChain.getReport(req.params.id);
    if (!report) return res.status(404).json({ success: false, error: 'Reporte no encontrado' });

    const custody = await req.indexer.offChain.getCustody(req.params.id);
    res.json({ success: true, data: { ...report, custody } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/reports/lost - Reportar mascota perdida (OFF-CHAIN)
 */
router.post('/lost', async (req, res) => {
  const { reporter, petName, species, description, photoUrl, zone, contact, onChainPetId, metadata, txHash } = req.body;

  if (!description || !description.trim()) {
    return res.status(400).json({ success: false, error: 'Descripcion es requerida' });
  }
  if (!zone || !zone.trim()) {
    return res.status(400).json({ success: false, error: 'Zona es requerida' });
  }

  try {
    const report = await req.indexer.offChain.createReport({
      type: ReportType.LOST_REPORT,
      reporter: reporter || null,
      petName: sanitize(petName || ''),
      species: sanitize(species || ''),
      description: sanitize(description),
      photoUrl: sanitize(photoUrl || ''),
      zone: sanitize(zone),
      contact: sanitize(contact || ''),
      onChainPetId: onChainPetId ? parseInt(onChainPetId) : null,
      hasPet: false,
      metadata: metadata || {},
      txHash: txHash ? sanitize(txHash) : null,
    });

    res.status(201).json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/reports/found - Reportar mascota encontrada (OFF-CHAIN)
 */
router.post('/found', async (req, res) => {
  const { reporter, petName, species, description, photoUrl, zone, contact, hasPet, onChainPetId, metadata, txHash } = req.body;

  if (!description || !description.trim()) {
    return res.status(400).json({ success: false, error: 'Descripcion es requerida' });
  }
  if (!zone || !zone.trim()) {
    return res.status(400).json({ success: false, error: 'Zona es requerida' });
  }

  try {
    const report = await req.indexer.offChain.createReport({
      type: ReportType.FOUND_REPORT,
      reporter: reporter || null,
      petName: sanitize(petName || ''),
      species: sanitize(species || ''),
      description: sanitize(description),
      photoUrl: sanitize(photoUrl || ''),
      zone: sanitize(zone),
      contact: sanitize(contact || ''),
      onChainPetId: onChainPetId ? parseInt(onChainPetId) : null,
      hasPet: hasPet === true,
      metadata: metadata || {},
      txHash: txHash ? sanitize(txHash) : null,
    });

    res.status(201).json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/reports/sighting - Reportar avistamiento (OFF-CHAIN)
 */
router.post('/sighting', async (req, res) => {
  const { reporter, petName, species, description, photoUrl, zone, contact, onChainPetId, parentReportId, metadata, txHash } = req.body;

  if (!zone || !zone.trim()) {
    return res.status(400).json({ success: false, error: 'Zona es requerida' });
  }

  try {
    const report = await req.indexer.offChain.createReport({
      type: ReportType.SIGHTING,
      reporter: reporter || null,
      petName: sanitize(petName || ''),
      species: sanitize(species || ''),
      description: sanitize(description || ''),
      photoUrl: sanitize(photoUrl || ''),
      zone: sanitize(zone),
      contact: sanitize(contact || ''),
      onChainPetId: onChainPetId ? parseInt(onChainPetId) : null,
      parentReportId: parentReportId ? sanitize(parentReportId) : null,
      hasPet: false,
      metadata: metadata || {},
      txHash: txHash ? sanitize(txHash) : null,
    });

    res.status(201).json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/reports/sighting-abandoned - Reportar mascota abandonada (OFF-CHAIN)
 */
router.post('/sighting-abandoned', async (req, res) => {
  const { reporter, petName, species, description, photoUrl, zone, contact, metadata, txHash } = req.body;

  if (!zone || !zone.trim()) {
    return res.status(400).json({ success: false, error: 'Zona es requerida' });
  }
  if (!description || !description.trim()) {
    return res.status(400).json({ success: false, error: 'Descripcion es requerida' });
  }

  try {
    const report = await req.indexer.offChain.createReport({
      type: ReportType.SIGHTING_ABANDONED,
      reporter: reporter || null,
      petName: sanitize(petName || ''),
      species: sanitize(species || ''),
      description: sanitize(description),
      photoUrl: sanitize(photoUrl || ''),
      zone: sanitize(zone),
      contact: sanitize(contact || ''),
      onChainPetId: null,
      parentReportId: null,
      hasPet: false,
      metadata: metadata || {},
      txHash: txHash ? sanitize(txHash) : null,
    });

    res.status(201).json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/reports/resolve-by-pet/:petId - Resolver todos los reportes off-chain de una mascota
 * Se llama cuando el owner desactiva el modo perdido (pet vuelve a SAFE)
 */
router.post('/resolve-by-pet/:petId', async (req, res) => {
  const petId = parseInt(req.params.petId);
  if (isNaN(petId) || petId < 1) {
    return res.status(400).json({ success: false, error: 'petId debe ser un numero positivo' });
  }
  const { resolvedBy } = req.body;
  try {
    const allReports = await req.indexer.offChain.getReports({
      page: 1, limit: 100,
    });
    const toResolve = allReports.data.filter(
      r => r.onChainPetId === petId && !r.resolved
    );
    const resolved = [];
    for (const r of toResolve) {
      try {
        const result = await req.indexer.offChain.resolveReport(
          r.id, resolvedBy || null, ExtendedStatus.RECLAIMED
        );
        resolved.push(result);
      } catch {}
    }
    res.json({ success: true, resolved: resolved.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/reports/:id/transfer-custody - Transferir custodia
 */
router.post('/:id/transfer-custody', async (req, res) => {
  const { currentCustodian, newCustodian, reason } = req.body;

  if (!currentCustodian || !newCustodian) {
    return res.status(400).json({ success: false, error: 'currentCustodian y newCustodian son requeridos' });
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(newCustodian)) {
    return res.status(400).json({ success: false, error: 'newCustodian debe ser una direccion Ethereum valida' });
  }

  try {
    const custody = await req.indexer.offChain.transferCustody(
      req.params.id,
      currentCustodian,
      newCustodian,
      sanitize(reason || 'TRANSFER')
    );
    res.json({ success: true, data: custody });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/reports/:id/resolve - Resolver/cerrar un reporte
 */
router.post('/:id/resolve', async (req, res) => {
  const { resolvedBy, status } = req.body;

  const validStatuses = Object.values(ExtendedStatus);
  const newStatus = status && validStatuses.includes(status) ? status : ExtendedStatus.CLOSED;

  try {
    const report = await req.indexer.offChain.resolveReport(req.params.id, resolvedBy || null, newStatus);
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/reports/:id - Reporte on-chain por ID numerico
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) {
    return res.status(400).json({ success: false, error: 'ID debe ser un numero positivo' });
  }
  const report = req.indexer.getReport(id);
  if (!report) return res.status(404).json({ success: false, error: 'Reporte no encontrado' });
  res.json({ success: true, data: report });
});

module.exports = router;
