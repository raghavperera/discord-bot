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

// Keep-alive
const app = express();
app.get('/', (_, res) => res.send('Bot is alive!'));
app.listen(3000, () => console.log('Server running'));

// Internal utilities
const wait = ms => new Promise(r => setTimeout(r, ms));
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

const emojis    = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣'];
const positions = ['GK','CB','CB2','CM','LW','RW','ST'];
const active    = new Set();

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

// Core logic
async function runHostFriendly(channel, hostMember) {
  const hasPermission =
    hostMember.permissions.has(PermissionsBitField.Flags.Administrator) ||
    hostMember.roles.cache.some(r => r.name === 'Friendlies Department');

  if (!hasPermission) {
    await channel.send('❌ Only Admins or members of **Friendlies Department** can host.');
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
  const claimedMap = new Map();
  const claimedUsers = new Set();

  const collector = ann.createReactionCollector({ time: 10 * 60_000 });
  collector.on('collect', (reaction, user) => {
    if (user.bot || done) return;
    const emoji = reaction.emoji.name;
    const idx = emojis.indexOf(emoji);
    if (idx === -1) return;

    if (claimedUsers.has(user.id)) {
      reaction.users.remove(user.id).catch(() => {});
      return;
    }

    if (!claimedMap.has(emoji)) {
      // Delay claiming by 3 seconds
      setTimeout(async () => {
        if (claimedUsers.has(user.id)) return; // cancelled in meantime
        claimedMap.set(emoji, user.id);
        claimedUsers.add(user.id);
        await channel.send(`✅ ${positions[idx]} confirmed for <@${user.id}>`);
        if (claimedMap.size >= 7) {
          done = true;
          collector.stop('full');
        }
      }, 3000);
    } else {
      reaction.users.remove(user.id).catch(() => {});
    }
  });

  setTimeout(async () => {
    if (!done && claimedMap.size < 7) {
      await channel.send({
        content: '@here not enough reacts yet!',
        allowedMentions: { parse: ['here'] }
      });
    }
  }, 60_000);

  collector.on('end', async (_, reason) => {
    if (!done && claimedMap.size < 7) {
      await channel.send('❌ Not enough players reacted. Friendly cancelled.');
      active.delete(channel.id);
      return;
    }

    const lines = positions.map((pos, i) => {
      const uid = claimedMap.get(emojis[i]);
      return `${pos} — ${uid ? `<@${uid}>` : 'OPEN'}`;
    });
    await channel.send('✅ Final Positions:\n' + lines.join('\n'));

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
          console.error('DM failed for', uid);
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

// Prefix command
client.on('messageCreate', async msg => {
  if (msg.author.bot) return;
  if (msg.content === '!hostfriendly') {
    await runHostFriendly(msg.channel, msg.member);
  }
});

// Slash command
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