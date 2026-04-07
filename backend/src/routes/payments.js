const express = require('express');
const router = express.Router();

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'&]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;'
  }[c] || c)).trim().slice(0, 500);
}

// Métodos de pago disponibles
const PAYMENT_METHODS = [
  {
    id: 'crypto_sys',
    name: 'SYS (Syscoin)',
    type: 'crypto',
    icon: '🔗',
    description: 'Pago directo con tokens SYS en la blockchain',
    enabled: true,
    instructions: 'Conecta tu wallet MetaMask y la recompensa se transfiere automáticamente al encontrar la mascota.',
  },
  {
    id: 'yape',
    name: 'Yape',
    type: 'fiat',
    icon: '💜',
    description: 'Pago por Yape (BCP)',
    enabled: true,
    instructions: 'Escanea el QR o transfiere al número registrado del dueño de la mascota.',
  },
  {
    id: 'plin',
    name: 'Plin',
    type: 'fiat',
    icon: '💚',
    description: 'Pago por Plin (Interbank, BBVA, Scotiabank)',
    enabled: true,
    instructions: 'Transfiere al número registrado del dueño de la mascota.',
  },
  {
    id: 'efectivo',
    name: 'Efectivo',
    type: 'fiat',
    icon: '💵',
    description: 'Pago en efectivo al momento del encuentro',
    enabled: true,
    instructions: 'Coordina directamente con el dueño para la entrega en efectivo.',
  },
  {
    id: 'cuenta_bancaria',
    name: 'Cuenta Bancaria',
    type: 'fiat',
    icon: '🏦',
    description: 'Transferencia bancaria',
    enabled: true,
    instructions: 'El dueño proporcionará su número de cuenta para la transferencia.',
  },
];

// GET /api/payments/methods - Métodos de pago disponibles
router.get('/methods', (req, res) => {
  const enabledMethods = PAYMENT_METHODS.filter(m => m.enabled);
  res.json({ success: true, data: enabledMethods });
});

// GET /api/payments/methods/:id - Detalle de un método
router.get('/methods/:id', (req, res) => {
  const method = PAYMENT_METHODS.find(m => m.id === req.params.id);
  if (!method) return res.status(404).json({ success: false, error: 'Método no encontrado' });
  res.json({ success: true, data: method });
});

// POST /api/payments/reward - Registrar intención de pago de recompensa
router.post('/reward', (req, res) => {
  const { petId, method, amount, currency, contact } = req.body;

  // Validar petId es número positivo
  const cleanPetId = parseInt(petId);
  if (isNaN(cleanPetId) || cleanPetId < 1) {
    return res.status(400).json({ success: false, error: 'petId debe ser un numero positivo' });
  }

  if (!method || typeof method !== 'string') {
    return res.status(400).json({ success: false, error: 'method es requerido' });
  }

  const paymentMethod = PAYMENT_METHODS.find(m => m.id === method);
  if (!paymentMethod) {
    return res.status(400).json({ success: false, error: 'Metodo de pago no valido' });
  }

  // Validar amount es número positivo o cero
  const cleanAmount = parseFloat(amount) || 0;
  if (cleanAmount < 0) {
    return res.status(400).json({ success: false, error: 'amount no puede ser negativo' });
  }

  const validCurrencies = ['SYS', 'PEN', 'USD'];
  const cleanCurrency = validCurrencies.includes(currency) ? currency : (method === 'crypto_sys' ? 'SYS' : 'PEN');

  const paymentIntent = {
    id: `PAY-${Date.now().toString(36).toUpperCase()}`,
    petId: cleanPetId,
    method: paymentMethod.name,
    methodId: method,
    amount: cleanAmount.toString(),
    currency: cleanCurrency,
    contact: sanitize(contact),
    status: 'pending',
    createdAt: new Date().toISOString(),
    instructions: paymentMethod.instructions,
  };

  res.json({ success: true, data: paymentIntent });
});

module.exports = router;
