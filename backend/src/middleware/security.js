// Rate limiter simple (sin dependencias externas)
const rateLimitMap = new Map();

function rateLimit(windowMs = 60000, maxRequests = 100) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    
    if (!rateLimitMap.has(ip)) {
      rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    const entry = rateLimitMap.get(ip);

    if (now > entry.resetAt) {
      entry.count = 1;
      entry.resetAt = now + windowMs;
      return next();
    }

    entry.count++;

    if (entry.count > maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Demasiadas solicitudes. Intenta de nuevo en un momento.',
      });
    }

    next();
  };
}

// Limpiar entradas viejas cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 300000);

// Headers de seguridad
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // No exponer tecnologia del servidor
  res.removeHeader('X-Powered-By');
  next();
}

// Limitar tamano del body
function bodyLimit(maxSize = '10kb') {
  return (req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || '0');
    const maxBytes = parseInt(maxSize) * 1024;
    if (contentLength > maxBytes) {
      return res.status(413).json({
        success: false,
        error: 'Payload demasiado grande',
      });
    }
    next();
  };
}

// Middleware de error global
function errorHandler(err, req, res, next) {
  console.error('[Error]', err.message);
  // No exponer detalles del error en produccion
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : err.message,
  });
}

module.exports = { rateLimit, securityHeaders, bodyLimit, errorHandler };
