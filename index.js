import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField,
  REST,
  Routes,
} from 'discord.js';
import {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} from '@discordjs/voice';
import express from 'express';
import dotenv from 'dotenv';
import play from 'play-dl';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const app = express();
app.get('/', (_, res) => res.send('Bot is running!'));
app.listen(process.env.PORT || 3000, () => console.log('Express server running'));

// Constants
const VOICE_CHANNEL_ID = '1368359914145058956'; // Your VC ID here
let voiceConnection;
const sentDMs = new Set();
const musicQueues = new Map(); // guildId => { connection, player, queue, current, loop, textChannel }

// Auto join VC and keep reconnecting
async function connectToVC(channelId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== 2) return;

  voiceConnection = joinVoiceChannel({
    channelId,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfMute: true,
  });

  voiceConnection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await entersState(voiceConnection, VoiceConnectionStatus.Connecting, 5_000);
    } catch {
      setTimeout(() => connectToVC(channelId), 5_000);
    }
  });

  console.log(`Connected to voice channel ${channelId}`);
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  connectToVC(VOICE_CHANNEL_ID);
});

// Auto react ✅ to @everyone/@here
client.on('messageCreate', async (msg) => {
  if (msg.mentions.everyone || msg.content.includes('@here')) {
    try {
      await msg.react('✅');
    } catch (e) {
      console.error('Failed to react:', e);
    }
  }
});

// ======== !dmrole command ========
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!dmrole') || message.author.bot) return;
  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

  const role = message.mentions.roles.first();
  if (!role) return message.reply('Usage: !dmrole @role message here');

  const dmText = message.content.split(' ').slice(2).join(' ');
  if (!dmText) return message.reply('Please provide a message to send.');

  const failed = [];
  message.reply(`Sending DMs to ${role.members.size} users...`);
  for (const member of role.members.values()) {
    if (member.user.bot) continue;
    if (sentDMs.has(member.id)) continue;
    try {
      await member.send(dmText);
      sentDMs.add(member.id);
    } catch {
      failed.push(member.user.tag);
    }
  }
  if (failed.length)
    message.author.send(`Failed to DM:\n${failed.join('\n')}`).catch(() => null);
});

// ======== Slash command /dmrole ========
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
client.once('ready', async () => {
  try {
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: [
        {
          name: 'dmrole',
          description: 'DM all users in a role',
          options: [
            {
              name: 'role',
              type: 8, // Role
              description: 'Role to DM',
              required: true,
            },
            {
              name: 'message',
              type: 3, // String
              description: 'Message content',
              required: true,
            },
          ],
        },
      ],
    });
    console.log('Slash command /dmrole registered');
  } catch (e) {
    console.error('Failed to register slash command:', e);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'dmrole') return;

  const role = interaction.options.getRole('role');
  const message = interaction.options.getString('message');

  await interaction.reply({ content: 'Dming role...', ephemeral: true });

  const failed = [];
  for (const member of role.members.values()) {
    if (member.user.bot) continue;
    if (sentDMs.has(member.id)) continue;
    try {
      await member.send(message);
      sentDMs.add(member.id);
    } catch {
      failed.push(member.user.tag);
    }
  }

  if (failed.length)
    interaction.user.send(`Failed to DM:\n${failed.join('\n')}`).catch(() => null);
});

// ======== !joinvc command ========
client.on('messageCreate', async (message) => {
  if (message.content === '!joinvc') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('You need Administrator permission to use this command.');
    }
    await connectToVC(VOICE_CHANNEL_ID);
    message.reply('Joined VC and will stay connected.');
  }
});

