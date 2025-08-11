import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  Events,
  Collection,
  Routes,
  REST,
  SlashCommandBuilder
} from 'discord.js';
import { joinVoiceChannel, entersState, VoiceConnectionStatus, createAudioPlayer, createAudioResource, AudioPlayerStatus } from '@discordjs/voice';
import express from 'express';
import play from 'play-dl';
import 'dotenv/config';

const app = express();
app.get('/', (_, res) => res.send('Bot is alive!'));
app.listen(process.env.PORT || 3000, () => console.log('Express server running'));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

const TOKEN          = process.env.TOKEN;
const GUILD_ID       = process.env.GUILD_ID;
const VC_CHANNEL_ID  = '1368359914145058956'; // Parma FC VC ID
const PREFIX         = '!';
const dmRoleCache    = new Set();
const musicQueues    = new Map();

// Auto-join VC on ready and reconnection
async function connectToVC() {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(VC_CHANNEL_ID);
  if (!channel?.isVoiceBased()) return;
  const connection = joinVoiceChannel({
    channelId: VC_CHANNEL_ID,
    guildId: guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfMute: true
  });
  connection.on(VoiceConnectionStatus.Disconnected, () => setTimeout(connectToVC, 5000));
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await connectToVC();
});

// React ✅ to @everyone/@here
client.on('messageCreate', msg => {
  if ((msg.mentions.everyone || msg.content.includes('@here')) && !msg.author.bot) {
    msg.react('✅').catch(() => {});
  }
});

// ===== dmrole (prefix & slash) =====
async function handleDmRole(members, content, replyFn) {
  const failed = [];
  for (const member of members.values()) {
    if (member.user.bot || dmRoleCache.has(member.id)) continue;
    try {
      await member.send(content);
      dmRoleCache.add(member.id);
    } catch {
      failed.push(`<@${member.id}>`);
    }
  }
  if (failed.length) await replyFn(`❌ Failed to DM:\n${failed.join('\n')}`);
}

// Prefix !dmrole


// Slash /dmrole
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: [
      new SlashCommandBuilder()
        .setName('dmrole')
        .setDescription('DM all users in a role')
        .addRoleOption(opt=>opt.setName('role').setDescription('Role').setRequired(true))
        .addStringOption(opt=>opt.setName('message').setDescription('Message').setRequired(true))
        .toJSON()
    ]
  });
})();

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'dmrole') return;
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
    return interaction.reply({ content: 'No permission', ephemeral: true });
  const role = interaction.options.getRole('role');
  const content = interaction.options.getString('message');
  await interaction.reply({ content: `DMing ${role.members.size} users...`, ephemeral: true });
  await handleDmRole(role.members, content, msg => interaction.user.send(msg));
});

// ===== joinvc =====
client.on('messageCreate', async message => {
  if (message.content !== `${PREFIX}joinvc` || message.author.bot) return;
  await connectToVC();
  message.reply('Joined VC and will stay connected.');
});

