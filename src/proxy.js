/**
 * PETID Proxy Chatbot — Telegram
 * Users NEVER talk directly to the AI agent.
 * All messages go through this proxy, which forwards them to PetIDAgent.
 */
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const WELCOME_MSG = `🐾 ¡Hola! Soy *PETID Agent*, tu asistente para encontrar mascotas perdidas.

Puedo ayudarte a:
• 🚨 *Crear una alerta* con los datos de tu mascota
• � *Enviar una foto* para incluirla en la alerta
• �🔍 *Buscar grupos* de recuperación en tu zona
• � *Generar link de WhatsApp* para que te contacten de inmediato
• ⛓️ *Registrar el reporte en blockchain* (zkTanenbaum)

💡 *Tip:* Envíame una foto de tu mascota + cuéntame qué pasó y tu número de WhatsApp. Yo genero la alerta lista para compartir. 💬`;

const HELP_MSG = `🐾 *PETID Agent — Comandos avanzados*

/help — Mostrar esta ayuda
/groups — Ver top 10 grupos de recuperación
/admin [clave] — Acceso administrador

_Para reportar una mascota perdida o buscar grupos, simplemente escríbeme directamente — no necesitas comandos._`;

const ADMIN_KEY = process.env.ADMIN_KEY || 'petid2024';

class TelegramProxy {
  constructor(agent) {
    this.agent = agent;
    this.token = process.env.TELEGRAM_BOT_TOKEN;
    this.mode = process.env.TELEGRAM_MODE || 'polling';
    this.bot = null;
    this.userStates = new Map();
  }

  start() {
    if (!this.token) {
      console.warn('[Telegram] No TELEGRAM_BOT_TOKEN configured — bot disabled');
      return;
    }

    const options = this.mode === 'webhook' ? {} : { polling: { autoStart: true, interval: 300 } };
    this.bot = new TelegramBot(this.token, options);

    this._registerHandlers();

    if (this.mode === 'webhook' && process.env.TELEGRAM_WEBHOOK_URL) {
      const webhookUrl = `${process.env.TELEGRAM_WEBHOOK_URL}/telegram/webhook`;
      this.bot.setWebHook(webhookUrl);
      console.log(`[Telegram] Webhook set: ${webhookUrl}`);
    } else {
      console.log('[Telegram] Bot started in polling mode — @petid_agent_bot');
    }
  }

  _registerHandlers() {
    this.bot.onText(/\/start/, (msg) => this._handleStart(msg));
    this.bot.onText(/\/help/, (msg) => this._handleHelp(msg));
    this.bot.onText(/\/groups/, (msg) => this._handleGroups(msg));
    this.bot.onText(/\/admin (.+)/, (msg, match) => this._handleAdmin(msg, match[1]));

    this.bot.on('photo', (msg) => {
      this._handlePhoto(msg);
    });

    this.bot.on('message', (msg) => {
      if (msg.photo) return;
      if (!msg.text || msg.text.startsWith('/')) return;
      this._handleText(msg);
    });

    this.bot.on('polling_error', (err) => {
      console.error('[Telegram] Polling error:', err.message);
    });

    this.bot.on('error', (err) => {
      console.error('[Telegram] Error:', err.message);
    });
  }

  async _handleStart(msg) {
    const chatId = msg.chat.id;
    const firstName = msg.from?.first_name || '';
    const greeting = firstName ? `🐾 ¡Hola, ${firstName}! Soy *PETID Agent*, tu asistente para encontrar mascotas perdidas.` : WELCOME_MSG;
    const personalMsg = firstName
      ? `${greeting}\n\nPuedo ayudarte a:\n• 🚨 *Publicar una alerta* si perdiste a tu mascota\n• 🔍 *Buscar grupos* de recuperación en tu zona\n• 📢 *Difundir el reporte* en más de 50 canales automáticamente\n\n¿Qué necesitas hoy? Cuéntame con tus palabras. 💬`
      : WELCOME_MSG;
    await this._send(chatId, personalMsg);
  }

  async _handleHelp(msg) {
    const chatId = msg.chat.id;
    await this._send(chatId, HELP_MSG);
  }