// ======== Music commands ========
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const guildId = message.guild.id;

  let queue = musicQueues.get(guildId);
  if (!queue) {
    queue = {
      connection: null,
      player: createAudioPlayer(),
      queue: [],
      current: null,
      loop: false,
      textChannel: null,
    };
    musicQueues.set(guildId, queue);
  }

  if (command === 'play') {
    const query = args.join(' ');
    if (!query) return message.reply('Please provide a YouTube or Spotify link or search term.');

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel)
      return message.reply('You must be in a voice channel to play music.');

    try {
      if (!queue.connection) {
        queue.connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId,
          adapterCreator: message.guild.voiceAdapterCreator,
        });
        queue.connection.subscribe(queue.player);
        queue.textChannel = message.channel;

        queue.player.on(AudioPlayerStatus.Idle, () => {
          if (queue.loop && queue.current) {
            playTrack(queue, queue.current);
          } else {
            queue.current = queue.queue.shift() || null;
            if (queue.current) playTrack(queue, queue.current);
            else {
              queue.connection.destroy();
              musicQueues.delete(guildId);
            }
          }
        });
      }

      let track = null;

      if (query.includes('spotify.com')) {
        // Spotify link processing
        const spotInfo = await play.spotify(query).catch(() => null);
        if (!spotInfo) return message.reply('Could not process Spotify link.');

        if (spotInfo.type === 'track') {
          const searchQuery = `${spotInfo.name} ${spotInfo.artists
            .map((a) => a.name)
            .join(' ')}`;
          const ytResult = await play.search(searchQuery, {
            source: { youtube: 'video' },
            limit: 1,
          });
          if (!ytResult.length)
            return message.reply('Could not find matching YouTube video.');
          track = { title: ytResult[0].name, url: ytResult[0].url };
          queue.queue.push(track);
          message.channel.send(`+ **${track.title}** added to queue.`);
        } else if (spotInfo.type === 'playlist' || spotInfo.type === 'album') {
          for (const t of spotInfo.tracks) {
            const searchQuery = `${t.name} ${t.artists
              .map((a) => a.name)
              .join(' ')}`;
            const ytResult = await play.search(searchQuery, {
              source: { youtube: 'video' },
              limit: 1,
            });
            if (ytResult.length)
              queue.queue.push({ title: ytResult[0].name, url: ytResult[0].url });
          }
          message.channel.send(
            `+ Added Spotify ${spotInfo.type} with ${spotInfo.tracks.length} tracks to queue.`
          );
        }
      } else {
        // YouTube link or search term
        const ytValidate = await play.validate(query);
        if (ytValidate === 'yt_playlist') {
          const playlist = await play.playlist_info(query, { incomplete: false });
          const videos = await playlist.all_videos();
          for (const v of videos) {
            queue.queue.push({ title: v.title, url: v.url });
          }
          message.channel.send(
            `+ Added YouTube playlist **${playlist.title}** with ${videos.length} videos to queue.`
          );
        } else {
          if (ytValidate === 'yt_video') {
            const info = await play.video_basic_info(query);
            track = { title: info.video_details.title, url: info.video_details.url };
          } else {
            // Search on YouTube
            const result = await play.search(query, {
              source: { youtube: 'video' },
              limit: 1,
            });
            if (result.length) {
              track = { title: result[0].name, url: result[0].url };
            }
          }
          if (track) {
            queue.queue.push(track);
            message.channel.send(`+ **${track.title}** added to queue.`);
          }
        }
      }

      if (!queue.current) {
        queue.current = queue.queue.shift() || null;
        if (queue.current) playTrack(queue, queue.current);
      }
    } catch (err) {
      console.error(err);
      message.reply('Error adding song to queue.');
    }
  }

  if (command === 'skip') {
    if (!queue || !queue.current) return message.reply('Nothing is playing.');
    queue.player.stop();
    message.channel.send('⏭ Skipped current track.');
  }

  if (command === 'stop') {
    if (!queue) return message.reply('Nothing is playing.');
    queue.queue = [];
    queue.current = null;
    queue.player.stop();
    if (queue.connection) {
      queue.connection.destroy();
      musicQueues.delete(guildId);
    }
    message.channel.send('⏹ Stopped playback and cleared queue.');
  }

  if (command === 'loop') {
    if (!queue) return message.reply('Nothing is playing.');
    queue.loop = !queue.loop;
    message.channel.send(`🔁 Loop is now ${queue.loop ? 'enabled' : 'disabled'}.`);
  }

  if (command === 'queue') {
    if (!queue || (!queue.current && queue.queue.length === 0))
      return message.reply('Queue is empty.');
    const embed = new EmbedBuilder().setTitle('Music Queue');
    if (queue.current) embed.addFields({ name: 'Now Playing', value: queue.current.title });
    if (queue.queue.length > 0) {
      embed.addFields({
        name: 'Up Next',
        value: queue.queue.map((t, i) => `${i + 1}. ${t.title}`).join('\n'),
      });
    }
    message.channel.send({ embeds: [embed] });
  }
});

function playTrack(queue, track) {
  play
    .stream(track.url, { discordPlayerCompatibility: true })
    .then(({ stream, type }) => {
      const resource = createAudioResource(stream, { inputType: type });
      queue.player.play(resource);
      queue.textChannel.send(`▶️ Now playing: **${track.title}**`);
    })
    .catch((e) => {
      console.error('Error playing track:', e);
      queue.textChannel.send('⚠️ Error playing track.');
      queue.current = queue.queue.shift() || null;
      if (queue.current) playTrack(queue, queue.current);
    });
}
import { EmbedBuilder } from 'discord.js';

