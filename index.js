import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField
} from 'discord.js';
import express from 'express';
import 'dotenv/config';
import { joinVoiceChannel } from '@discordjs/voice';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// ——— Keep-Alive Server ———
const app = express();
app.get('/', (_, res) => res.send('Bot is alive!'));
app.listen(5000, '0.0.0.0', () =>
  console.log('🌐 Keep-alive server running on port 5000')
);

// ——— Utils & State ———
const wait = ms => new Promise(res => setTimeout(res, ms));
const dmedUsers = new Set();
const activeHostlies = new Set(); // channel.id set to prevent double runs

// ——— Auto-Reconnect Config ———
const AUTO_CHANNEL_ID = '1368359914145058956';
let connection = null;
let shouldAutoReconnect = false;

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ——— Auto-Reconnect Handler ———
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (
    oldState.member?.id === client.user.id &&
    oldState.channelId === AUTO_CHANNEL_ID &&
    !newState.channelId &&
    shouldAutoReconnect
  ) {
    console.log('🔄 Disconnected, retrying in 10s…');
    await wait(10000);
    try {
      const ch = client.channels.cache.get(AUTO_CHANNEL_ID);
      if (ch) {
        connection = joinVoiceChannel({
          channelId: AUTO_CHANNEL_ID,
          guildId: ch.guild.id,
          adapterCreator: ch.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false
        });
        console.log('✅ Reconnected to VC');
      }
    } catch (err) {
      console.error('❌ Reconnect failed:', err);
    }
  }
});

// ——— Message Handler ———
client.on('messageCreate', async msg => {
  if (!msg.guild || msg.author.bot) return;

  // —– Auto-react @everyone
  if (msg.mentions.everyone) {
    msg.react('✅').catch(() => {});
  }

  // —– !joinvc / !leavevc
  if (msg.content === '!joinvc') {
    if (!msg.member.voice.channel)
      return msg.reply('❌ You must be in a voice channel first.');
    try {
      connection = joinVoiceChannel({
        channelId: msg.member.voice.channel.id,
        guildId: msg.guild.id,
        adapterCreator: msg.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
      });
      shouldAutoReconnect =
        msg.member.voice.channel.id === AUTO_CHANNEL_ID;
      return msg.reply(
        shouldAutoReconnect
          ? `🔊 Joined <#${AUTO_CHANNEL_ID}> with auto-reconnect.`
          : `🔊 Joined <#${msg.member.voice.channel.id}>.`
      );
    } catch {
      return msg.reply('❌ Failed to join VC.');
    }
  }
  if (msg.content === '!leavevc') {
    if (connection) {
      shouldAutoReconnect = false;
      connection.destroy();
      connection = null;
      return msg.reply('🔇 Left voice channel.');
    }
    return msg.reply('❌ Not in a voice channel.');
  }

  // —– !dmrole
  if (msg.content.startsWith('!dmrole')) {
    if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return msg.reply('❌ Admins only.');
    const roleId = msg.content.split(/ +/)[1]?.match(/^<@&(\d+)>/)?.[1];
    const role = roleId && msg.guild.roles.cache.get(roleId);
    if (!role) return msg.reply('❌ Invalid role.');

    const status = await msg.reply(`📨 Fetching **${role.name}**…`);
    await wait(3000);
    msg.delete().catch(() => {});
    await msg.guild.members.fetch();
    let sent = 0, failed = [];
    for (const m of role.members.values()) {
      const u = m.user;
      if (dmedUsers.has(u.id)) continue;
      try {
        await u.send(
          'Hello! Friendly coming up—react here: https://discord.gg/…'
        );
        dmedUsers.add(u.id);
        sent++;
      } catch {
        failed.push(`${u.tag} (${u.id})`);
      }
      await wait(3000);
    }
    await msg.channel.send(`✅ Sent: ${sent}, Failed: ${failed.length}`);
    if (failed.length)
      msg.author
        .send(`Failed DMs:\n${failed.join('\n')}`)
        .catch(() => {});
  }

  // —– !hostfriendly
  if (msg.content === '!hostfriendly') {
    if (activeHostlies.has(msg.channel.id))
      return msg.reply('❌ A friendly is already running here.');
    activeHostlies.add(msg.channel.id);

    const announcement = `> **FRIENDLY 7v7**\n> React ✅ to join.\n@here`;
    const ann = await msg.channel.send({
      content: announcement,
      allowedMentions: { parse: ['here'] }
    });
    await ann.react('✅');

    let started = false;
    // After 1 min, ping if still under 7
    const ping1 = setTimeout(async () => {
      if (started) return;
      const r = ann.reactions.cache.get('✅');
      const users = r ? await r.users.fetch() : new Map();
      const cnt = users.filter(u => !u.bot).size;
      if (cnt < 7) {
        msg.channel.send({
          content: '@here still need more reacts!',
          allowedMentions: { parse: ['here'] }
        });
      }
    }, 60_000);

    // Wait up to 10 min or max 7 reacts
    const collected = await ann.awaitReactions({
      filter: (r, u) => r.emoji.name === '✅' && !u.bot,
      max: 7,
      time: 10 * 60_000
    });
    clearTimeout(ping1);

    const participants =
      collected.get('✅')?.users.cache.filter(u => !u.bot).map(u => u.id) ||
      [];

    if (participants.length < 7) {
      await msg.channel.send('❌ Not enough players—friendly cancelled.');
      activeHostlies.delete(msg.channel.id);
      return;
    }

    // Start role assignment
    started = true;
    await msg.channel.send('✅ 7 players joined—starting positions!');
    const positions = ['GK', 'CB1', 'CB2', 'CM', 'LW', 'RW', 'ST'];
    const claimed = new Set();

    for (const pos of positions) {
      const m = await msg.channel.send(pos);
      await m.react('✅');

      const col = m.createReactionCollector({
        filter: (r, u) =>
          r.emoji.name === '✅' &&
          participants.includes(u.id) &&
          !claimed.has(u.id),
        max: 1,
        time: 60_000
      });

      col.on('collect', async (_, u) => {
        claimed.add(u.id);
        await m.edit(`${pos} — <@${u.id}>`);
      });
      col.on('end', () => {
        if (m.reactions.cache.get('✅').count === 1) {
          m.edit(`${pos} — OPEN 😃`);
        }
      });
    }

    activeHostlies.delete(msg.channel.id);
  }
});

// ——— Global Error Logging ———
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

// ——— Login ———
client.login(process.env.DISCORD_TOKEN);