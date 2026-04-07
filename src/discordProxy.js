/**
 * PETID Discord Proxy Chatbot
 * Bot proxy para el servidor oficial de Syscoin en Discord.
 * Los usuarios interactúan con el bot, que reenvía mensajes al PetIDAgent.
 * NO usa OpenClaw — es un bot propio con discord.js.
 */
require('dotenv').config();
const { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes } = require('discord.js');

const WELCOME_EMBED = {
  title: '🐾 PETID Agent — Recuperación de Mascotas con IA',
  description: 'Soy un agente AI autónomo que ayuda a encontrar mascotas perdidas en Latinoamérica.\n\n' +
    '**¿Qué puedo hacer?**\n' +
    '🚨 Publicar alertas de mascotas perdidas\n' +
    '🔍 Buscar grupos de recuperación en tu zona\n' +
    '⛓️ Registrar reportes on-chain en zkTanenbaum\n' +
    '📊 Mostrar estadísticas del protocolo\n\n' +
    'Usa los comandos slash.',
  color: 0x3498db,
  footer: { text: 'PETID Agent • Syscoin zkSYS Testnet • Hackathon PoB IV' },
};

// Scopes MINIMOS necesarios (SIN DM)
const SCOPES = [
  'bot',                    // Permiso básico del bot
  'applications.commands'   // Comandos slash (/petid)
];

// Permisos MINIMOS sin DM:
// 2048 = Send Messages
// 1024 = View Channels
// 16384 = Embed Links  
// 65536 = Read Message History
// 2147483648 = Use Slash Commands
const PERMISSIONS = '2147555328';  

// URL base para OAuth2
const OAUTH2_BASE_URL = 'https://discord.com/oauth2/authorize';

class DiscordProxy {
  constructor(agent, blockchain) {
    this.agent = agent;
    this.blockchain = blockchain;
    this.token = process.env.DISCORD_BOT_TOKEN;
    this.clientId = process.env.DISCORD_CLIENT_ID;
    this.guildId = process.env.DISCORD_GUILD_ID;
    this.channelIds = (process.env.DISCORD_CHANNEL_IDS || '').split(',').filter(Boolean);
    this.client = null;
    this.ready = false;
  }

