import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  Events,
} from 'discord.js';
import express from 'express';
import { joinVoiceChannel, entersState, VoiceConnectionStatus } from '@discordjs/voice';
import 'dotenv/config';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

const expressApp = express();
expressApp.get('/', (_, res) => res.send('Bot is alive!'));
expressApp.listen(3000, () => console.log('Express server running'));

const POSITION_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
const POSITIONS = ['GK', 'CB', 'CB2', 'CM', 'LW', 'RW', 'ST'];
const VC_ID = '1368359914145058956';
const sentDMCache = new Set();

// Auto join VC on ready
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const channel = await guild.channels.fetch(VC_ID);
    joinAndStay(channel);
  } catch (e) {
    console.error('VC auto-join failed:', e);
  }
});

// Auto rejoin VC if disconnected
client.on('voiceStateUpdate', (oldState, newState) => {
  if (
    oldState.channelId === VC_ID &&
    newState.channelId !== VC_ID &&
    oldState.member.id === client.user.id
  ) {
    const channel = oldState.guild.channels.cache.get(VC_ID);
    joinAndStay(channel);
  }
});

function joinAndStay(channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfMute: true,
  });

  entersState(connection, VoiceConnectionStatus.Ready, 30_000).catch(console.error);
}

// ✅ React ✅ to @everyone/@here
client.on('messageCreate', (msg) => {
  if (msg.mentions.everyone || msg.content.includes('@here')) {
    msg.react('✅').catch(() => {});
  }
});

// 📢 !dmrole and /dmrole
client.on('messageCreate', async (msg) => {
  if (!msg.content.startsWith('!dmrole')) return;
  if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

  const role = msg.mentions.roles.first();
  const content = msg.content.split(' ').slice(2).join(' ');
  if (!role || !content) return msg.reply('Usage: `!dmrole @role message`');

  msg.reply('DMing role...');

  const failed = [];

  for (const member of role.members.values()) {
    if (sentDMCache.has(member.id)) continue;
    try {
      await member.send(content);
      sentDMCache.add(member.id);
    } catch {
      failed.push(member.user.tag);
    }
  }

  if (failed.length) {
    msg.author.send(`❌ Failed to DM:\n${failed.join('\n')}`).catch(() => {});
  }
});

// 💥 !hostfriendly GK
client.on('messageCreate', async (message) => {
  if (!message.content.toLowerCase().startsWith('!hostfriendly')) return;
  const allowedRoles = ['Friendlies Department'];
  const isAllowed =
    message.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    message.member.roles.cache.some((r) => allowedRoles.includes(r.name));
  if (!isAllowed) return;

  const args = message.content.trim().split(/\s+/);
  const hostPosition = args[1]?.toUpperCase();
  const channel = message.channel;

  let collecting = true;
  const claimedPositions = {};
  const reactedUsers = new Set();

  if (hostPosition && POSITIONS.includes(hostPosition)) {
    const index = POSITIONS.indexOf(hostPosition);
    claimedPositions[index] = message.author;
    reactedUsers.add(message.author.id);
  }

  const embed = new EmbedBuilder()
    .setTitle('**PARMA FC 7v7 FRIENDLY**')
    .setDescription(
      POSITION_EMOJIS.map((emoji, i) => {
        const user = claimedPositions[i];
        return `React ${emoji} → ${POSITIONS[i]} ${user ? `- <@${user.id}> ✅` : ''}`;
      }).join('\n') + '\n\n@here'
    )
    .setColor('Blue');

  const sentMessage = await channel.send({ embeds: [embed] });
  for (const emoji of POSITION_EMOJIS) await sentMessage.react(emoji);

  // 1 Minute -> ping if not full
  setTimeout(async () => {
    if (Object.keys(claimedPositions).length < 7) {
      await channel.send('@here more reacts to get a friendly');
    }
  }, 60_000);

  // 10 Minute -> cancel if not full
  setTimeout(async () => {
    if (Object.keys(claimedPositions).length < 7 && collecting) {
      collecting = false;
      await channel.send('❌ Friendly cancelled.');
    }
  }, 600_000);

  const collector = sentMessage.createReactionCollector({ time: 600_000 });

  collector.on('collect', async (reaction, user) => {
    if (user.bot || !POSITION_EMOJIS.includes(reaction.emoji.name)) return;

    if (reactedUsers.has(user.id)) {
      await reaction.users.remove(user.id);
      return;
    }

    const posIndex = POSITION_EMOJIS.indexOf(reaction.emoji.name);
    if (claimedPositions[posIndex]) {
      await reaction.users.remove(user.id);
      return;
    }

    // Delay to prevent multi-reaction bug
    setTimeout(() => {
      if (!reactedUsers.has(user.id)) {
        claimedPositions[posIndex] = user;
        reactedUsers.add(user.id);
        channel.send(`✅ ${POSITIONS[posIndex]} confirmed for <@${user.id}>`);
        updateEmbed();
      }

      // All positions filled
      if (Object.keys(claimedPositions).length === 7 && collecting) {
        collecting = false;
        const finalLineup = POSITIONS.map((pos, i) => `${pos}: <@${claimedPositions[i].id}>`).join(
          '\n'
        );
        channel.send(`**Final Lineup:**\n${finalLineup}\nFinding friendly, looking for a rob.`);
      }
    }, 3000);
  });

  async function updateEmbed() {
    embed.setDescription(
      POSITION_EMOJIS.map((emoji, i) => {
        const user = claimedPositions[i];
        return `React ${emoji} → ${POSITIONS[i]} ${user ? `- <@${user.id}> ✅` : ''}`;
      }).join('\n') + '\n\n@here'
    );
    await sentMessage.edit({ embeds: [embed] });
  }

  // DM all players when link is posted
  client.on('messageCreate', async (msg) => {
    if (msg.channel.id !== message.channel.id || msg.author.id !== message.author.id) return;
    if (!msg.content.includes('http')) return;

    const dmText = `Here’s the friendly, join up: ${msg.content}`;
    for (const user of Object.values(claimedPositions)) {
      try {
        await user.send(dmText);
      } catch {}
    }
  });
});

client.login(process.env.TOKEN);