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

// Keep-alive server
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('Bot is alive!'));
app.listen(port, () => console.log(`Server running on port ${port}`));

// VC reconnect
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
    console.error('Error joining VC:', err);
  }
});

// Auto ✅ on @everyone/@here
client.on('messageCreate', async message => {
  if (message.content.includes('@everyone') || message.content.includes('@here')) {
    try {
      await message.react('✅');
    } catch (err) {
      console.error('Failed to react:', err);
    }
  }

  if (!message.content.startsWith('!hostfriendly') || message.author.bot) return;

  const args = message.content.split(' ');
  const hostPosition = args[1]?.toUpperCase();
  const positions = ['GK', 'CB', 'CB2', 'CM', 'LW', 'RW', 'ST'];
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
  const confirmed = [];

  if (
    !message.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
    !message.member.roles.cache.some(r => r.name === 'Friendlies Department')
  ) {
    return message.channel.send('❌ Only Admins or Friendlies Department can host.');
  }

  const embed = new EmbedBuilder()
    .setTitle('Parma FC Friendly — Confirmed Slots')
    .setDescription('React with 1️⃣ to 7️⃣ to claim a slot.\n\nFirst 7 unique users to react will be locked in.')
    .setColor(0x00AE86);

  const sent = await message.channel.send({
    content: '@here Confirm your slot by reacting!',
    embeds: [embed]
  });

  for (const emoji of emojis) {
    await sent.react(emoji);
  }

  const filter = (reaction, user) =>
    emojis.includes(reaction.emoji.name) && !user.bot;

  const collector = sent.createReactionCollector({ filter, time: 600_000 });

  collector.on('collect', async (reaction, user) => {
    if (confirmed.find(u => u.id === user.id)) {
      await reaction.users.remove(user.id); // already confirmed
      return;
    }

    if (confirmed.length >= 7) {
      await reaction.users.remove(user.id); // full
      return;
    }

    confirmed.push({ user, time: Date.now() });
    console.log(`Confirmed: ${user.tag}`);

    if (confirmed.length === 7) collector.stop('filled');
  });

  collector.on('end', async (_, reason) => {
    if (confirmed.length < 7) {
      return message.channel.send('❌ Friendly cancelled — not enough players after 10 minutes.');
    }

    const finalEmbed = new EmbedBuilder()
      .setTitle('✅ Final Lineup for Parma FC')
      .setDescription(
        confirmed
          .slice(0, 7)
          .map((entry, index) => `${emojis[index]} ${positions[index]}: <@${entry.user.id}>`)
          .join('\n')
      )
      .setColor(0x00AE86);

    await message.channel.send({ embeds: [finalEmbed] });
    await message.channel.send('✅ Finding friendly, looking for a rob...');
  });
});

client.login(process.env.TOKEN);