import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  Events
} from 'discord.js';
import express from 'express';
import 'dotenv/config';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Keep-alive server
const app = express();
app.get('/', (_, res) => res.send('Bot is alive!'));
app.listen(3000, () => console.log('Server running on port 3000'));

const wait     = ms => new Promise(r => setTimeout(r, ms));
const token    = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId  = process.env.GUILD_ID;

const emojis    = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣'];
const positions = ['GK','CB','CB2','CM','LW','RW','ST'];

const active = new Set();

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  registerSlash();
});

async function registerSlash() {
  const slash = new SlashCommandBuilder()
    .setName('hostfriendly')
    .setDescription('Host a Parma FC 7v7 friendly');
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: [slash.toJSON()] }
  );
  console.log('✅ /hostfriendly registered');
}

async function runHostFriendly(channel, hostMember) {
  if (!hostMember.permissions.has(PermissionsBitField.Flags.Administrator)) {
    await channel.send('❌ Only admins can host friendlies.');
    return;
  }
  if (active.has(channel.id)) {
    await channel.send('❌ A friendly is already being hosted in this channel.');
    return;
  }

  active.add(channel.id);

  const ann = await channel.send({
    content:
      `> **PARMA FC 7v7 FRIENDLY**\n` +
      `> React 1️⃣ → GK\n` +
      `> React 2️⃣ → CB\n` +
      `> React 3️⃣ → CB2\n` +
      `> React 4️⃣ → CM\n` +
      `> React 5️⃣ → LW\n` +
      `> React 6️⃣ → RW\n` +
      `> React 7️⃣ → ST\n` +
      `@here`
  });

  for (const e of emojis) await ann.react(e);

  let done = false;
  const claimedMap   = new Map(); // emoji → userId
  const claimedUsers = new Set(); // userId

  const collector = ann.createReactionCollector({ time: 10 * 60_000 });

  collector.on('collect', async (reaction, user) => {
    if (user.bot || done) return;

    const emoji = reaction.emoji.name;
    const idx   = emojis.indexOf(emoji);
    if (idx === -1) return;

    if (claimedUsers.has(user.id)) {
      // User already claimed — remove their reaction
      try {
        await reaction.users.remove(user.id);
      } catch (err) {
        console.error(`Failed to remove reaction from ${user.tag}`, err);
      }
      return;
    }

    if (!claimedMap.has(emoji)) {
      claimedMap.set(emoji, user.id);
      claimedUsers.add(user.id);
      channel.send(`✅ ${positions[idx]} claimed by <@${user.id}>`);

      if (claimedMap.size >= 7) {
        done = true;
        collector.stop('full');
      }
    } else {
      // Slot already taken — remove their reaction
      try {
        await reaction.users.remove(user.id);
      } catch (err) {
        console.error(`Failed to remove duplicate reaction`, err);
      }
    }
  });

  // Ping after 1 min if not full
  setTimeout(async () => {
    if (!done && claimedMap.size < 7) {
      await channel.send({
        content: '@here need more reacts to start!',
        allowedMentions: { parse: ['here'] }
      });