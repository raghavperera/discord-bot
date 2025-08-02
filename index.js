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

// Keep bot alive and accessible 24/7 on Replit
const app = express();
app.get('/', (_, res) => res.send('Bot is alive!'));
app.listen(5000, '0.0.0.0', () => console.log('🌐 Keep-alive server running on port 5000'));

// Delay utility
const wait = ms => new Promise(res => setTimeout(res, ms));

// DM tracker
const dmedUsers = new Set();

// Auto-reconnect configuration
const AUTO_RECONNECT_CHANNEL_ID = '1368359914145058956';
let connection = null;
let shouldAutoReconnect = false;

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// Auto-reconnect functionality
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (oldState.member?.id === client.user.id &&
      oldState.channelId === AUTO_RECONNECT_CHANNEL_ID &&
      !newState.channelId &&
      shouldAutoReconnect) {

    console.log('🔄 Bot disconnected from auto-reconnect channel, attempting to reconnect...');

    await wait(10);

    try {
      const channel = client.channels.cache.get(AUTO_RECONNECT_CHANNEL_ID);
      if (channel) {
        connection = joinVoiceChannel({
          channelId: AUTO_RECONNECT_CHANNEL_ID,
          guildId: channel.guild.id,
          adapterCreator: channel.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false
        });
        console.log('✅ Successfully reconnected to voice channel');
      }
    } catch (err) {
      console.error('❌ Failed to auto-reconnect:', err);
      setTimeout(async () => {
        if (shouldAutoReconnect) {
          try {
            const channel = client.channels.cache.get(AUTO_RECONNECT_CHANNEL_ID);
            if (channel) {
              connection = joinVoiceChannel({
                channelId: AUTO_RECONNECT_CHANNEL_ID,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
              });
              console.log('✅ Successfully reconnected to voice channel (retry)');
            }
          } catch (retryErr) {
            console.error('❌ Retry failed:', retryErr);
          }
        }
      }, 10000);
    }
  }
});

client.on('messageCreate', async msg => {
  if (!msg.guild || msg.author.bot) return;

  if (msg.mentions.everyone) {
    try {
      await msg.react('✅');
    } catch (err) {
      console.error('❌ React failed:', err);
    }
  }

  if (msg.content === '!joinvc') {
    if (!msg.member.voice.channel) {
      return msg.reply('❌ You must be in a voice channel first.');
    }

    try {
      connection = joinVoiceChannel({
        channelId: msg.member.voice.channel.id,
        guildId: msg.guild.id,
        adapterCreator: msg.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
      });

      if (msg.member.voice.channel.id === AUTO_RECONNECT_CHANNEL_ID) {
        shouldAutoReconnect = true;
        await msg.reply(`🔊 Joined <#${msg.member.voice.channel.id}> with auto-reconnect enabled.`);
      } else {
        shouldAutoReconnect = false;
        await msg.reply(`🔊 Joined <#${msg.member.voice.channel.id}> and idling.`);
      }
    } catch (err) {
      console.error('❌ Failed to join VC:', err);
      await msg.reply('❌ Failed to join VC.');
    }
  }

  if (msg.content === '!leavevc') {
    if (connection) {
      shouldAutoReconnect = false;
      connection.destroy();
      connection = null;
      await msg.reply('🔇 Left voice channel and disabled auto-reconnect.');
    } else {
      await msg.reply('❌ Not connected to any voice channel.');
    }
  }

  if (msg.content.startsWith('!dmrole')) {
    if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return msg.reply('❌ Only admins can use this.');
    }

    const parts = msg.content.trim().split(' ');
    const roleMention = parts[1];
    const roleId = roleMention?.match(/^<@&(\d+)>/)?.[1];
    const role = roleId ? msg.guild.roles.cache.get(roleId) : null;

    if (!role) return msg.reply('❌ Invalid or missing role mention.');

    const statusMsg = await msg.reply(`📨 Fetching members of **${role.name}**...`);
    await wait(3000);
    await msg.delete().catch(() => {});

    await msg.guild.members.fetch();
    const members = role.members.map(m => m.user);

    let sent = 0;
    const failed = [];

    for (const user of members) {
      if (dmedUsers.has(user.id)) continue;
      try {
        await user.send(`Hello, we are hosting a friendly in Agnello FC. React over here! https://discord.com/channels/1357085245983162708/1361111188506935428`);
        sent++;
        dmedUsers.add(user.id);
      } catch {
        failed.push(`${user.tag} (${user.id})`);
      }
      await wait(3000);
    }

    await msg.channel.send(`✅ Finished! Sent: ${sent}, Failed: ${failed.length}`);

    if (failed.length > 0) {
      try {
        await msg.author.send(`Users who didn't receive DM:\n${failed.join('\n')}`);
      } catch (err) {
        console.error('❌ Could not DM command user:', err);
      }
    }
  }

  // Updated !hostfriendly command
  if (msg.content === '!hostfriendly') {
    const requiredRole = msg.guild.roles.cache.find(role => role.name === 'Friendlies Department');

    if (!requiredRole || !msg.member.roles.cache.has(requiredRole.id)) {
      return msg.reply('❌ You must have the **Friendlies Department** role to use this command.');
    }

    const announcement = 
      `> #FRIENDLY\n` +
      `> **Match Type:** 7v7\n` +
      `> **Server Region:** NA or any\n` +
      `> **Ping:** @here\n` +
      `> **Trialist Allowed:** ✅\n` +
      `> **Participating in friendly further betters your skills.**\n` +
      `> React with ✅ to accept.\n@here`;

    const announcementMsg = await msg.channel.send({
      content: announcement,
      allowedMentions: { parse: ['here'] }
    });

    await announcementMsg.react('✅');

    const collectedReactions = await announcementMsg.awaitReactions({
      filter: (reaction, user) => reaction.emoji.name === '✅' && !user.bot,
      time: 10 * 60 * 1000,
      max: 7
    });

    const participants = collectedReactions.get('✅')?.users.cache.filter(u => !u.bot).map(u => u.id) || [];

    if (participants.length < 7) {
      await msg.channel.send('❌ Not enough players reacted in time. Friendly is cancelled.');
      return;
    }

    await msg.channel.send('✅ Enough players! Starting role selection...');

    const roles = ['GK', 'CB1', 'CB2', 'CM', 'LW', 'RW', 'ST'];
    const claimedUsers = new Set();

    for (const roleName of roles) {
      const roleMsg = await msg.channel.send(roleName);
      await roleMsg.react('✅');

      const collector = roleMsg.createReactionCollector({
        filter: (reaction, user) =>
          reaction.emoji.name === '✅' &&
          participants.includes(user.id) &&
          !claimedUsers.has(user.id),
        max: 1,
        time: 60000
      });

      collector.on('collect', async (reaction, user) => {
        claimedUsers.add(user.id);
        await roleMsg.edit(`${roleName} - <@${user.id}>`);
      });

      collector.on('end', collected => {
        if (collected.size === 0) {
          roleMsg.edit(`${roleName} - OPEN 😃`);
        }
      });
    }
  }
});

// Error logging
process.on('unhandledRejection', err => {
  console.error('Unhandled promise rejection:', err);
});

process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err);
});

// Login
client.login(process.env.DISCORD_TOKEN);