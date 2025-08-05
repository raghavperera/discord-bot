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
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Keep-alive express server
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('Bot is alive!'));
app.listen(port, () => console.log(`Server running on port ${port}`));

// Auto-VC reconnect
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
    console.error('VC connection failed:', err);
  }
});

// ✅ emoji react on @everyone/@here
client.on('messageCreate', async message => {
  if (message.content.includes('@everyone') || message.content.includes('@here')) {
    try {
      await message.react('✅');
    } catch (err) {
      console.error('React fail:', err);
    }
  }

  // !hostfriendly command
  if (!message.content.startsWith('!hostfriendly') || message.author.bot) return;

  if (
    !message.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
    !message.member.roles.cache.some(r => r.name === 'Friendlies Department')
  ) {
    return message.channel.send('❌ Only Admins or Friendlies Department can host.');
  }

  const positions = {
    '1️⃣': 'GK',
    '2️⃣': 'CB',
    '3️⃣': 'CB2',
    '4️⃣': 'CM',
    '5️⃣': 'LW',
    '6️⃣': 'RW',
    '7️⃣': 'ST'
  };

  const confirmed = {}; // emoji -> user
  const userClaimed = new Set();

  const sent = await message.channel.send('@here React to claim your position! (1️⃣–7️⃣)');

  // React with all emojis
  for (const emoji of Object.keys(positions)) {
    await sent.react(emoji);
  }

  const filter = (reaction, user) =>
    Object.keys(positions).includes(reaction.emoji.name) && !user.bot;

  const collector = sent.createReactionCollector({ filter, time: 600_000 });

  collector.on('collect', async (reaction, user) => {
    const emoji = reaction.emoji.name;

    // If position already claimed
    if (confirmed[emoji]) {
      await reaction.users.remove(user.id);
      return;
    }

    // If user already claimed another position
    if (userClaimed.has(user.id)) {
      await reaction.users.remove(user.id);
      return;
    }

    // Lock in user for this emoji
    confirmed[emoji] = user;
    userClaimed.add(user.id);

    await message.channel.send(`✅ ${positions[emoji]} confirmed for <@${user.id}>`);

    // End if all 7 positions are filled
    if (Object.keys(confirmed).length === 7) {
      collector.stop('filled');
    }
  });

  collector.on('end', async (_, reason) => {
    if (Object.keys(confirmed).length < 7) {
      return message.channel.send('❌ Friendly cancelled — not enough players after 10 minutes.');
    }

    let finalText = '✅ Final Lineup:\n';
    for (const emoji of Object.keys(positions)) {
      const pos = positions[emoji];
      const user = confirmed[emoji];
      finalText += `${emoji} ${pos}: <@${user.id}>\n`;
    }

    await message.channel.send(finalText);
    await message.channel.send('✅ Finding friendly, looking for a rob...');
  });
});

client.login(process.env.TOKEN);