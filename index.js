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

// Utilities
const wait     = ms => new Promise(r => setTimeout(r, ms));
const token    = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId  = process.env.GUILD_ID;

// Reaction slots mapping
const emojis    = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣'];
const positions = ['GK','CB','CB2','CM','LW','RW','ST'];

// Prevent double-runs per channel
const active = new Set();

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  registerSlash();
});

// Register slash command
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

// Core friendly logic
async function runHostFriendly(channel, hostMember) {
  // Only admins
  if (!hostMember.permissions.has(PermissionsBitField.Flags.Administrator)) {
    await channel.send('❌ Only admins can host friendlies.');
    return;
  }
  // Mark this channel as active
  active.add(channel.id);

  // Announcement
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
  // Add reactions
  for (const e of emojis) await ann.react(e);

  let done = false;
  const claimedMap   = new Map();   // emoji → userId
  const claimedUsers = new Set();   // userId → true

  // Collector for up to 10 minutes
  const collector = ann.createReactionCollector({ time: 10 * 60_000 });
  collector.on('collect', (reaction, user) => {
    if (user.bot || done) return;
    const idx = emojis.indexOf(reaction.emoji.name);
    if (idx === -1) return;                // not one of our emojis
    if (claimedMap.has(emojis[idx])) return;      // slot already taken
    if (claimedUsers.has(user.id))   return;      // user already claimed one

    // Claim it
    claimedMap.set(emojis[idx], user.id);
    claimedUsers.add(user.id);
    channel.send(`✅ ${positions[idx]} claimed by <@${user.id}>`);

    // If all 7 claimed, stop early
    if (claimedMap.size >= 7) {
      done = true;
      collector.stop('full');
    }
  });

  // After 1 minute, ping if still under 7
  setTimeout(async () => {
    if (!done && claimedMap.size < 7) {
      await channel.send({
        content: '@here need more reacts to start!',
        allowedMentions: { parse: ['here'] }
      });
    }
  }, 60_000);

  // When collector ends
  collector.on('end', async (_, reason) => {
    if (!done && claimedMap.size < 7) {
      await channel.send('❌ Not enough players reacted. Friendly cancelled.');
      active.delete(channel.id);
      return;
    }

    // Show final assignments
    const lines = positions.map((pos, i) => {
      const uid = claimedMap.get(emojis[i]);
      return `${pos} — ${uid ? `<@${uid}>` : 'OPEN'}`;
    });
    await channel.send('✅ Positions assigned:\n' + lines.join('\n'));

    // Wait for host to post Roblox link in same channel
    const filter = msg =>
      msg.author.id === hostMember.id &&
      msg.channel.id === channel.id &&
      msg.content.includes('https://');
    const linkCollector = channel.createMessageCollector({ filter, time: 5*60_000, max: 1 });

    linkCollector.on('collect', async msg => {
      const link = msg.content.trim();
      for (const uid of claimedMap.values()) {
        try {
          const u = await client.users.fetch(uid);
          await u.send(`Here’s the friendly, join up: ${link}`);
        } catch {
          console.error('❌ DM failed for', uid);
        }
      }
      await channel.send('✅ DMs sent to all players!');
      active.delete(channel.id);
    });

    linkCollector.on('end', collected => {
      if (collected.size === 0) {
        channel.send('❌ No link received—friendly not shared.');
        active.delete(channel.id);
      }
    });
  });
}

// Handle `!hostfriendly`
client.on('messageCreate', async msg => {
  if (msg.author.bot) return;
  if (msg.content === '!hostfriendly') {
    await runHostFriendly(msg.channel, msg.member);
  }
});

// Handle `/hostfriendly`
client.on(Events.InteractionCreate, async inter => {
  if (!inter.isChatInputCommand()) return;
  if (inter.commandName === 'hostfriendly') {
    await inter.reply({ content: 'Hosting Parma FC friendly…', ephemeral: true });
    await runHostFriendly(inter.channel, inter.member);
  }
});

client.login(token);

process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);