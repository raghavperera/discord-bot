
import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  Routes,
  REST
} from 'discord.js';
import { joinVoiceChannel, entersState, VoiceConnectionStatus } from '@discordjs/voice';
import express from 'express';
import play from 'play-dl';
import 'dotenv/config';

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
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const failedDMs = new Map();
const dmCache = new Set();
const voiceChannelId = '1368359914145058956';
let currentConnection;

// Express server to keep bot alive
const app = express();
app.get('/', (_, res) => res.send('Bot is alive!'));
app.listen(3000, () => console.log('Express server is running.'));

// Reconnect to voice channel on startup
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = guild.channels.cache.get(voiceChannelId);
  if (channel && channel.isVoiceBased()) {
    connectToVC(channel);
  }
});

function connectToVC(channel) {
  currentConnection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfMute: true
  });

  currentConnection.on('stateChange', async (_, newState) => {
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      try {
        await entersState(currentConnection, VoiceConnectionStatus.Connecting, 5000);
      } catch {
        connectToVC(channel);
      }
    }
  });
}

// ✅ auto-react to @everyone or @here
client.on('messageCreate', async message => {
  if ((message.content.includes('@everyone') || message.content.includes('@here')) && !message.author.bot) {
    try {
      await message.react('✅');
    } catch {}
  }
});

// !dmrole and /dmrole command
client.on('messageCreate', async message => {
  if (message.content.startsWith('!dmrole') && !message.author.bot) {
    const args = message.content.split(' ').slice(1);
    const roleMention = message.mentions.roles.first();
    const content = args.slice(1).join(' ');
    if (!roleMention) return message.reply('Please mention a role to DM.');

    const members = roleMention.members.filter(m => !m.user.bot);
    const failed = [];

    await message.reply(`DMing ${members.size} users...`);
    for (const member of members.values()) {
      if (dmCache.has(member.id)) continue;
      try {
        await member.send(content);
        dmCache.add(member.id);
      } catch {
        failed.push(`<@${member.id}>`);
      }
    }

    if (failed.length > 0) {
      await message.author.send(`❌ Failed to DM:
${failed.join('
')}`);
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'dmrole') {
    const role = interaction.options.getRole('role');
    const content = interaction.options.getString('message');
    const members = role.members.filter(m => !m.user.bot);
    const failed = [];

    await interaction.reply({ content: 'DMing role...', ephemeral: true });
    for (const member of members.values()) {
      if (dmCache.has(member.id)) continue;
      try {
        await member.send(content);
        dmCache.add(member.id);
      } catch {
        failed.push(`<@${member.id}>`);
      }
    }

    if (failed.length > 0) {
      await interaction.user.send(`❌ Failed to DM:
${failed.join('
')}`);
    }
  }
});

// !hostfriendly for Parma FC
client.on('messageCreate', async message => {
  if (!message.content.startsWith('!hostfriendly') || message.author.bot) return;
  const args = message.content.split(' ');
  const hostPosition = args[1]?.toUpperCase();
  const allowedRoles = ['Admin', 'Friendlies Department'];
  const hasPermission = message.member.roles.cache.some(role => allowedRoles.includes(role.name));
  if (!hasPermission) return message.reply('You are not allowed to host.');

  const positions = ['GK', 'CB', 'CB2', 'CM', 'LW', 'RW', 'ST'];
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
  const claimed = {};
  const emojiMap = {};

  const embed = new EmbedBuilder()
    .setTitle('**PARMA FC 7v7 FRIENDLY**')
    .setDescription(emojis.map((e, i) => `React ${e} → ${positions[i]}`).join('
') + '
@here')
    .setColor(0x00AE86);

  const msg = await message.channel.send({ content: '@here', embeds: [embed] });
  emojis.forEach(e => msg.react(e));

  if (hostPosition && positions.includes(hostPosition)) {
    const index = positions.indexOf(hostPosition);
    claimed[positions[index]] = message.author.id;
    await msg.channel.send(`✅ ${hostPosition} confirmed for <@${message.author.id}>`);
  }

  const filter = (reaction, user) => emojis.includes(reaction.emoji.name) && !user.bot;
  const collector = msg.createReactionCollector({ filter, time: 10 * 60 * 1000 });

  collector.on('collect', async (reaction, user) => {
    const position = positions[emojis.indexOf(reaction.emoji.name)];
    if (Object.values(claimed).includes(user.id)) return reaction.users.remove(user);

    if (!claimed[position]) {
      await new Promise(res => setTimeout(res, 3000));
      if (!Object.values(claimed).includes(user.id)) {
        claimed[position] = user.id;
        await msg.channel.send(`✅ ${position} confirmed for <@${user.id}>`);
      }
    }
    const desc = emojis.map((e, i) => `React ${e} → ${positions[i]} ${claimed[positions[i]] ? `- <@${claimed[positions[i]]}>` : ''}`).join('
') + '
@here';
    embed.setDescription(desc);
    msg.edit({ embeds: [embed] });
  });

  setTimeout(() => {
    const totalClaims = Object.keys(claimed).length;
    if (totalClaims < 7) {
      msg.channel.send('@here more reacts to get a friendly');
    }
  }, 60 * 1000);

  collector.on('end', async () => {
    const totalClaims = Object.keys(claimed).length;
    if (totalClaims < 7) {
      msg.channel.send('❌ Friendly cancelled.');
    } else {
      const finalLineup = positions.map(pos => `${pos}: <@${claimed[pos]}>`).join('
');
      msg.channel.send(`**FINAL LINEUP**
${finalLineup}
Finding friendly, looking for a rob`);

      const linkCollector = msg.channel.createMessageCollector({ filter: m => m.author.id === message.author.id, time: 600000 });
      linkCollector.on('collect', async linkMsg => {
        if (linkMsg.content.includes('roblox.com')) {
          for (const userId of Object.values(claimed)) {
            try {
              const user = await client.users.fetch(userId);
              await user.send("Here’s the friendly, join up:
" + linkMsg.content);
            } catch {}
          }
          linkCollector.stop();
        }
      });
    }
  });
});

// Register slash commands (for /dmrole)
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: [{
        name: 'dmrole',
        description: 'DM all members in a role',
        options: [
          {
            name: 'role',
            description: 'Role to DM',
            type: 8,
            required: true
          },
          {
            name: 'message',
            description: 'Message to send',
            type: 3,
            required: true
          }
        ]
      }]
    });
    console.log('Slash command registered.');
  } catch (err) {
    console.error(err);
  }
})();

client.login(TOKEN);
