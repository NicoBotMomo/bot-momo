require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');

// Estructuras para manejar colas, reproductores y conexiones por servidor
const queues = new Map();
const players = new Map();
const connections = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once(Events.ClientReady, () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  // Mostrar menú de comandos disponibles
  if (message.content === '!menu' || message.content === '!help') {
    const audioDir = path.join(__dirname, 'audios');
    let archivos;
    try {
      archivos = fs.readdirSync(audioDir);
    } catch (err) {
      return message.reply('❌ Error al leer la carpeta de audios.');
    }

    const audios = archivos.filter(file => file.endsWith('.mp3'));

    if (audios.length === 0) {
      return message.reply('⚠️ No hay audios disponibles en la carpeta.');
    }

    const listaComandos = audios
      .map(file => `!${file.replace('.mp3', '')}`)
      .join('\n');

    return message.reply(
      `👋 Bienvenido al Bot del Momo!\n\n` +
      `📌 Comandos generales:\n` +
      `\`!menu\`, \`!help\`, \`!cola\`, \`!skip\`, \`!stop\`\n\n` +
      `📜 Audios disponibles:\n\`\`\`\n${listaComandos}\n\`\`\`\n` +
      `Usá el comando correspondiente para reproducir un audio.`
    );
  }

  // Mostrar cola de reproducción
  if (message.content === '!cola') {
    const guildId = message.guild.id;
    const queue = queues.get(guildId);

    if (!queue || queue.length === 0) {
      return message.reply('📭 No hay audios en la cola de reproducción.');
    }

    const lista = queue.map((item, index) => {
      return `${index === 0 ? '▶️' : '⏳'} ${item.commandName}.mp3`;
    }).join('\n');

    return message.reply(
      `📂 Audios en cola:\n\`\`\`\n${lista}\n\`\`\``
    );
  }

  // Comando para saltar al siguiente audio
  if (message.content === '!skip') {
    const guildId = message.guild.id;
    const queue = queues.get(guildId);

    if (!queue || queue.length <= 1) {
      return message.reply('⛔ No hay audios en cola para saltar.');
    }

    const player = players.get(guildId);
    if (player) {
      message.reply('⏭️ Saltando al siguiente audio...');
      player.stop();
    } else {
      message.reply('⚠️ No se está reproduciendo ningún audio.');
    }
    return;
  }

  // Comando para detener todo y vaciar la cola
  if (message.content === '!stop') {
    const guildId = message.guild.id;

    const player = players.get(guildId);
    const connection = connections.get(guildId);

    if (player) {
      player.stop();
      players.delete(guildId);
    }

    if (connection) {
      connection.destroy();
      connections.delete(guildId);
    }

    queues.delete(guildId);

    return message.reply('⏹️ Reproducción detenida y cola eliminada.');
  }

  // Reproducir audio si empieza con "!"
  if (message.content.startsWith('!')) {
    const command = message.content.substring(1);
    const audioPath = path.join(__dirname, 'audios', `${command}.mp3`);

    if (!fs.existsSync(audioPath)) {
      return message.reply('❌ No encontré ese audio, probá con otro comando.');
    }

    const voiceChannel = message.member?.voice.channel;
    if (!voiceChannel) {
      return message.reply('🚫 Tenés que estar en un canal de voz para escuchar audios.');
    }

    const guildId = message.guild.id;

    if (!queues.has(guildId)) {
      queues.set(guildId, []);
    }

    const queue = queues.get(guildId);

    queue.push({
      path: audioPath,
      voiceChannel,
      textChannel: message.channel,
      commandName: command
    });

    if (queue.length === 1) {
      playNextInQueue(guildId);
    } else {
      message.reply(`⏳ Audio añadido a la lista de espera: \`${command}.mp3\``);
    }
  }
});

// Función que reproduce el siguiente audio en la cola
async function playNextInQueue(guildId) {
  const queue = queues.get(guildId);
  if (!queue || queue.length === 0) return;

  const { path, voiceChannel, textChannel, commandName } = queue[0];

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  });

  const player = createAudioPlayer();
  const resource = createAudioResource(path);

  player.play(resource);
  connection.subscribe(player);

  players.set(guildId, player);
  connections.set(guildId, connection);

  textChannel.send(`🎙️ Reproduciendo \`${commandName}.mp3\`...`);

  player.on(AudioPlayerStatus.Idle, () => {
    connection.destroy();
    queue.shift();

    if (queue.length > 0) {
      playNextInQueue(guildId);
    } else {
      queues.delete(guildId);
      players.delete(guildId);
      connections.delete(guildId);
    }
  });

  player.on('error', error => {
    console.error(`❌ Error al reproducir ${commandName}: ${error.message}`);
    connection.destroy();
    queue.shift();

    if (queue.length > 0) {
      playNextInQueue(guildId);
    } else {
      queues.delete(guildId);
      players.delete(guildId);
      connections.delete(guildId);
    }
  });
}

client.login(process.env.TOKEN);