import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  Routes,
  REST,
  SlashCommandBuilder
} from 'discord.js';
import { joinVoiceChannel } from '@discordjs/voice';
import express from 'express';
import 'dotenv/config';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

const app = express();
app.get('/', (_, res) => res.send('Bot is alive!'));
app.listen(5000, () => console.log('🌐 Keep-alive server running on port 5000'));

const wait = ms => new Promise(res => setTimeout(res, ms));
const dmedUsers = new Set();

const AUTO_RECONNECT_CHANNEL_ID = '1368359914145058956';
let connection = null;
let shouldAutoReconnect = false;

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// Voice auto-reconnect
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (
    oldState.member?.id === client.user.id &&
    oldState.channelId === AUTO_RECONNECT_CHANNEL_ID &&
    !newState.channelId &&
    shouldAutoReconnect
  ) {
    console.log('🔄 Attempting voice reconnect...');
    await wait(10000);
    try {
      const channel = client.channels.cache.get(AUTO_RECONNECT_CHANNEL_ID);
      if (channel) {
        connection = joinVoiceChannel({
          channelId: AUTO_RECONNECT_CHANNEL_ID,
          guildId: channel.guild.id,
          adapterCreator: channel.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false
        });
        console.log('✅ Voice channel rejoined.');
      }
    } catch (err) {
      console.error('❌ VC reconnect failed:', err);
    }
  }
});

// Slash command registration
client.on('ready', async () => {
  const commands = [
    new SlashCommandBuilder()
      .setName('hostfriendly')
      .setDescription('Host a 7v7 friendly (positions, react-based)')
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('✅ Slash commands registered.');
  } catch (error) {
    console.error('❌ Slash command error:', error);
  }
});

async function startFriendly(channel, author) {
  const announcement = 
    `> #FRIENDLY\n` +
    `> **Match Type:** 7v7\n` +
    `> **Server Region:** NA or any\n` +
    `> **Ping:** @here\n` +
    `> **Trialist Allowed:** ✅\n` +
    `> **Participating in friendly further betters your skills.**\n` +
    `> React with ✅ to accept.\n@here`;

  const announcementMsg = await channel.send({
    content: announcement,
    allowedMentions: { parse: ['here'] }
  });

  await announcementMsg.react('✅');

  let enough = false;
  let collectedUsers = new Set();

  const collector = announcementMsg.createReactionCollector({
    filter: (reaction, user) => reaction.emoji.name === '✅' && !user.bot,
    time: 10 * 60 * 1000
  });

  collector.on('collect', (_, user) => {
    collectedUsers.add(user.id);
    if (collectedUsers.size >= 7 && !enough) {
      enough = true;
      collector.stop();
    }
  });

  // Wait 1 minute before checking
  await wait(60000);

  if (collectedUsers.size < 7) {
    await channel.send('@here — Need more reacts to start the friendly!');
  }

  await wait(9 * 60000); // 9 more minutes

  if (collectedUsers.size < 7) {
    await channel.send('❌ Not enough players reacted. Friendly is cancelled.');
    return;
  }

  await channel.send('✅ Enough players! Starting position selection...');

  const roles = ['GK', 'CB1', 'CB2', 'CM', 'LW', 'RW', 'ST'];
  const claimedUsers = new Set();

  for (const roleName of roles) {
    const roleMsg = await channel.send(roleName);
    await roleMsg.react('✅');

    const rCollector = roleMsg.createReactionCollector({
      filter: (reaction, user) =>
        reaction.emoji.name === '✅' &&
        collectedUsers.has(user.id) &&
        !claimedUsers.has(user.id),
      max: 1,
      time: 60000
    });

    rCollector.on('collect', async (reaction, user) => {
      claimedUsers.add(user.id);
      await roleMsg.edit(`${roleName} - <@${user.id}>`);
    });

    rCollector.on('end', collected => {
      if (collected.size === 0) {
        roleMsg.edit(`${roleName} - OPEN 😃`);
      }
    });
  }
}

// Handle message prefix commands
client.on('messageCreate', async msg => {
  if (!msg.guild || msg.author.bot) return;

  if (msg.mentions.everyone) {
    try {
      await msg.react('✅');
    } catch {}
  }

  if (msg.content === '!hostfriendly') {
    startFriendly(msg.channel, msg.author);
  }
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'hostfriendly') {
    await interaction.reply({ content: 'Hosting friendly...', ephemeral: true });
    startFriendly(interaction.channel, interaction.user);
  }
});

process.on('unhandledRejection', err => console.error('Unhandled:', err));
process.on('uncaughtException', err => console.error('Uncaught:', err));

client.login(process.env.DISCORD_TOKEN);