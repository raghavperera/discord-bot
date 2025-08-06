import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  Collection
} from 'discord.js';
import { joinVoiceChannel, entersState, VoiceConnectionStatus } from '@discordjs/voice';
import express from 'express';
import { config } from 'dotenv';
import play from 'play-dl';

config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;
const CHANNEL_ID = '1368359914145058956'; // Replace with your VC ID
let connection;

// ===== EXPRESS SERVER TO STAY ONLINE =====
const app = express();
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(PORT, () => console.log(`Uptime server running on port ${PORT}`));

// ===== MUSIC PLAYER =====
const queue = new Map();

client.on('messageCreate', async message => {
  if (!message.content.startsWith('!') || message.author.bot) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const serverQueue = queue.get(message.guild.id);

  if (command === 'play') {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('Join a VC first!');
    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has(PermissionsBitField.Flags.Connect) || !permissions.has(PermissionsBitField.Flags.Speak)) {
      return message.reply('Missing permissions to join or speak in VC.');
    }

    const songInfo = await play.search(args.join(''), { limit: 1 });
    if (!songInfo[0]) return message.reply('No song found.');
    const song = { title: songInfo[0].title, url: songInfo[0].url };

    if (!serverQueue) {
      const queueContruct = {
        voiceChannel,
        connection: null,
        songs: [],
        playing: true,
        loop: false
      };
      queue.set(message.guild.id, queueContruct);
      queueContruct.songs.push(song);

      try {
        const conn = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: voiceChannel.guild.id,
          adapterCreator: voiceChannel.guild.voiceAdapterCreator,
          selfDeaf: false
        });
        queueContruct.connection = conn;
        playSong(message.guild, queueContruct.songs[0]);
      } catch (err) {
        console.error(err);
        queue.delete(message.guild.id);
        return message.reply('Error joining VC.');
      }
    } else {
      serverQueue.songs.push(song);
      return message.reply(`Added to queue: ${song.title}`);
    }
  }

  if (command === 'skip') {
    if (!serverQueue) return message.reply('No song to skip.');
    serverQueue.connection.destroy();
    queue.delete(message.guild.id);
    return message.reply('Skipped.');
  }

  if (command === 'stop') {
    if (!serverQueue) return message.reply('Queue is empty.');
    serverQueue.connection.destroy();
    queue.delete(message.guild.id);
    return message.reply('Stopped.');
  }

  if (command === 'loop') {
    if (!serverQueue) return message.reply('No song playing.');
    serverQueue.loop = !serverQueue.loop;
    return message.reply(`Loop is now ${serverQueue.loop ? 'enabled' : 'disabled'}.`);
  }

  if (command === 'queue') {
    if (!serverQueue) return message.reply('Queue is empty.');
    return message.reply(serverQueue.songs.map((s, i) => `${i + 1}. ${s.title}`).join('\n'));
  }
});

async function playSong(guild, song) {
  const serverQueue = queue.get(guild.id);
  if (!song) {
    serverQueue.connection.destroy();
    queue.delete(guild.id);
    return;
  }

  const stream = await play.stream(song.url);
  const resource = (await import('@discordjs/voice')).createAudioResource(stream.stream, { inputType: stream.type });
  const player = (await import('@discordjs/voice')).createAudioPlayer();

  player.play(resource);
  serverQueue.connection.subscribe(player);

  player.on('idle', () => {
    if (serverQueue.loop) {
      playSong(guild, song);
    } else {
      serverQueue.songs.shift();
      playSong(guild, serverQueue.songs[0]);
    }
  });
}

// ===== JOIN VC AND STAY CONNECTED =====
async function connectToVC() {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const channel = await guild.channels.fetch(CHANNEL_ID);
  connection = joinVoiceChannel({
    channelId: CHANNEL_ID,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true
  });
  entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  console.log(`Connected to VC ${channel.name}`);
}

client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await connectToVC();
  setInterval(async () => {
    if (!connection || connection.state.status === VoiceConnectionStatus.Disconnected) {
      await connectToVC();
    }
  }, 30_000);
});

// ===== REACT ✅ TO @everyone or @here =====
client.on('messageCreate', async message => {
  if (message.mentions.everyone) {
    try {
      await message.react('✅');
    } catch (e) {
      console.error('Failed to react:', e);
    }
  }
});

// ===== SLASH + PREFIX !dmrole COMMAND =====
import { REST, Routes, SlashCommandBuilder } from 'discord.js';
const dmRoleCache = new Set();

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'dmrole') {
    const role = interaction.options.getRole('role');
    const msg = interaction.options.getString('message');
    const members = role.members.filter(m => !m.user.bot);

    await interaction.reply(`Dming ${members.size} users in ${role.name}...`);
    const failed = [];

    for (const member of members.values()) {
      if (dmRoleCache.has(member.id)) continue;
      try {
        await member.send(msg);
        dmRoleCache.add(member.id);
      } catch {
        failed.push(`<@${member.id}>`);
      }
    }

    const log = failed.length ? `Failed to DM:\n${failed.join('\n')}` : 'All DMs sent.';
    await interaction.user.send(log).catch(() => {});
  }
});

client.on('messageCreate', async message => {
  if (!message.content.startsWith('!dmrole') || message.author.bot) return;
  const [_, roleMention, ...msgParts] = message.content.split(' ');
  const msg = msgParts.join(' ');
  const roleId = roleMention.replace(/[<@&>]/g, '');
  const role = message.guild.roles.cache.get(roleId);
  if (!role) return message.reply('Role not found.');

  const members = role.members.filter(m => !m.user.bot);
  message.reply(`Dming ${members.size} users...`);

  const failed = [];
  for (const member of members.values()) {
    if (dmRoleCache.has(member.id)) continue;
    try {
      await member.send(msg);
      dmRoleCache.add(member.id);
    } catch {
      failed.push(`<@${member.id}>`);
    }
  }

  const log = failed.length ? `Failed to DM:\n${failed.join('\n')}` : 'All DMs sent.';
  await message.author.send(log).catch(() => {});
});