const allowedRoles = ['Admin', 'Friendlies Department'];
const positionsMap = {
  '1️⃣': 'GK',
  '2️⃣': 'CB',
  '3️⃣': 'CB2',
  '4️⃣': 'CM',
  '5️⃣': 'LW',
  '6️⃣': 'RW',
  '7️⃣': 'ST'
};

client.on('messageCreate', async message => {
  if (!message.content.startsWith('!hostfriendly')) return;
  if (message.author.bot) return;

  const args = message.content.split(' ').slice(1);
  const hostPosition = args[0]?.toUpperCase();
  const guildName = message.guild.name;

  const member = await message.guild.members.fetch(message.author.id);
  const hasPermission = member.roles.cache.some(role => allowedRoles.includes(role.name));
  if (!hasPermission) return message.reply("❌ You don't have permission to host friendlies.");

  const positionEmojis = Object.keys(positionsMap);
  const claimed = {};
  const userClaims = new Map();

  if (hostPosition && !Object.values(positionsMap).includes(hostPosition)) {
    return message.reply('❌ Invalid position specified.');
  }

  if (hostPosition) {
    claimed[hostPosition] = message.author;
    userClaims.set(message.author.id, hostPosition);
  }

  const embed = new EmbedBuilder()
    .setColor('Red')
    .setTitle(`**${guildName.toUpperCase()} 7v7 FRIENDLY**`)
    .setDescription(
      `React 1️⃣ → GK\n` +
      `React 2️⃣ → CB\n` +
      `React 3️⃣ → CB2\n` +
      `React 4️⃣ → CM\n` +
      `React 5️⃣ → LW\n` +
      `React 6️⃣ → RW\n` +
      `React 7️⃣ → ST\n` +
      (guildName.toLowerCase().includes('parma') ? '@here' : '@everyone')
    );

  const msg = await message.channel.send({ embeds: [embed] });
  for (const emoji of positionEmojis) await msg.react(emoji);

  const filter = (reaction, user) => {
    return positionEmojis.includes(reaction.emoji.name) && !user.bot;
  };

  const collector = msg.createReactionCollector({ filter, time: 600000 });

  collector.on('collect', async (reaction, user) => {
    const emoji = reaction.emoji.name;
    const pos = positionsMap[emoji];

    // Don't allow multiple reactions
    if (userClaims.has(user.id)) {
      const userReactions = msg.reactions.cache.filter(r => r.users.cache.has(user.id));
      for (const r of userReactions.values()) {
        if (r.emoji.name !== emoji) await r.users.remove(user.id);
      }
      return;
    }

    // If already claimed, ignore
    if (claimed[pos]) return;

    // Check if this user was the FIRST to react to this emoji
    const fetchedReaction = await msg.reactions.cache.get(emoji).users.fetch();
    const users = fetchedReaction.filter(u => !u.bot).map(u => u.id);

    if (users[0] !== user.id) {
      await reaction.users.remove(user.id); // Remove if not first
      return;
    }

    claimed[pos] = user;
    userClaims.set(user.id, pos);

    await message.channel.send(`✅ ${pos} confirmed for <@${user.id}>`);

    if (Object.keys(claimed).length === 7) {
      collector.stop();

      const finalLineup = Object.entries(positionsMap)
        .map(([emoji, pos]) => `${pos}: <@${claimed[pos]?.id || 'Unfilled'}>`)
        .join('\n');

      await message.channel.send(`**Final Lineup:**\n${finalLineup}`);
      await message.channel.send(`Finding friendly, looking for a rob.`);
    }
  });

  // Ping after 1 minute if fewer than 7 players
  setTimeout(async () => {
    if (Object.keys(claimed).length < 7) {
      await message.channel.send((guildName.toLowerCase().includes('parma') ? '@here' : '@everyone') + ' more reacts to get a friendly');
    }
  }, 60_000);

  // Cancel after 10 minutes
  collector.on('end', async () => {
    if (Object.keys(claimed).length < 7) {
      await message.channel.send('❌ Friendly cancelled. Not enough players.');
    }
  });

  // DM users once host posts a link
  const linkCollector = message.channel.createMessageCollector({
    filter: m => m.author.id === message.author.id,
    time: 3600000
  });

  linkCollector.on('collect', async m => {
    if (m.content.includes('http')) {
      for (const user of Object.values(claimed)) {
        try {
          await user.send(`Here’s the friendly, join up: ${m.content}`);
        } catch (e) {
          console.log(`❌ Couldn't DM ${user.tag}`);
        }
      }
      linkCollector.stop();
    }
  });
});


// =============== Handle errors ===============
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);
client.on('error', console.error);
client.on('shardError', console.error);

client.login(process.env.DISCORD_TOKEN);