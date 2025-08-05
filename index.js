import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder
} from 'discord.js';
import { joinVoiceChannel, entersState, VoiceConnectionStatus } from '@discordjs/voice';
import express from 'express';
import 'dotenv/config';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Keep-alive Express server
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('Bot is alive!'));
app.listen(port, () => console.log(`Server running on port ${port}`));

// VC join logic
const channelToJoin = '1368359914145058956';
let currentVC;

client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const channel = await guild.channels.fetch(channelToJoin);
    if (channel && channel.isVoiceBased()) {
      currentVC = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfMute: true
      });
      entersState(currentVC, VoiceConnectionStatus.Ready, 30_000);
    }
  } catch (err) {
    console.error('Error joining voice channel:', err);
  }
});

// Auto ✅ reaction to @everyone or @here
client.on('messageCreate', async (message) => {
  if (message.content.includes('@everyone') || message.content.includes('@here')) {
    try {
      await message.react('✅');
    } catch (err) {
      console.error('Failed to react to ping:', err);
    }
  }

  // !hostfriendly command for Parma FC
  if (!message.content.startsWith('!hostfriendly') || message.author.bot) return;

  const args = message.content.split(' ');
  const hostPosition = args[1]?.toUpperCase();
  const positions = ['GK', 'CB', 'CB2', 'CM', 'LW', 'RW', 'ST'];
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
  const positionMap = {};
  const claimed = new Map();

  if (
    !message.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
    !message.member.roles.cache.some(r => r.name === 'Friendlies Department')
  ) {
    return message.channel.send('❌ Only Admins or members of **Friendlies Department** can host.');
  }

  if (hostPosition && !positions.includes(hostPosition)) {
    return message.channel.send(`❌ Invalid position. Choose one of: ${positions.join(', ')}`);
  }

  const hostIndex = hostPosition ? positions.indexOf(hostPosition) : -1;
  if (hostIndex !== -1) {
    positionMap[emojis[hostIndex]] = message.author;
    claimed.set(message.author.id, emojis[hostIndex]);
  }

  const createEmbed = () =>
    new EmbedBuilder()
      .setTitle('Parma FC Friendly Positions')
      .setDescription(positions.map((pos, i) => {
        const emoji = emojis[i];
        const user = positionMap[emoji];
        return `${emoji} ${pos}: ${user ? `<@${user.id}>` : 'Unclaimed'}`;
      }).join('\n'))
      .setColor(0x00AE86);

  const sent = await message.channel.send({
    content: '@here React to claim a position!',
    embeds: [createEmbed()]
  });

  for (const emoji of emojis) {
    if (!positionMap[emoji]) await sent.react(emoji);
  }

  const filter = (reaction, user) => emojis.includes(reaction.emoji.name) && !user.bot;
  const collector = sent.createReactionCollector({ filter, time: 600_000 });

  collector.on('collect', async (reaction, user) => {
    if (claimed.has(user.id)) {
      await reaction.users.remove(user.id);
      return;
    }

    const emoji = reaction.emoji.name;
    if (positionMap[emoji]) {
      await reaction.users.remove(user.id);
      return;
    }

    const userReactions = sent.reactions.cache.filter(r => r.users.cache.has(user.id));
    for (const r of userReactions.values()) {
      if (r.emoji.name !== emoji) {
        await r.users.remove(user.id);
      }
    }

    positionMap[emoji] = user;
    claimed.set(user.id, emoji);

    await sent.edit({ embeds: [createEmbed()] });

    if (claimed.size === 7) {
      collector.stop('filled');
    }
  });

  setTimeout(() => {
    if (claimed.size < 7) {
      message.channel.send('❌ Friendly cancelled — not enough players after 10 minutes.');
      collector.stop('timeout');
    }
  }, 600_000);

  collector.on('end', async (_, reason) => {
    if (reason !== 'filled') return;

    const finalEmbed = new EmbedBuilder()
      .setTitle('Final Lineup for Parma FC')
      .setDescription(positions.map((pos, i) => {
        const emoji = emojis[i];
        const user = positionMap[emoji];
        return `${emoji} ${pos}: ${user ? `<@${user.id}>` : 'Unclaimed'}`;
      }).join('\n'))
      .setColor(0x00AE86);

    await message.channel.send({ embeds: [finalEmbed] });
    await message.channel.send('✅ Finding friendly, looking for a rob...');
  });}

  // Helper to build the embed
  const createEmbed = () =>
    new EmbedBuilder()
      .setTitle('Parma FC Friendly Positions')
      .setDescription(positions.map((pos, i) => {
        const emoji = emojis[i];
        const user = positionMap[emoji];
        return `${emoji} ${pos}: ${user ? `<@${user.id}>` : 'Unclaimed'}`;
      }).join('\n'))
      .setColor(0x00AE86);

  // Send initial embed with allowedMentions
  const sent = await message.channel.send({
    content: 'React to claim a position!',
    embeds: [createEmbed()],
    allowedMentions: { users: [] }
  });

  // React with number emojis
  for (const emoji of emojis) {
    if (!positionMap[emoji]) await sent.react(emoji);
  }

  const filter = (reaction, user) =>
    emojis.includes(reaction.emoji.name) && !user.bot;

  const collector = sent.createReactionCollector({ filter, time: 600_000 });

  collector.on('collect', async (reaction, user) => {
    // Prevent multiple positions per user
    if (claimed.has(user.id)) {
      await reaction.users.remove(user.id);
      return;
    }

    const emoji = reaction.emoji.name;
    // Prevent claiming an already taken spot
    if (positionMap[emoji]) {
      await reaction.users.remove(user.id);
      return;
    }

    // Remove any other reactions by this user
    const userReactions = sent.reactions.cache.filter(r => r.users.cache.has(user.id));
    for (const r of userReactions.values()) {
      if (r.emoji.name !== emoji) {
        await r.users.remove(user.id);
      }
    }

    positionMap[emoji] = user;
    claimed.set(user.id, emoji);

    // Edit embed with allowedMentions so pings show up
    await sent.edit({
      embeds: [createEmbed()],
      allowedMentions: { users: [] }
    });

    if (claimed.size === 7) {
      collector.stop('filled');
    }
  });

  // Cancel if not filled after 10 minutes
  setTimeout(() => {
    if (claimed.size < 7) {
      message.channel.send('❌ Friendly cancelled — not enough players after 10 minutes.');
      collector.stop('timeout');
    }
  }, 600_000);
});

client.login(process.env.TOKEN);