  async _handleGroups(msg) {
    const chatId = msg.chat.id;
    await this._send(chatId, '⏳ Buscando los mejores grupos...');
    try {
      const groups = this.agent.indexer.getTopGroups(10);
      const stats = this.agent.indexer.getStats();
      let text = `📋 *Top ${groups.length} grupos de recuperación*\n`;
      text += `_${stats.total} grupos indexados en total_\n\n`;
      groups.forEach((g, i) => {
        const emoji = { facebook: '📘', telegram: '✈️', whatsapp: '📱', reddit: '🔴', web: '🌐', superdapp: '⛓️' }[g.platform] || '📢';
        text += `${i + 1}. ${emoji} *${g.name}*\n`;
        text += `   📍 ${g.location}`;
        if (g.members > 0) text += ` • 👥 ${g.members.toLocaleString()}`;
        text += `\n   🔗 ${g.url}\n\n`;
      });
      await this._send(chatId, text);
    } catch (err) {
      await this._send(chatId, `❌ Error: ${err.message}`);
    }
  }

  async _handleAdmin(msg, key) {
    const chatId = msg.chat.id;
    if (key.trim() !== ADMIN_KEY) {
      await this._send(chatId, '❌ Clave incorrecta.');
      return;
    }
    try {
      const status = this.agent.getStatus();
      const uptime = this._formatUptime(status.uptime);
      const text =
        `🔧 *Panel Admin — PETID Agent*\n\n` +
        `✅ Estado: Activo\n` +
        `🧠 Modelo: \`${status.model}\`\n` +
        `⏱ Uptime: ${uptime}\n\n` +
        `📊 *Estadísticas:*\n` +
        `• Mensajes: ${status.stats.totalMessages}\n` +
        `• Reportes: ${status.stats.reportsGenerated}\n` +
        `• Alertas publicadas: ${status.stats.alertsPublished}\n` +
        `• Grupos indexados: ${status.indexedGroups}\n` +
        `• Conversaciones activas: ${status.activeConversations}\n\n` +
        `⛓ Chain: zkSYS ${process.env.CHAIN_ID || 57042}\n` +
        `📍 Contrato: \`${(process.env.CONTRACT_ADDRESS || '').substring(0, 20)}...\``;
      await this._send(chatId, text);
    } catch (err) {
      await this._send(chatId, `❌ Error: ${err.message}`);
    }
  }

  async _handlePhoto(msg) {
    const chatId = msg.chat.id;
    const userId = String(chatId);
    const caption = msg.caption || '';

    await this.bot.sendChatAction(chatId, 'typing');

    try {
      // Obtener la foto de mayor resolución
      const photo = msg.photo[msg.photo.length - 1];
      const fileId = photo.file_id;

      // Guardar referencia de la foto en el agente para esta conversación
      if (!this.agent.userPhotos) this.agent.userPhotos = new Map();
      this.agent.userPhotos.set(userId, { fileId, timestamp: Date.now() });

      // Procesar caption como mensaje + notificar que recibimos la foto
      const messageWithPhoto = caption
        ? `${caption}\n\n[El usuario envió una foto de su mascota, fileId: ${fileId}]`
        : `Envié una foto de mi mascota perdida. [fileId: ${fileId}]`;

      const response = await this.agent.processMessage(messageWithPhoto, userId);
      await this._send(chatId, `📸 *Foto recibida.* La incluiré en tu alerta.\n\n${response}`);
    } catch (err) {
      console.error('[Telegram] Photo handler error:', err.message);
      await this._send(chatId, `📸 Recibí tu foto. ¿Puedes contarme los datos de tu mascota? (nombre, especie, ubicación, tu WhatsApp) 🐾`);
    }
  }

  async _handleText(msg) {
    const chatId = msg.chat.id;
    const userId = String(chatId);
    const text = msg.text;

    await this.bot.sendChatAction(chatId, 'typing');

    try {
      const response = await this.agent.processMessage(text, userId);
      await this._send(chatId, response);
    } catch (err) {
      console.error('[Telegram] Handler error:', err.message);
      await this._send(chatId, `Lo siento, tuve un problema procesando tu mensaje. ¿Puedes intentarlo de nuevo? 🙏`);
    }
  }

  _formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  }

  async _send(chatId, text) {
    try {
      await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } catch {
      try {
        await this.bot.sendMessage(chatId, text.replace(/[*_`]/g, ''));
      } catch (e2) {
        console.error('[Telegram] Send failed:', e2.message);
      }
    }
  }

  processWebhookUpdate(update) {
    if (!this.bot) return;
    this.bot.processUpdate(update);
  }
}

module.exports = { TelegramProxy };
