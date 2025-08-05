
import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ActivityType,
} from 'discord.js';
import {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import express from 'express';
import 'dotenv/config';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

express()
  .listen(process.env.PORT || 3000, () => console.log('Server is up'));

const VC_ID = '1368359914145058956';
let reconnecting = false;

async function connectVC(guild) {
  const channel = await guild.channels.fetch(VC_ID);
  if (!channel?.isVoiceBased()) return;
  const conn = joinVoiceChannel({
    channelId: VC_ID,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfMute: true,
  });
  await entersState(conn, VoiceConnectionStatus.Ready, 30_000);
  return conn;
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity('Spotify', { type: ActivityType.Listening });
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (guild) await connectVC(guild);
});

client.on('voiceStateUpdate', (oldS, newS) => {
  if (
    oldS.channelId === VC_ID &&
    !newS.channelId &&
    oldS.member.user.id === client.user.id &&
    !reconnecting
  ) {
    reconnecting = true;
    setTimeout(async () => {
      const guild = oldS.guild;
      await connectVC(guild);
      reconnecting = false;
    }, 5000);
  }
});

client.on('messageCreate', async (message) => {
  if (
    !message.author.bot &&
    (message.content.includes('@everyone') || message.content.includes('@here'))
  ) {
    message.react('✅').catch(() => {});
  }

  const [cmd, ...args] = message.content.trim().split(/ +/);
  if (cmd === '!hostfriendly') {
    const canHost =
      message.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      message.member.roles.cache.some((r) => r.name === 'Friendlies Department');
    if (!canHost) return;

    const names = ['GK', 'CB', 'CB2', 'CM', 'LW', 'RW', 'ST'];
    const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
    const positions = {};
    const claimed = new Set();

    const hostPos = args[0]?.toUpperCase();
    const hostIndex = names.indexOf(hostPos);
    if (hostIndex !== -1) {
      positions[emojis[hostIndex]] = message.author;
      claimed.add(message.author.id);
      await message.channel.send(`✅ ${hostPos} confirmed for <@${message.author.id}>`);
    }

    const listText = [
      '**PARMA FC 7v7 FRIENDLY — react to claim a position**',
      '1️⃣ - GK',
      '2️⃣ - CB',
      '3️⃣ - CB2',
      '4️⃣ - CM',
      '5️⃣ - LW',
      '6️⃣ - RW',
      '7️⃣ - ST',
      '@here'
    ].join('\n');

    const sent = await message.channel.send({
      content: listText,
      allowedMentions: { parse: ['everyone'] },
    });

    for (const emoji of emojis) {
      if (!positions[emoji]) await sent.react(emoji);
    }

    const filter = (reaction, user) =>
      emojis.includes(reaction.emoji.name) && !user.bot;

    const collector = sent.createReactionCollector({ filter, time: 600000 });

    collector.on('collect', async (reaction, user) => {
      const emoji = reaction.emoji.name;

      if (positions[emoji]) return reaction.users.remove(user.id);
      if (claimed.has(user.id)) return reaction.users.remove(user.id);

      positions[emoji] = user;
      claimed.add(user.id);

      await message.channel.send(`✅ ${names[emojis.indexOf(emoji)]} confirmed for <@${user.id}>`);

      if (Object.keys(positions).length === 7) collector.stop('filled');
    });

    setTimeout(() => {
      if (Object.keys(positions).length < 7) {
        message.channel.send({
          content: '@here Need more reacts to start the friendly!',
          allowedMentions: { parse: ['everyone'] },
        });
      }
    }, 60000);

    setTimeout(() => {
      if (Object.keys(positions).length < 7) {
        message.channel.send('❌ Friendly cancelled — not enough players.');
        collector.stop();
      }
    }, 600000);

    collector.on('end', async (_, reason) => {
      if (Object.keys(positions).length < 7) return;

      let finalText = '✅ Final Lineup:\n';
      emojis.forEach((emoji, i) => {
        finalText += `${emoji} ${names[i]}: <@${positions[emoji].id}>\n`;
      });

      await message.channel.send(finalText);
      await message.channel.send('✅ Finding friendly, looking for a rob...');
    });
  }
});

client.login(process.env.TOKEN);
