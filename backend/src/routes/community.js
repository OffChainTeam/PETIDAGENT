const express = require('express');
const router = express.Router();

// Sanitizar strings para prevenir XSS
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'&]/g, (char) => ({
    '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;'
  }[char] || char)).trim().slice(0, 500);
}

// Datos de comunidad (en producción sería una base de datos)
const COMMUNITY_DATA = {
  partners: [
    {
      id: 1,
      name: 'Veterinaria San Borja',
      type: 'veterinaria',
      location: 'San Borja, Lima',
      contact: '+51 999 888 777',
      services: ['vacunación', 'esterilización', 'emergencias'],
    },
    {
      id: 2,
      name: 'DogChow Perú',
      type: 'sponsor',
      location: 'Lima',
      contact: 'contacto@dogchow.pe',
      services: ['alimento', 'campañas'],
    },
    {
      id: 3,
      name: 'Asociación Animalista Lima',
      type: 'ong',
      location: 'Miraflores, Lima',
      contact: '@animalista_lima',
      services: ['adopción', 'rescate', 'campañas'],
    },
  ],
  campaigns: [
    {
      id: 1,
      title: 'Campaña de Vacunación Gratuita',
      description: 'Vacunación gratuita para mascotas registradas en PetID',
      date: '2026-03-01',
      location: 'Parque Kennedy, Miraflores',
      status: 'upcoming',
    },
    {
      id: 2,
      title: 'Jornada de Esterilización',
      description: 'Esterilización a bajo costo para perros y gatos',
      date: '2026-03-15',
      location: 'Veterinaria San Borja',
      status: 'upcoming',
    },
  ],
  stats: {
    totalMembers: 156,
    totalPartners: 3,
    petsReunited: 12,
    activeCampaigns: 2,
  },
};

// GET /api/community - Info general de comunidad
router.get('/', (req, res) => {
  res.json({ success: true, data: COMMUNITY_DATA.stats });
});

// GET /api/community/partners - Partners/veterinarias
router.get('/partners', (req, res) => {
  res.json({ success: true, data: COMMUNITY_DATA.partners });
});

// GET /api/community/campaigns - Campañas activas
router.get('/campaigns', (req, res) => {
  res.json({ success: true, data: COMMUNITY_DATA.campaigns });
});

// POST /api/community/join - Unirse a la comunidad
router.post('/join', (req, res) => {
  const { name, email, role } = req.body;
  const cleanName = sanitize(name);
  if (!cleanName) return res.status(400).json({ success: false, error: 'Nombre requerido' });

  const cleanEmail = sanitize(email);
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ success: false, error: 'Email invalido' });
  }

  const validRoles = ['voluntario', 'veterinario', 'rescatista', 'donante'];
  const cleanRole = validRoles.includes(role) ? role : 'voluntario';

  const member = {
    id: `MEM-${Date.now().toString(36).toUpperCase()}`,
    name: cleanName,
    email: cleanEmail,
    role: cleanRole,
    joinedAt: new Date().toISOString(),
  };

  res.json({ success: true, data: member, message: 'Bienvenido a la comunidad PetID' });
});

module.exports = router;
