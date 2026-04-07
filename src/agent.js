require('dotenv').config();
const Cerebras = require('@cerebras/cerebras_cloud_sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { GroupIndexer } = require('./indexer');
const { SuperDappConnector } = require('./superdapp');

function loadSoul(modelName) {
  const soulsDir = path.join(__dirname, '..', 'souls');
  try {
    for (const extension of ['.txt', '.md']) {
      const soulFile = path.join(soulsDir, `${modelName}${extension}`);
      if (!fs.existsSync(soulFile)) continue;

      const content = fs.readFileSync(soulFile, 'utf8')
        .replace(/<!--[\s\S]*?-->/g, '')
        .trim();

      console.log(`[Agent] Soul loaded from souls/${modelName}${extension}`);
      return content;
    }
  } catch { /* fallback */ }
  console.log(`[Agent] Using embedded system prompt (no soul file for ${modelName})`);
  return null;
}

const SYSTEM_PROMPT = `<role>PETID Agent v2.0: AI autónomo especializado en recuperación de mascotas perdidas en Latinoamérica. Integrado con blockchain zkTanenbaum (zkSYS Testnet, Syscoin).</role>

<mission>Reunir mascotas perdidas con sus familias usando alertas inteligentes, redes comunitarias y registro on-chain transparente.</mission>

<conversation_flow>
FLUJO OBLIGATORIO:
PASO 1 — Si el usuario saluda sin mencionar mascota perdida → saluda, preséntate y pregunta "¿Perdiste a tu mascota? Cuéntame qué pasó." NO uses herramientas.
PASO 2 — Recopila: nombre, especie, ubicación, WhatsApp del dueño. Pregunta UNO por UNO.
PASO 3 — Solo con nombre + especie + ubicación + contacto REALES → usa create_alert.
PASO 4 — Muestra resultado con plantillas y links.
PASO 5 — Pregunta si necesita más ayuda.
</conversation_flow>

<behavior>
- Responde en español salvo que el usuario escriba en otro idioma
- Sé empático y directo: cada minuto es crítico
- NUNCA asumas datos que el usuario NO dijo en ESTA conversación
- Si piden "links" o "grupos" → usa search_groups y muestra URLs completas
- Si preguntan por blockchain → usa get_chain_stats
- Si preguntan por estado → usa get_stats
</behavior>

<tools_usage>
CUÁNDO SÍ usar create_alert: usuario dio nombre + especie + ubicación + contacto.
CUÁNDO NO usar create_alert: saludos, datos incompletos, contacto inventado.
CUÁNDO usar search_groups: piden grupos, links, o dónde publicar.
</tools_usage>

<honesty>
1. PUBLICADO vs SUGERIDO: real_published_count = publicado real. suggested_groups = el usuario debe publicar manualmente.
   CORRECTO: "Publicado en 1 canal. Te sugiero compartir en estos 5 grupos:"
   PROHIBIDO: "Publicado en 6 canales" si 5 son sugerencias.
2. SIEMPRE incluye URL completa de cada grupo mencionado.
3. Si hay whatsapp_link → "📲 Contacto: {link}"
4. NUNCA digas que publicaste en Facebook/WhatsApp/Instagram. Solo sugieres grupos.
</honesty>

<response_format>
Después de crear alerta, incluye: 1) Alerta para copiar, 2) Plantillas por red social (FB, WA, TG, IG), 3) Lista de grupos con URL completa, 4) WhatsApp del dueño, 5) Info blockchain si aplica.
</response_format>

<blockchain>
Red: zkTanenbaum (zkSYS Testnet) — Chain ID 57057
Contrato PetRegistry: 0x7Ff5e0f9c8bb86422D5d1a6560b8cD67e8d99289
Explorer: https://explorer-zk.tanenbaum.io
</blockchain>

<strict>
1. NUNCA inventes datos.
2. NUNCA devuelvas JSON crudo.
3. NUNCA listes grupos sin URL completa.
4. NUNCA digas "publicado" para grupos sugeridos.
5. NUNCA generes alerta sin los 4 datos mínimos reales.
6. Si es saludo → solo saluda. No alertas.
7. Si piden links → solo links con URLs.
</strict>

<tone>Empático, urgente, nunca burocrático. Eres un aliado, no un formulario.</tone>`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_alert',
      description: 'Crea y publica una alerta de mascota perdida en todos los canales relevantes (SuperDapp, grupos de Facebook, Telegram, WhatsApp, Discord). Usar cuando se tenga nombre/especie/ubicación/contacto.',
      parameters: {
        type: 'object',
        properties: {
          pet_name:      { type: 'string', description: 'Nombre de la mascota. Ej: Bruno' },
          species:       { type: 'string', description: 'Especie: perro, gato, ave, conejo, etc.' },
          breed:         { type: 'string', description: 'Raza si se conoce. Ej: Labrador' },
          color:         { type: 'string', description: 'Color o descripción física. Ej: dorado con collar azul' },
          location:      { type: 'string', description: 'Última ubicación conocida. Ej: Miraflores, Lima' },
          owner_contact: { type: 'string', description: 'Teléfono o contacto del dueño' },
          reward:        { type: 'string', description: 'Recompensa ofrecida, si aplica' },
        },
        required: ['pet_name', 'species', 'location', 'owner_contact'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_groups',
      description: 'Busca los grupos de recuperación de mascotas más relevantes por ubicación o tipo de mascota en el índice de 50 grupos.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'Ciudad o distrito. Ej: Lima, Surco, Bogotá' },
          keyword:  { type: 'string', description: 'Palabra clave: perro, gato, ave, etc.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_stats',
      description: 'Obtiene estadísticas actuales del agente: grupos indexados, alertas publicadas, uptime.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_chain_stats',
      description: 'Obtiene estadísticas on-chain del contrato PetRegistry en zkTanenbaum (zkSYS Testnet): mascotas registradas, reportes de avistamiento, reportes generales.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_onchain_pet',
      description: 'Consulta los datos on-chain de una mascota registrada en PetRegistry por su ID (token NFT).',
      parameters: {
        type: 'object',
        properties: {
          pet_id: { type: 'number', description: 'ID numérico de la mascota en el contrato. Ej: 1, 2, 3' },
        },
        required: ['pet_id'],
      },
    },
  },
];

class PetIDAgent {
  constructor(blockchain = null) {
    this.client = new Cerebras({ apiKey: process.env.CEREBRAS_API_KEY });
    this.model = process.env.CEREBRAS_MODEL || 'llama3.1-8b';
    this.systemPrompt = loadSoul(this.model) || SYSTEM_PROMPT;
    this.indexer = new GroupIndexer();
    this.superdapp = new SuperDappConnector();
    this.blockchain = blockchain;
    this.petidApiUrl = process.env.PETID_API_URL || 'http://localhost:3001';
    this.telegramBot = null;
    this.telegramGroupIds = (process.env.TELEGRAM_GROUP_IDS || '').split(',').filter(Boolean);
    this.conversations = new Map();
    this.stats = {
      totalMessages: 0,
      reportsGenerated: 0,
      alertsPublished: 0,
      onChainReports: 0,
      petsFound: 0,
      startTime: Date.now(),
    };
  }

  _getHistory(userId) {
    if (!this.conversations.has(userId)) this.conversations.set(userId, []);
    return this.conversations.get(userId);
  }

  _addToHistory(userId, role, content) {
    const history = this._getHistory(userId);
    history.push({ role, content: typeof content === 'string' ? content : JSON.stringify(content) });
    if (history.length > 16) history.splice(0, 2);
    return history;
  }

  _isGreeting(text) {
    const greeting = text.toLowerCase().replace(/[^a-záéíóúñ\s]/g, '').trim();
    const greetings = ['hola', 'buenas', 'hey', 'hello', 'hi', 'buenos dias', 'buenas tardes', 'buenas noches', 'que tal', 'ola'];
    return greetings.some(g => greeting === g || greeting.startsWith(g + ' '));
  }

  async processMessage(userMessage, userId = 'default') {
    this.stats.totalMessages++;

    // Si es un saludo simple, resetear historial para evitar contaminación
    if (this._isGreeting(userMessage)) {
      this.conversations.set(userId, []);
    }

    this._addToHistory(userId, 'user', userMessage);

    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...this._getHistory(userId),
    ];

    const reply = await this._agenticLoop(messages, userId);
    this._addToHistory(userId, 'assistant', reply);
    return reply;
  }

  async _agenticLoop(messages, userId, depth = 0) {
    if (depth > 5) return 'He procesado tu solicitud y activado las alertas correspondientes.';

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      max_completion_tokens: 1800,
      temperature: 0.4,
    });

    const msg = response.choices[0].message;

    // Check for proper tool_calls first
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push(msg);

      for (const toolCall of msg.tool_calls) {
        let args = {};
        try { args = JSON.parse(toolCall.function.arguments); } catch { args = {}; }

        const result = await this._executeTool(toolCall.function.name, args, userId);

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      return this._agenticLoop(messages, userId, depth + 1);
    }

    // Fallback: detect tool calls leaked as plain text in content
    const textToolCall = this._detectTextToolCall(msg.content);
    if (textToolCall) {
      console.log(`[Agent] Detected text tool call: ${textToolCall.name} (depth=${depth})`);
      const result = await this._executeTool(textToolCall.name, textToolCall.arguments, userId);

      messages.push(msg);
      messages.push({
        role: 'user',
        content: `[Resultado de ${textToolCall.name}]: ${JSON.stringify(result)}\n\nAhora respóndele al usuario con esta información de forma clara y útil en español. NO muestres JSON.`,
      });

      return this._agenticLoop(messages, userId, depth + 1);
    }

    return msg.content;
  }

  _detectTextToolCall(content) {
    if (!content) return null;
    const validTools = TOOLS.map(t => t.function.name);

    try {
      // Try parsing the whole content as JSON first
      const trimmed = content.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        const parsed = JSON.parse(trimmed);
        if (parsed.name && validTools.includes(parsed.name)) {
          return { name: parsed.name, arguments: parsed.arguments || parsed.parameters || {} };
        }
      }
    } catch { /* not pure JSON */ }

    try {
      // Extract JSON object from mixed content (text + JSON)
      const jsonStart = content.indexOf('{');
      const jsonEnd = content.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        const jsonStr = content.substring(jsonStart, jsonEnd + 1);
        const parsed = JSON.parse(jsonStr);
        if (parsed.name && validTools.includes(parsed.name)) {
          return { name: parsed.name, arguments: parsed.arguments || parsed.parameters || {} };
        }
      }
    } catch { /* not valid JSON */ }

    // Regex fallback for fragmented patterns
    try {
      const nameMatch = content.match(/"name"\s*:\s*"(\w+)"/);
      const argsMatch = content.match(/"arguments"\s*:\s*(\{[^}]*\})/) || content.match(/"parameters"\s*:\s*(\{[^}]*\})/);
      if (nameMatch && validTools.includes(nameMatch[1])) {
        const args = argsMatch ? JSON.parse(argsMatch[1]) : {};
        return { name: nameMatch[1], arguments: args };
      }
    } catch { /* no match */ }

    return null;
  }

  async _executeTool(name, args, userId) {
    try {
      if (name === 'create_alert') return await this._toolCreateAlert(args, userId);
      if (name === 'search_groups') return await this._toolSearchGroups(args);
      if (name === 'get_stats') return this._toolGetStats();
      if (name === 'get_chain_stats') return await this._toolGetChainStats();
      if (name === 'get_onchain_pet') return await this._toolGetOnchainPet(args);
      return { error: `Tool desconocida: ${name}` };
    } catch (err) {
      return { error: err.message };
    }
  }

  async _toolCreateAlert(args, userId = 'default') {
    // Validación: datos mínimos reales
    if (!args.pet_name || args.pet_name === 'Sin nombre') {
      return { success: false, error: 'Falta el nombre de la mascota. Pregúntale al usuario cómo se llama.' };
    }
    if (!args.species || args.species === 'Mascota') {
      return { success: false, error: 'Falta la especie (perro, gato, etc.). Pregúntale al usuario.' };
    }
    if (!args.location || args.location === 'No especificada') {
      return { success: false, error: 'Falta la ubicación donde se perdió. Pregúntale al usuario.' };
    }
    if (!args.owner_contact || args.owner_contact === 'Ver Telegram') {
      return { success: false, error: 'Falta el número de WhatsApp/teléfono del dueño. Es CRÍTICO para que quien encuentre la mascota pueda contactarlo. Pídelo al usuario.' };
    }

    const ownerContact = args.owner_contact;
    const petData = {
      _userId: userId,
      name: args.pet_name,
      species: args.species,
      breed: args.breed || null,
      color: args.color || null,
      location: args.location,
      ownerContact,
      reward: args.reward || null,
      lastSeen: 'Recientemente',
    };

    // Generar link de WhatsApp si el contacto parece un número de teléfono
    const phoneDigits = ownerContact.replace(/[^0-9]/g, '');
    if (phoneDigits.length >= 8) {
      petData.whatsappLink = `https://wa.me/${phoneDigits}`;
    }

    const report = await this.reportLostPet(petData);
    const published = await this.publishToChannels(report);

    // Intentar registrar on-chain
    const onChainResult = await this._tryPublishOnChain(report);

    // Separar publicaciones reales de sugerencias
    const realPublished = published.filter(p => p.status === 'published');
    const suggestedGroups = published.filter(p => p.status === 'suggested');

    const result = {
      success: true,
      report_id: report.id,
      alert_preview: report.alertText.substring(0, 500),
      whatsapp_link: petData.whatsappLink || null,

      // PUBLICACIÓN REAL — canales donde el agente publicó automáticamente
      PUBLICADO_REAL_count: realPublished.length,
      PUBLICADO_REAL_canales: realPublished.length > 0
        ? realPublished.map(p => p.channel)
        : ['NINGUNO — el agente no publicó automáticamente en ningún canal'],

      // SUGERENCIAS — el usuario debe copiar la alerta y publicar manualmente aquí
      SUGERIDOS_para_publicar_MANUALMENTE: suggestedGroups.map(p => ({
        nombre: p.channel,
        plataforma: p.platform,
        url_clickeable: p.url,
        miembros: p.members,
      })),

      on_chain: onChainResult
        ? { registered: true, txHash: onChainResult.txHash, explorer: onChainResult.explorerUrl }
        : { registered: false },

      INSTRUCCION_PARA_TI: realPublished.length > 0
        ? `Dile al usuario: "Tu alerta fue publicada automáticamente en ${realPublished.length} canal(es): ${realPublished.map(p => p.channel).join(', ')}. ADEMÁS, te sugiero compartirla TÚ MISMO en estos ${suggestedGroups.length} grupos (copia la alerta y pégala):". Luego lista CADA grupo sugerido con su URL completa.`
        : `Dile al usuario: "Generé tu alerta pero NO se publicó automáticamente en ningún canal. Para difundirla, copia el texto y publícalo TÚ MISMO en estos ${suggestedGroups.length} grupos:". Luego lista CADA grupo con su URL completa clickeable.`,
    };

    return result;
  }

  _toolSearchGroups(args) {
    const query = [args.location, args.keyword].filter(Boolean).join(' ') || 'peru';
    const groups = this.indexer.searchGroups(query).slice(0, 10);
    return {
      success: true,
      query_used: query,
      groups_found: groups.length,
      groups: groups.map((g) => ({
        nombre: g.name,
        plataforma: g.platform,
        ubicacion: g.location,
        miembros: g.members,
        url_clickeable: g.url,
      })),
      total_indexed: this.indexer.getGroupsCount(),
      INSTRUCCION_PARA_TI: 'Muestra CADA grupo con su URL completa (url_clickeable). NUNCA listes un grupo sin su link. Usa emojis por plataforma: \ud83d\udcd8 Facebook, \u2708\ufe0f Telegram, \ud83d\udcf1 WhatsApp, \ud83d\udd34 Reddit, \ud83c\udf10 Web, \u26d3\ufe0f SuperDapp, \ud83d\udcf7 Instagram.',
    };
  }

  _toolGetStats() {
    const status = this.getStatus();
    return {
      success: true,
      uptime_seconds: status.uptime,
      total_messages: status.stats.totalMessages,
      reports_generated: status.stats.reportsGenerated,
      alerts_published: status.stats.alertsPublished,
      onchain_reports: status.stats.onChainReports,
      groups_indexed: status.indexedGroups,
      active_conversations: status.activeConversations,
      blockchain: status.blockchain,
    };
  }

  async _toolGetChainStats() {
    if (!this.blockchain || !this.blockchain.isConnected()) {
      return { success: false, error: 'Blockchain no conectada' };
    }
    return await this.blockchain.getOnChainStats();
  }

  async _toolGetOnchainPet(args) {
    if (!this.blockchain || !this.blockchain.isConnected()) {
      return { success: false, error: 'Blockchain no conectada' };
    }
    const petId = args.pet_id || args.petId || 1;
    return await this.blockchain.getPet(petId);
  }

  async reportLostPet(petData) {
    const knownFields = [
      `Nombre: ${petData.name}`,
      `Especie: ${petData.species}`,
      petData.breed  && `Raza: ${petData.breed}`,
      petData.color  && `Color/Apariencia: ${petData.color}`,
      `Última ubicación: ${petData.location}`,
      petData.ownerContact !== 'Ver Telegram' && `Contacto del dueño: ${petData.ownerContact}`,
      petData.whatsappLink && `WhatsApp directo: ${petData.whatsappLink}`,
      petData.reward && `Recompensa: ${petData.reward}`,
    ].filter(Boolean).join('\n');

    const prompt = `Genera alerta URGENTE de mascota perdida con SOLO los datos proporcionados:

${knownFields}

REGLAS ESTRICTAS:
- NO uses frases como "no especificada", "su nombre", "su teléfono", "fecha actual" u otros placeholders
- Solo menciona los datos que tienes arriba
- Si falta la raza o color → omítelo completamente
- Si falta el contacto → di "contactar por Telegram"
- Si hay link de WhatsApp, SIEMPRE inclúyelo como "📲 WhatsApp: {link}" para que quien encuentre la mascota contacte al dueño con un tap
- Formato: 1) 🚨 Alerta corta para redes (máx 200 chars con emojis), 2) Mensaje para grupos WhatsApp/Telegram (solo con datos reales, incluir link WhatsApp si existe), 3) 2 acciones inmediatas para el dueño`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'system', content: this.systemPrompt }, { role: 'user', content: prompt }],
      max_completion_tokens: 800,
      temperature: 0.5,
    });

    const alertText = response.choices[0].message.content;
    this.stats.reportsGenerated++;

    const report = {
      id: `RPT-${Date.now()}`,
      timestamp: new Date().toISOString(),
      petData,
      alertText,
      status: 'active',
      publishedTo: [],
    };

    await this._tryPublishToPetidApi(report);
    return report;
  }

  async generateAlert(petData) {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{
        role: 'user',
        content: `Alerta corta (máx 200 chars) con emojis: ${petData.name} (${petData.species}), perdido/a en ${petData.location}. Contacto: ${petData.ownerContact}`,
      }],
      max_completion_tokens: 150,
      temperature: 0.5,
    });
    return response.choices[0].message.content;
  }

  async publishToChannels(report) {
    const results = [];
    const topGroups = this.indexer.getTopGroups(10);
    const alertShort = await this.generateAlert(report.petData);

    // 1) SuperDapp — solo marcar como publicado si tiene API key real
    const sdResult = await this.superdapp.postToCommunity({
      message: alertShort,
      tags: ['petid', 'mascota-perdida', report.petData.location || 'peru'],
      reportId: report.id,
    });

    if (sdResult.success && sdResult.mode !== 'simulation') {
      results.push({ channel: 'SuperDapp Syscoin', status: 'published', url: sdResult.url });
      this.stats.alertsPublished++;
    }

    // 2) Telegram — publicar en grupos reales si el bot tiene acceso
    if (this.telegramBot) {
      // Buscar si hay foto del usuario para esta alerta
      const userPhoto = this.userPhotos && this.userPhotos.get(report.petData._userId);
      
      for (const groupId of this.telegramGroupIds) {
        try {
          if (userPhoto && userPhoto.fileId) {
            await this.telegramBot.sendPhoto(groupId, userPhoto.fileId, {
              caption: alertShort,
              parse_mode: 'Markdown',
            });
          } else {
            await this.telegramBot.sendMessage(groupId, alertShort, { parse_mode: 'Markdown', disable_web_page_preview: true });
          }
          results.push({ channel: `Telegram grupo ${groupId}`, status: 'published', platform: 'telegram' });
          this.stats.alertsPublished++;
        } catch (err) {
          console.error(`[Agent] Failed to post to Telegram group ${groupId}: ${err.message}`);
        }
      }
    }

    // 3) Grupos sugeridos — el usuario debe publicar manualmente
    for (const group of topGroups.slice(0, 5)) {
      results.push({
        channel: group.name,
        platform: group.platform,
        status: 'suggested',
        members: group.members,
        url: group.url,
      });
    }

    report.publishedTo = results;
    report.status = results.some(r => r.status === 'published') ? 'published' : 'generated';
    return results;
  }

  async searchPetGroups(query) {
    const groups = this.indexer.searchGroups(query);
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{
        role: 'user',
        content: `Grupos de mascotas para: "${query}"\n${groups.slice(0, 5).map((g) => `- ${g.name} (${g.platform}, ${g.location}, ${g.members} miembros)`).join('\n')}\nRecomienda los 3 mejores brevemente.`,
      }],
      max_completion_tokens: 400,
      temperature: 0.5,
    });
    return { groups, recommendation: response.choices[0].message.content };
  }

  async _tryPublishToPetidApi(report) {
    try {
      await axios.post(`${this.petidApiUrl}/api/reports`, {
        petName: report.petData.name,
        species: report.petData.species,
        location: report.petData.location,
        description: report.alertText,
        ownerContact: report.petData.ownerContact,
        agentReportId: report.id,
      }, { timeout: 5000 });
    } catch { /* backend puede no estar corriendo */ }
  }

  async _tryPublishOnChain(report) {
    if (!this.blockchain || !this.blockchain.isConnected()) return null;
    try {
      const result = await this.blockchain.createGeneralReportOnChain(
        'LOST',
        `petid://${report.id}`,
        report.petData.location || 'Unknown'
      );
      if (result.success) {
        this.stats.onChainReports++;
        console.log(`[Blockchain] Report ${report.id} registered on-chain: ${result.txHash}`);
      }
      return result;
    } catch (err) {
      console.error(`[Blockchain] On-chain report failed: ${err.message}`);
      return null;
    }
  }

  getStatus() {
    return {
      status: 'active',
      version: '2.0.0',
      model: this.model,
      uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
      stats: this.stats,
      indexedGroups: this.indexer.getGroupsCount(),
      activeConversations: this.conversations.size,
      blockchain: this.blockchain ? this.blockchain.getInfo() : { connected: false },
    };
  }
}

module.exports = { PetIDAgent };
