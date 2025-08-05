import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField
} from 'discord.js';
import { joinVoiceChannel, entersState, VoiceConnectionStatus } from '@discordjs/voice';
import express from 'express';
import 'dotenv/config';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const app = express();
app.get('/', (_, res) => res.send('Bot is alive!'));
app.listen(3000, () => console.log('Server running'));

const wait = ms => new Promise(res => setTimeout(res, ms));
const token = process.env.DISCORD_TOKEN;
const voiceChannelId = '1368359914145058956';

const emojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣'];
const positions = ['GK','CB','CB2','CM','LW','RW','ST'];
const active = new Set();

// === VOICE CONNECTION ===
async function connectToVC(guild) {
  try {
    const channel = guild.channels.cache.get(voiceChannelId);
    if (!channel || channel.type !== 2) return;
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfMute: true
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    console.log('🔊 Connected to VC');
  } catch (err) {
    console.error('Failed to join VC:', err);
  }
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.first();
  if (guild) await connectToVC(guild);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  if (
    oldState.channelId === voiceChannelId &&
    !newState.channelId &&
    oldState.member?.user.id === client.user.id
  ) {
    await wait(5000);
    await connectToVC(oldState.guild);
  }
});

// === FRIENDLY HOSTING ===
async function runHostFriendly(channel, hostMember, hostPositionInput) {
  const hasPermission =
    hostMember.permissions.has(PermissionsBitField.Flags.Administrator) ||
    hostMember.roles.cache.some(r => r.name === 'Friendlies Department');

  if (!hasPermission) {
    await channel.send('❌ Only Admins or members of **Friendlies Department** can host.');
    return;
  }

  if (active.has(channel.id)) {
    await channel.send('❌ A friendly is already being hosted in this channel.');
    return;
  }

  const positionIndex = positions.findIndex(p => p.toLowerCase() === hostPositionInput?.toLowerCase());
  if (hostPositionInput && positionIndex === -1) {
    await channel.send(`❌ Invalid position. Valid positions: ${positions.join(', ')}`);
    return;
  }

  active.add(channel.id);
  const claimed = new Map();
  const claimedUsers = new Set();

  if (positionIndex !== -1) {
    claimed.set(positionIndex, hostMember.id);
    claimedUsers.add(hostMember.id);
  }

  const formatMessage = () => {
    return (
      `**PARMA FC 7v7 FRIENDLY**\n\n` +
      emojis.map((emoji, i) => {
        const userId = claimed.get(i);
        return `${emoji} ${positions[i]} - ${userId ? `<@${userId}>` : 'Unclaimed'}`;
      }).join('\n')
    );
  };

  const ann = await channel.send(formatMessage());
  for (const emoji of emojis) await ann.react(emoji);

  let done = claimed.size >= 7;

  const collector = ann.createReactionCollector({ time: 10 * 60_000 });

  collector.on('collect', async (reaction, user) => {
    if (user.bot || done) return;

    const emoji = reaction.emoji.name;
    const idx = emojis.indexOf(emoji);
    if (idx === -1) return;

    if (claimed.has(idx)) {
      reaction.users.remove(user.id).catch(() => {});
      return;
    }

    if (claimedUsers.has(user.id)) {
      reaction.users.remove(user.id).catch(() => {});
      return;
    }

    setTimeout(async () => {
      if (claimed.has(idx) || claimedUsers.has(user.id)) return;
      claimed.set(idx, user.id);
      claimedUsers.add(user.id);
      await ann.edit(formatMessage());

      if (claimed.size >= 7 && !done) {
        done = true;
        collector.stop('filled');
      }
    }, 3000);
  });

  collector.on('end', async () => {
    if (!done || claimed.size < 7) {
      await channel.send('❌ Not enough players reacted. Friendly cancelled.');
      active.delete(channel.id);
      return;
    }

    const finalList = emojis.map((emoji, i) => {
      const userId = claimed.get(i);
      return `${positions[i]} — ${userId ? `<@${userId}>` : 'OPEN'}`;
    });

    await channel.send('✅ Final Positions:\n' + finalList.join('\n'));

    const filter = msg =>
      msg.author.id === hostMember.id &&
      msg.channel.id === channel.id &&
      msg.content.includes('https://');

    const linkCollector = channel.createMessageCollector({ filter, time: 5 * 60_000, max: 1 });

    linkCollector.on('collect', async msg => {
      const link = msg.content.trim();
      for (const uid of claimed.values()) {
        try {
          const u = await client.users.fetch(uid);
          await u.send(`<@${uid}>`);
          await u.send(`Here’s the friendly, join up: ${link}`);
        } catch {
          console.error('❌ Failed to DM', uid);
        }
      }
      await channel.send('✅ DMs sent to all players!');
      active.delete(channel.id);
    });

    linkCollector.on('end', collected => {
      if (collected.size === 0) {
        channel.send('❌ No link received—friendly not shared.');
        active.delete(channel.id);
      }
    });
  });
}

// === PREFIX COMMANDS ===
client.on('messageCreate', async msg => {
  if (msg.author.bot) return;

  if (msg.content.startsWith('!hostfriendly')) {
    const args = msg.content.split(' ');
    const pos = args[1];
    await runHostFriendly(msg.channel, msg.member, pos);
  }

  if (msg.content === '!joinvc') {
    await connectToVC(msg.guild);
    msg.channel.send('🔊 Joining VC...');
  }
});

client.login(token);
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);