// ===== hostfriendly =====
client.on('messageCreate', async message => {
  if (!message.content.toLowerCase().startsWith(`${PREFIX}hostfriendly`)) return;
  if (message.author.bot || !message.guild) return;

  const allowedRoles = ['Admin','Friendlies Department'];
  if (!message.member.roles.cache.some(r=>allowedRoles.includes(r.name))) {
    return message.reply('No permission to host.');
  }

  const args = message.content.split(' ').slice(1);
  const hostPos = args[0]?.toUpperCase();
  const positions = [
    { emoji: '1️⃣', name: 'GK'   },
    { emoji: '2️⃣', name: 'CB'   },
    { emoji: '3️⃣', name: 'CB2'  },
    { emoji: '4️⃣', name: 'CM'   },
    { emoji: '5️⃣', name: 'LW'   },
    { emoji: '6️⃣', name: 'RW'   },
    { emoji: '7️⃣', name: 'ST'   },
  ];

  let collecting = true;
  const claimed = {};
  const users = new Set();

  // Pre-claim host
  if (hostPos) {
    const idx = positions.findIndex(p=>p.name===hostPos);
    if (idx!==-1) {
      claimed[positions[idx].emoji] = message.author.id;
      users.add(message.author.id);
    }
  }

  // Send initial message
  const lines = () => positions.map(p=>`${p.emoji} → ${p.name}: ${claimed[p.emoji] ? `<@${claimed[p.emoji]}>` : '---'}`).join('\n');
  const announce = await message.channel.send(`**PARMA FC 7v7 FRIENDLY**\n${lines()}\n@here`);
  for (const p of positions) if (!claimed[p.emoji]) await announce.react(p.emoji);

  // 1-min reminder
  setTimeout(()=> {
    if (Object.keys(claimed).length < 7 && collecting) {
      message.channel.send('@here more reacts needed!');
    }
  }, 60000);

  // Collector
  const collector = announce.createReactionCollector({ time: 600000 });
  collector.on('collect', async (reaction, user) => {
    if (user.bot || users.has(user.id)) return reaction.users.remove(user.id);
    const pos = positions.find(p=>p.emoji===reaction.emoji.name);
    if (!pos || claimed[pos.emoji]) return reaction.users.remove(user.id);

    // delay
    setTimeout(async ()=>{
      if (users.has(user.id) || claimed[pos.emoji]) return;
      claimed[pos.emoji] = user.id;
      users.add(user.id);
      message.channel.send(`✅ ${pos.name} confirmed for <@${user.id}>, but friendlies are discontinued in Parma https://discord.gg/ZrNuUKJFfS`);
      await announce.edit(`**Parma friendlies are discontinued,https://discord.gg/ZrNuUKJFfS **\n${lines()}\n@everyone`);
      if (Object.keys(claimed).length===7) collector.stop('filled');
    },3000);
  });

  collector.on('end', (_, reason) => {
    collecting = false;
    if (reason!=='filled') {
      return message.channel.send('❌ Friendly cancelled.');
    }
    const final = positions.map(p=>`${p.name}: <@${claimed[p.emoji]}>`).join('\n');
    message.channel.send(`**FINAL LINEUP:**\n${final}\ Yeah but that lineup is trash https://discord.gg/ZrNuUKJFfS.`);
//DM link
  message.channel.createMessageCollector({
    filter: m=>m.author.id===message.author.id && /https?:\/\//.test(m.content),
    max: 1,
    time: 300000
  }).on('collect', m=>{
    const link = m.content;
    for (const uid of Object.values(claimed)) {
      client.users.send(uid, `Here’s the friendly, join up: https://discord.gg/ZrNuUKJFfS `).catch(()=>{});
    }
  });
});

// ===== Music Commands (!play, !skip, !stop, !loop, !queue) =====
client.on('messageCreate', async message => {
  if (!message.content.startsWith(`${PREFIX}play`) || message.author.bot) return;
  const url = message.content.split(' ')[1];
  if (!url) return message.reply('Provide a YouTube URL.');

  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) return message.reply('Join a VC first.');
  const perms = voiceChannel.permissionsFor(message.client.user);
  if (!perms.has('Connect')||!perms.has('Speak')) return message.reply('Missing VC permissions.');

  let serverQueue = musicQueues.get(message.guild.id);
  if (!serverQueue) {
    serverQueue = { connection: null, player: createAudioPlayer(), songs: [], loop: false, textChannel: message.channel };
    musicQueues.set(message.guild.id, serverQueue);
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });
    serverQueue.connection = connection;
    connection.subscribe(serverQueue.player);
  }

  serverQueue.songs.push(url);
  message.channel.send(`+ Added to queue.`);

  if (serverQueue.player.state.status === AudioPlayerStatus.Idle) {
    playSong(message.guild.id);
  }
});

async function playSong(guildId) {
  const q = musicQueues.get(guildId);
  if (!q || q.songs.length===0) {
    q.connection.destroy();
    musicQueues.delete(guildId);
    return;
  }
  const url = q.songs[0];
  try {
    const stream = await play.stream(url);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    q.player.play(resource);
    q.textChannel.send(`▶️ Now playing: ${url}`);
    q.player.once(AudioPlayerStatus.Idle, () => {
      if (!q.loop) q.songs.shift();
      playSong(guildId);
    });
  } catch (err) {
    console.error(err);
    q.songs.shift();
    playSong(guildId);
  }
}

client.on('messageCreate', message => {
  if (message.content === `${PREFIX}skip`) {
    const q = musicQueues.get(message.guild.id);
    if (q) q.player.stop();
  }
  if (message.content === `${PREFIX}stop`) {
    const q = musicQueues.get(message.guild.id);
    if (q) {
      q.songs = [];
      q.player.stop();
      q.connection.destroy();
      musicQueues.delete(message.guild.id);
    }
  }
  if (message.content === `${PREFIX}loop`) {
    const q = musicQueues.get(message.guild.id);
    if (q) {
      q.loop = !q.loop;
      message.channel.send(`Loop is now ${q.loop ? 'on' : 'off'}.`);
    }
  }
  if (message.content === `${PREFIX}queue`) {
    const q = musicQueues.get(message.guild.id);
    if (q && q.songs.length) {
      message.channel.send(q.songs.map((u,i)=>`${i+1}. ${u}`).join('\n'));
    } else {
      message.channel.send('Queue is empty.');
    }
  }
});

client.login(TOKEN);