// ===== REGISTER SLASH COMMAND =====
const commands = [
  new SlashCommandBuilder()
    .setName('dmrole')
    .setDescription('DM all users in a role')
    .addRoleOption(opt => opt.setName('role').setDescription('Role').setRequired(true))
    .addStringOption(opt => opt.setName('message').setDescription('Message to send').setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands }).catch(console.error);

// ====== ADD YOUR HOSTFRIENDLY COMMAND HERE NEXT (next message to continue) ======
import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder
} from 'discord.js';
import { joinVoiceChannel } from '@discordjs/voice';
import express from 'express';
import 'dotenv/config';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const app = express();
app.get('/', (_, res) => res.send('Bot is running'));
app.listen(3000, () => console.log('Express server is alive'));

const POSITION_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
const POSITION_NAMES = ['GK', 'CB', 'CB2', 'CM', 'LW', 'RW', 'ST'];

const POSITION_MAP = {};
for (let i = 0; i < POSITION_EMOJIS.length; i++) {
  POSITION_MAP[POSITION_EMOJIS[i]] = POSITION_NAMES[i];
}

const allowedRoles = ['Friendlies Department', 'Admin'];
const claimedPositions = {};
const reactedUsers = new Set();
let collecting = false;

client.on('messageCreate', async (message) => {
  if (!message.content.toLowerCase().startsWith('!hostfriendly') || !message.guild) return;

  const member = await message.guild.members.fetch(message.author.id);
  if (!member.roles.cache.some(role => allowedRoles.includes(role.name))) return message.reply('You don’t have permission to host.');

  if (collecting) return message.reply('A friendly is already being hosted. Please wait.');

  collecting = true;
  const args = message.content.trim().split(/ +/);
  const hostPosition = args[1]?.toUpperCase();

  const embed = new EmbedBuilder()
    .setTitle('**PARMA FC 7v7 FRIENDLY**')
    .setDescription(
      POSITION_NAMES.map((pos, idx) => `React ${POSITION_EMOJIS[idx]} → ${pos}: ${claimedPositions[pos] ? `<@${claimedPositions[pos]}>` : '---'}`).join('\n') + `\n\n@here`
    )
    .setColor('#0099ff');

  const friendlyMessage = await message.channel.send({ content: '@here', embeds: [embed] });
  for (const emoji of POSITION_EMOJIS) {
    await friendlyMessage.react(emoji);
  }

  if (hostPosition && POSITION_NAMES.includes(hostPosition)) {
    claimedPositions[hostPosition] = message.author.id;
    reactedUsers.add(message.author.id);
    await message.channel.send(`✅ ${hostPosition} confirmed for <@${message.author.id}>`);
    await updateEmbed(friendlyMessage);
  }

  const collector = friendlyMessage.createReactionCollector({ time: 10 * 60 * 1000 });

  collector.on('collect', async (reaction, user) => {
    if (user.bot) return;
    if (!POSITION_MAP[reaction.emoji.name]) return;
    if (reactedUsers.has(user.id)) {
      await reaction.users.remove(user.id);
      return;
    }

    const position = POSITION_MAP[reaction.emoji.name];

    if (claimedPositions[position]) return;

    setTimeout(async () => {
      if (!reactedUsers.has(user.id)) {
        claimedPositions[position] = user.id;
        reactedUsers.add(user.id);
        await message.channel.send(`✅ ${position} confirmed for <@${user.id}>`);
        await updateEmbed(friendlyMessage);
      }
    }, 3000);
  });

  let reminderSent = false;
  const interval = setInterval(async () => {
    const count = Object.keys(claimedPositions).length;
    if (count >= 7) {
      collector.stop();
      clearInterval(interval);
      const finalLineup = POSITION_NAMES.map(pos => `${pos}: ${claimedPositions[pos] ? `<@${claimedPositions[pos]}>` : '---'}`).join('\n');
      await message.channel.send(`**Final Lineup:**\n${finalLineup}\nFinding friendly, looking for a rob.`);
    } else if (!reminderSent && Date.now() - friendlyMessage.createdTimestamp >= 60 * 1000) {
      reminderSent = true;
      await message.channel.send('@here More reacts to get a friendly!');
    } else if (Date.now() - friendlyMessage.createdTimestamp >= 10 * 60 * 1000) {
      collector.stop();
      clearInterval(interval);
      await message.channel.send('❌ Friendly cancelled. Not enough players.');
      collecting = false;
    }
  }, 5000);

  client.on('messageCreate', async (linkMsg) => {
    if (linkMsg.channel.id === message.channel.id && linkMsg.content.includes('http')) {
      const claimedUsers = Object.values(claimedPositions);
      for (const userId of claimedUsers) {
        try {
          const user = await client.users.fetch(userId);
          await user.send("Here’s the friendly, join up.\n" + linkMsg.content);
        } catch {
          console.log(`Could not DM ${userId}`);
        }
      }
    }
  });

  async function updateEmbed(msg) {
    embed.setDescription(
      POSITION_NAMES.map((pos, idx) => `React ${POSITION_EMOJIS[idx]} → ${pos}: ${claimedPositions[pos] ? `<@${claimedPositions[pos]}>` : '---'}`).join('\n') + `\n\n@here`
    );
    await msg.edit({ embeds: [embed] });
  }
});

client.login(process.env.TOKEN);