  async start() {
    if (!this.token) {
      console.warn('[Discord] No DISCORD_BOT_TOKEN configured — bot disabled');
      return;
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        // GatewayIntentBits.DirectMessages, // Desactivado - solo servidor
      ],
    });

    this._registerEvents();

    try {
      await this.client.login(this.token);
    } catch (err) {
      console.error(`[Discord] Login failed: ${err.message}`);
    }
  }

  async registerSlashCommands() {
    if (!this.token || !this.clientId) {
      console.warn('[Discord] Cannot register slash commands — missing DISCORD_CLIENT_ID');
      return;
    }

    const commands = [
      new SlashCommandBuilder()
        .setName('petid')
        .setDescription('Interactúa con PETID Agent')
        .addSubcommand(sub =>
          sub.setName('report')
            .setDescription('Reportar una mascota perdida')
            .addStringOption(opt => opt.setName('descripcion').setDescription('Describe tu mascota perdida (nombre, especie, ubicación, contacto)').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('search')
            .setDescription('Buscar grupos de recuperación')
            .addStringOption(opt => opt.setName('zona').setDescription('Ciudad o zona para buscar grupos').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('status')
            .setDescription('Ver estado del agente y blockchain')
        )
        .addSubcommand(sub =>
          sub.setName('groups')
            .setDescription('Ver top 10 grupos de recuperación')
        )
        .addSubcommand(sub =>
          sub.setName('chain')
            .setDescription('Ver estadísticas on-chain de PetRegistry')
        )
        .addSubcommand(sub =>
          sub.setName('help')
            .setDescription('Mostrar ayuda del bot')
        ),
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(this.token);

    try {
      if (this.guildId) {
        await rest.put(Routes.applicationGuildCommands(this.clientId, this.guildId), { body: commands });
        console.log(`[Discord] Slash commands registered for guild ${this.guildId}`);
      } else {
        await rest.put(Routes.applicationCommands(this.clientId), { body: commands });
        console.log('[Discord] Slash commands registered globally');
      }
    } catch (err) {
      console.error(`[Discord] Slash command registration failed: ${err.message}`);
    }
  }

  _registerEvents() {
    this.client.once(Events.ClientReady, async (c) => {
      console.log(`[Discord] Bot logged in as ${c.user.tag}`);
      this.ready = true;
      await this.registerSlashCommands();
      this.client.user.setActivity('🐾 /petid help | Mascotas perdidas', { type: 3 });
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'petid') return;

      const sub = interaction.options.getSubcommand();
      await this._handleSlashCommand(interaction, sub);
    });

    this.client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;

      // Respond to DMs
      if (!message.guild) {
        await this._handleDirectMessage(message);
        return;
      }

      // Respond to mentions in allowed channels
      if (this.client.user && message.mentions.has(this.client.user)) {
        await this._handleMention(message);
        return;
      }

      // Respond in configured channels if message starts with !petid
      if (message.content.toLowerCase().startsWith('!petid')) {
        await this._handleBangCommand(message);
        return;
      }
    });

    this.client.on('error', (err) => {
      console.error('[Discord] Error:', err.message);
    });
  }

  // ── Slash Commands ───────────────────────────────────────

  async _handleSlashCommand(interaction, subcommand) {
    await interaction.deferReply();

    try {
      switch (subcommand) {
        case 'report':
          await this._slashReport(interaction);
          break;
        case 'search':
          await this._slashSearch(interaction);
          break;
        case 'status':
          await this._slashStatus(interaction);
          break;
        case 'groups':
          await this._slashGroups(interaction);
          break;
        case 'chain':
          await this._slashChain(interaction);
          break;
        case 'help':
          await this._slashHelp(interaction);
          break;
        default:
          await interaction.editReply('Comando no reconocido. Usa `/petid help`.');
      }
    } catch (err) {
      console.error(`[Discord] Slash command error: ${err.message}`);
      await interaction.editReply('❌ Error procesando tu solicitud. Intenta de nuevo.');
    }
  }

  async _slashReport(interaction) {
    const desc = interaction.options.getString('descripcion');
    const userId = `discord-${interaction.user.id}`;

    const reply = await this.agent.processMessage(desc, userId);

    const embed = new EmbedBuilder()
      .setTitle('🚨 Reporte de Mascota Perdida')
      .setDescription(reply.substring(0, 4000))
      .setColor(0xe74c3c)
      .setFooter({ text: `PETID Agent • zkTanenbaum • ${new Date().toLocaleString('es-PE')}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  async _slashSearch(interaction) {
    const zona = interaction.options.getString('zona');
    const groups = this.agent.indexer.searchGroups(zona).slice(0, 5);

    let desc = groups.length === 0
      ? `No encontré grupos para "${zona}". Prueba con otra ciudad.`
      : groups.map((g, i) => {
          const emoji = { facebook: '📘', telegram: '✈️', whatsapp: '📱', reddit: '🔴', web: '🌐', superdapp: '⛓️' }[g.platform] || '📢';
          return `**${i + 1}.** ${emoji} ${g.name}\n   📍 ${g.location} • 👥 ${g.members.toLocaleString()}\n   🔗 ${g.url}`;
        }).join('\n\n');

    const embed = new EmbedBuilder()
      .setTitle(`🔍 Grupos de recuperación — ${zona}`)
      .setDescription(desc.substring(0, 4000))
      .setColor(0x2ecc71)
      .setFooter({ text: `${this.agent.indexer.getGroupsCount()} grupos indexados en total` });

    await interaction.editReply({ embeds: [embed] });
  }

  async _slashStatus(interaction) {
    const status = this.agent.getStatus();
    const chainInfo = this.blockchain?.getInfo() || { connected: false };
    const uptime = this._formatUptime(status.uptime);

    const embed = new EmbedBuilder()
      .setTitle('📊 Estado de PETID Agent')
      .setColor(0x3498db)
      .addFields(
        { name: '🧠 Modelo AI', value: `\`${status.model}\``, inline: true },
        { name: '⏱️ Uptime', value: uptime, inline: true },
        { name: '💬 Mensajes', value: `${status.stats.totalMessages}`, inline: true },
        { name: '🚨 Reportes', value: `${status.stats.reportsGenerated}`, inline: true },
        { name: '📢 Alertas', value: `${status.stats.alertsPublished}`, inline: true },
        { name: '📋 Grupos', value: `${status.indexedGroups}`, inline: true },
        { name: '⛓️ Blockchain', value: chainInfo.connected ? `✅ ${chainInfo.network}` : '❌ Desconectado', inline: true },
        { name: '📝 Contrato', value: chainInfo.contractAddress ? `\`${chainInfo.contractAddress.substring(0, 20)}...\`` : 'N/A', inline: true },
      )
      .setFooter({ text: 'PETID Agent • Syscoin zkSYS Testnet • Hackathon PoB IV' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  async _slashGroups(interaction) {
    const groups = this.agent.indexer.getTopGroups(10);
    const stats = this.agent.indexer.getStats();

    let desc = groups.map((g, i) => {
      const emoji = { facebook: '📘', telegram: '✈️', whatsapp: '📱', reddit: '🔴', web: '🌐', superdapp: '⛓️' }[g.platform] || '📢';
      return `**${i + 1}.** ${emoji} ${g.name}\n   📍 ${g.location} • 👥 ${g.members.toLocaleString()} • ⭐ ${g.score}`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`📋 Top ${groups.length} Grupos de Recuperación`)
      .setDescription(desc.substring(0, 4000))
      .setColor(0xf39c12)
      .setFooter({ text: `${stats.total} grupos indexados • Score promedio: ${stats.avgScore}` });

    await interaction.editReply({ embeds: [embed] });
  }

  async _slashChain(interaction) {
    if (!this.blockchain?.isConnected()) {
      await interaction.editReply('⛓️ Blockchain no conectada. Configurar RPC_URL y CONTRACT_ADDRESS.');
      return;
    }

    const stats = await this.blockchain.getOnChainStats();
    if (!stats.success) {
      await interaction.editReply(`❌ Error consultando blockchain: ${stats.error}`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('⛓️ PetRegistry On-Chain Stats')
      .setColor(0x9b59b6)
      .addFields(
        { name: '🌐 Red', value: stats.chain, inline: true },
        { name: '📝 Contrato', value: `\`${stats.contract.substring(0, 20)}...\``, inline: true },
        { name: '🐾 Mascotas Registradas', value: `${stats.totalPets}`, inline: true },
        { name: '👁️ Avistamientos', value: `${stats.totalSightingReports}`, inline: true },
        { name: '📋 Reportes Generales', value: `${stats.totalGeneralReports}`, inline: true },
        { name: '🔗 Explorer', value: `[Ver contrato](${stats.explorer})`, inline: true },
      )
      .setFooter({ text: 'PetRegistry • zkTanenbaum (zkSYS Testnet) • Chain 57057' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  async _slashHelp(interaction) {
    const embed = new EmbedBuilder()
      .setTitle(WELCOME_EMBED.title)
      .setDescription(WELCOME_EMBED.description +
        '\n\n**Comandos:**\n' +
        '`/petid report` — Reportar mascota perdida\n' +
        '`/petid search` — Buscar grupos por zona\n' +
        '`/petid groups` — Ver top 10 grupos\n' +
        '`/petid status` — Estado del agente\n' +
        '`/petid chain` — Estadísticas on-chain\n' +
        '`/petid help` — Esta ayuda\n\n' +
        '**También puedes:**\n' +
        '• Mencionarme en cualquier canal\n' +
        '• Escribirme por DM directamente\n' +
        '• Usar `!petid <mensaje>` en canales configurados')
      .setColor(WELCOME_EMBED.color)
      .setFooter({ text: WELCOME_EMBED.footer.text });

    await interaction.editReply({ embeds: [embed] });
  }

  // ── Direct Messages & Mentions ───────────────────────────

  async _handleDirectMessage(message) {
    const userId = `discord-dm-${message.author.id}`;
    await message.channel.sendTyping();

    try {
      const reply = await this.agent.processMessage(message.content, userId);
      await this._sendLongMessage(message.channel, reply);
    } catch (err) {
      console.error(`[Discord] DM error: ${err.message}`);
      await message.reply('Lo siento, tuve un problema procesando tu mensaje. ¿Puedes intentarlo de nuevo? 🙏');
    }
  }

  async _handleMention(message) {
    const content = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!content) {
      const embed = new EmbedBuilder()
        .setTitle(WELCOME_EMBED.title)
        .setDescription(WELCOME_EMBED.description +
          '\n\n💡 **Mencióname con tu mensaje**, por ejemplo:\n' +
          '`@PETID Agent se perdió mi perro Bruno en Miraflores`')
        .setColor(WELCOME_EMBED.color);
      await message.reply({ embeds: [embed] });
      return;
    }

    const userId = `discord-${message.author.id}`;
    await message.channel.sendTyping();

    try {
      const reply = await this.agent.processMessage(content, userId);
      await this._sendLongMessage(message.channel, reply, message);
    } catch (err) {
      console.error(`[Discord] Mention error: ${err.message}`);
      await message.reply('❌ Error procesando tu solicitud. Intenta de nuevo.');
    }
  }

  async _handleBangCommand(message) {
    const content = message.content.replace(/^!petid\s*/i, '').trim();
    if (!content) {
      await message.reply('Uso: `!petid <tu mensaje>` — Ejemplo: `!petid se perdió mi gato en Miraflores`');
      return;
    }

    const userId = `discord-${message.author.id}`;
    await message.channel.sendTyping();

    try {
      const reply = await this.agent.processMessage(content, userId);
      await this._sendLongMessage(message.channel, reply, message);
    } catch (err) {
      await message.reply('❌ Error procesando tu solicitud.');
    }
  }

  // ── OAuth2 URL Generator ────────────────────────────────────
  
  /**
   * Genera el enlace de OAuth2 para invitar al bot al servidor
   * @param {string} guildId - ID del servidor (opcional)
   * @returns {string} URL de OAuth2 con los permisos necesarios
   */
  generateOAuth2Url(guildId = null) {
    if (!this.clientId) {
      throw new Error('DISCORD_CLIENT_ID no configurado');
    }
    
    const params = new URLSearchParams({
      client_id: this.clientId,
      scope: SCOPES.join(' '),
      permissions: PERMISSIONS,
    });
    
    if (guildId) {
      params.append('guild_id', guildId);
      params.append('disable_guild_select', 'true');
    }
    
    return `${OAUTH2_BASE_URL}?${params.toString()}`;
  }

  // ── Utilities ────────────────────────────────────────────

  async _sendLongMessage(channel, text, replyTo = null) {
    const chunks = this._splitMessage(text, 2000);
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0 && replyTo) {
        await replyTo.reply(chunks[i]);
      } else {
        await channel.send(chunks[i]);
      }
    }
  }

  _splitMessage(text, maxLength = 2000) {
    if (text.length <= maxLength) return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt === -1 || splitAt < maxLength / 2) splitAt = maxLength;
      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trimStart();
    }
    return chunks;
  }

  _formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }

  isReady() {
    return this.ready;
  }
}

module.exports = { DiscordProxy };
