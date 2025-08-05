// index.js - Parma FC Discord Bot
import { Client, GatewayIntentBits, Partials, EmbedBuilder } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import play from 'play-dl';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const PREFIX = '!';
const voiceChannelId = '1368359914145058956';
const queues = new Map(); // Map<guildId, { connection, player, queue[], current, loop, textChannel }>

// Auto-connect to voice on ready
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}.`);
  const channel = client.channels.cache.get(voiceChannelId);
  if (channel && channel.isVoiceBased()) {
    try {
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
      });
      // Handle unexpected disconnects
      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
          // Reconnecting or moved, ignore
        } catch {
          connection.destroy();
          console.log('Voice connection destroyed, retrying...');
          // Try to reconnect after a short delay
          setTimeout(() => {
            const chan = client.channels.cache.get(voiceChannelId);
            if (chan && chan.isVoiceBased()) {
              joinVoiceChannel({
                channelId: chan.id,
                guildId: chan.guild.id,
                adapterCreator: chan.guild.voiceAdapterCreator,
              });
            }
          }, 5000);
        }
      });
      console.log(`Connected to voice channel ${channel.id}.`);
    } catch (err) {
      console.error('Failed to join voice channel:', err);
    }
  }
});

// Helper to play next track in queue
async function playNext(guildId) {
  const guildQueue = queues.get(guildId);
  if (!guildQueue) return;

  // If current track is null or we're looping the same track
  if (!guildQueue.current) {
    if (guildQueue.queue.length === 0) {
      guildQueue.connection.destroy();
      queues.delete(guildId);
      return;
    }
    guildQueue.current = guildQueue.queue.shift();
  }

  const track = guildQueue.current;
  try {
    // Fetch audio stream from URL (YouTube)
    const stream = await play.stream(track.url, { discordPlayerCompatibility: true });
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    guildQueue.player.play(resource);
    guildQueue.textChannel.send(`▶️ Now playing: **${track.title}**`);
  } catch (err) {
    console.error('Error playing stream:', err);
    guildQueue.textChannel.send('⚠️ Error playing the current track.');
    // Move to next track on error
    guildQueue.current = guildQueue.queue.shift();
    playNext(guildId);
    return;
  }

  guildQueue.player.once(AudioPlayerStatus.Idle, () => {
    if (!guildQueue.loop) {
      guildQueue.current = guildQueue.queue.shift() || null;
    }
    if (guildQueue.current) {
      playNext(guildId);
    } else {
      // Queue finished
      guildQueue.connection.destroy();
      queues.delete(guildId);
    }
  });
}

// Listen to messages for commands and features
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Auto-react ✅ to @everyone or @here
  if (message.content.includes('@everyone') || message.content.includes('@here')) {
    try {
      await message.react('✅');
    } catch (e) {
      console.error('Auto-react failed:', e);
    }
  }

  if (!message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  // ====================
  // 1. !hostfriendly
  // ====================
  if (command === 'hostfriendly') {
    const positions = ['GK', 'CB', 'CB2', 'CM', 'LW', 'RW', 'ST'];
    const numberEmojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣'];
    // Initialize fields
    const fields = positions.map(pos => ({ name: pos, value: 'Open', inline: true }));
    const embed = new EmbedBuilder()
      .setTitle('Host Friendly Lineup')
      .setDescription('React with a number to claim a position.')
      .addFields(fields);

    // Send embed and add reaction emojis
    const listMessage = await message.channel.send({ embeds: [embed] });
    for (const emoji of numberEmojis) {
      try {
        await listMessage.react(emoji);
      } catch (e) {
        console.error('Reaction failed:', e);
      }
    }

    // Set up reaction collector
    const filter = (reaction, user) => numberEmojis.includes(reaction.emoji.name) && !user.bot;
    const collector = listMessage.createReactionCollector({ filter, time: 10 * 60 * 1000 });
    // Track which user claimed which position
    const claimedPositions = {};

    collector.on('collect', (reaction, user) => {
      const idx = numberEmojis.indexOf(reaction.emoji.name);
      if (idx === -1) return;
      // If position already claimed by someone else, ignore additional claims
      if (fields[idx].value !== 'Open') return;
      // Assign position to user
      fields[idx].value = `<@${user.id}>`;
      claimedPositions[user.id] = positions[idx];
      // Edit embed with updated fields
      const updatedEmbed = new EmbedBuilder()
        .setTitle('Host Friendly Lineup')
        .setDescription('React with a number to claim a position.')
        .addFields(fields);
      listMessage.edit({ embeds: [updatedEmbed] });

      // If all positions are filled, end early
      if (fields.every(f => f.value !== 'Open')) {
        collector.stop('complete');
      }
    });

    collector.on('end', (collected, reason) => {
      const allClaimed = fields.every(f => f.value !== 'Open');
      if (allClaimed) {
        // Final lineup embed
        const finalEmbed = new EmbedBuilder()
          .setTitle('🚨 Friendly Lineup Ready 🚨')
          .addFields(fields)
          .setFooter({ text: 'All positions filled!' });
        message.channel.send({ content: 'Finding friendly, looking for a rob...', embeds: [finalEmbed] });
      } else {
        message.channel.send('⚠️ Friendly cancelled: not enough players claimed positions.');
      }
    });
  }

  // ====================
  // 2. !dmrole @Role message
  // ====================
  else if (command === 'dmrole') {
    const role = message.mentions.roles.first();
    if (!role) {
      return message.channel.send('Usage: !dmrole @Role Your message here');
    }
    const dmText = args.slice(1).join(' ');
    if (!dmText) {
      return message.channel.send('Please provide a message to send.');
    }
    const members = role.members;
    message.channel.send(`Sending DM to ${members.size} members...`);
    for (const [id, member] of members) {
      if (member.user.bot) continue;
      try {
        await member.send(dmText);
      } catch (e) {
        console.log(`Failed to DM ${member.user.tag}: ${e}`);
        message.channel.send(`⚠️ Could not DM <@${member.id}> (${member.user.tag}).`);
      }
    }
  }

  // ====================
  // 3. !dmchannel #channel
  // ====================
  else if (command === 'dmchannel') {
    const channel = message.mentions.channels.first();
    if (!channel) {
      return message.channel.send('Usage: !dmchannel #channel');
    }
    if (!channel.isTextBased()) {
      return message.channel.send('Please mention a text channel.');
    }
    let messages;
    try {
      messages = await channel.messages.fetch({ limit: 100 });
    } catch (e) {
      return message.channel.send('⚠️ Failed to fetch messages from that channel.');
    }
    const usersToDM = new Set();
    messages.forEach(msg => {
      if (!msg.author.bot) usersToDM.add(msg.author.id);
    });
    message.channel.send(`DMing ${usersToDM.size} users who chatted in ${channel}.`);
    for (const userId of usersToDM) {
      try {
        const user = await client.users.fetch(userId);
        if (user) {
          await user.send(`You were active in ${channel}. Hi from Parma FC bot!`);
        }
      } catch (e) {
        console.log(`Failed to DM user ${userId}: ${e}`);
      }
    }
  }

  // ====================
  // 4. Music Commands
  // ====================
  else if (command === 'play') {
    const query = args.join(' ');
    if (!query) {
      return message.channel.send('Usage: !play [song name or URL]');
    }
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return message.channel.send('You must be in a voice channel to play music.');
    }
    const guildId = message.guild.id;
    let queue = queues.get(guildId);
    if (!queue) {
      // Create voice connection and audio player
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guildId,
        adapterCreator: message.guild.voiceAdapterCreator,
      });
      const player = createAudioPlayer();
      connection.subscribe(player);
      queue = { connection, player, queue: [], current: null, loop: false, textChannel: message.channel };
      queues.set(guildId, queue);
    }

    // Handle Spotify links
    try {
      if (query.includes('spotify.com')) {
        const spotInfo = await play.spotify(query).catch(err => null);
        if (spotInfo) {
          if (spotInfo.type === 'track') {
            const searchQuery = `${spotInfo.name} ${spotInfo.artists.map(a => a.name).join(' ')}`;
            const ytResult = await play.search(searchQuery, { source: { youtube: 'video' }, limit: 1 });
            if (ytResult && ytResult.length) {
              const track = { title: ytResult[0].name, url: ytResult[0].url };
              queue.queue.push(track);
              message.channel.send(`+ **${track.title}** added to queue.`);
            }
          } else if (spotInfo.type === 'playlist' || spotInfo.type === 'album') {
            for (const t of spotInfo.tracks) {
              const searchQuery = `${t.name} ${t.artists.map(a => a.name).join(' ')}`;
              const ytResult = await play.search(searchQuery, { source: { youtube: 'video' }, limit: 1 });
              if (ytResult && ytResult.length) {
                const track = { title: ytResult[0].name, url: ytResult[0].url };
                queue.queue.push(track);
              }
            }
            message.channel.send(`+ Added Spotify ${spotInfo.type} with ${spotInfo.tracks.length} tracks to queue.`);
          }
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
          message.channel.send(`+ Added YouTube playlist **${playlist.title}** with ${videos.length} videos to queue.`);
        } else {
          let track;
          if (ytValidate === 'yt_video') {
            const info = await play.video_basic_info(query);
            track = { title: info.video_details.title, url: info.video_details.url };
          } else {
            // Search on YouTube
            const result = await play.search(query, { source: { youtube: 'video' }, limit: 1 });
            if (result && result.length) {
              track = { title: result[0].name, url: result[0].url };
            }
          }
          if (track) {
            queue.queue.push(track);
            message.channel.send(`+ **${track.title}** added to queue.`);
          }
        }
      }
    } catch (err) {
      console.error('Error processing play command:', err);
      return message.channel.send('⚠️ Error adding track to queue.');
    }
    // If nothing is playing, start playing
    if (!queue.current) {
      queue.current = queue.queue.shift() || null;
      playNext(guildId);
    }
  }

  else if (command === 'skip') {
    const guildId = message.guild.id;
    const queue = queues.get(guildId);
    if (!queue || !queue.current) {
      return message.channel.send('No track is currently playing.');
    }
    queue.player.stop();
    message.channel.send('⏭ Skipped current track.');
  }

  else if (command === 'stop') {
    const guildId = message.guild.id;
    const queue = queues.get(guildId);
    if (!queue) {
      return message.channel.send('No music is playing.');
    }
    queue.queue = [];
    queue.current = null;
    queue.player.stop();
    queue.connection.destroy();
    queues.delete(guildId);
    message.channel.send('⏹ Stopped playback and cleared queue.');
  }

  else if (command === 'loop') {
    const guildId = message.guild.id;
    const queue = queues.get(guildId);
    if (!queue) {
      return message.channel.send('No music is playing.');
    }
    queue.loop = !queue.loop;
    message.channel.send(`🔁 Loop is now ${queue.loop ? 'enabled' : 'disabled'}.`);
  }

  else if (command === 'queue') {
    const guildId = message.guild.id;
    const queue = queues.get(guildId);
    if (!queue || (!queue.current && queue.queue.length === 0)) {
      return message.channel.send('The queue is empty.');
    }
    const embed = new EmbedBuilder()
      .setTitle('Music Queue');
    if (queue.current) {
      embed.addFields({ name: 'Now Playing', value: queue.current.title });
    }
    if (queue.queue.length > 0) {
      const upcoming = queue.queue.map((t, i) => `${i + 1}. ${t.title}`).join('\n');
      embed.addFields({ name: 'Up Next', value: upcoming });
    }
    message.channel.send({ embeds: [embed] });
  }
});
// Catch unhandled promise rejections and client errors
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);
client.on('error', console.error);
client.on('shardError', console.error);
// Log in the bot with the token (replace 'YOUR_BOT_TOKEN' with actual token)
client.login('YOUR_BOT_TOKEN');