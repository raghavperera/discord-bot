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
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// Keep-alive
const app = express();
app.get('/', (_, res) => res.send('Bot is alive!'));
app.listen(3000, () => console.log('Server running'));

// Utils
const wait = ms => new Promise(res => setTimeout(res, ms));
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));

// Slash command registration
async function registerSlash() {
  const commands = [
    new SlashCommandBuilder()
      .setName('hostfriendly')
      .setDescription('Host an Agnello FC friendly')
      .toJSON()
  ];
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('❌ Slash reg failed:', err);
  }
}
client.login(token).then(registerSlash);

// Handle text and slash calls
client.on('messageCreate', msg => {
  if (msg.content === '!hostfriendly') runHostFriendly(msg.channel, msg.member);
});
client.on(Events.InteractionCreate, async inter => {
  if (!inter.isChatInputCommand()) return;
  if (inter.commandName === 'hostfriendly') {
    await inter.reply({ content: 'Hosting friendly…', ephemeral: true });
    runHostFriendly(inter.channel, inter.member);
  }
});

async function runHostFriendly(channel, member) {
  if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return channel.send('❌ Only admins can host friendlies.');
  }

  const announcement = `> # PARMA F.C FRIENDLY\n> React 1️⃣➖7️⃣ to join positions\n@here`;
  const ann = await channel.send({ content: announcement, allowedMentions: { parse: ['here'] } });

  const emojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣'];
  const positions = ['GK','CB','CB2','CM','LW','RW','ST'];
  const claimedUsers = new Map();

  for (const e of emojis) await ann.react(e);

  let done = false;
  const collector = ann.createReactionCollector({ time: 10*60_000 });
  collector.on('collect', async (reaction, user) => {
    if (user.bot || done) return;
    const idx = emojis.indexOf(reaction.emoji.name);
    if (idx === -1) return;
    if (!claimedUsers.has(emojis[idx])) {
      claimedUsers.set(emojis[idx], user.id);
      // If all seven filled, stop collecting
      if (claimedUsers.size >= 7) {
        done = true;
        collector.stop();
      }
    }
  });

  // After 1 minute ping
  setTimeout(async () => {
    if (!done && claimedUsers.size < 7) {
      await channel.send('@here not enough reacts yet!');
    }
  }, 60_000);

  collector.on('end', async () => {
    if (!done && claimedUsers.size < 7) {
      return channel.send('❌ Not enough players reacted. Friendly cancelled.');
    }

    // Show assignment
    await channel.send('✅ Positions assigned:');
    const assigned = [];
    for (let i=0; i<emojis.length; i++) {
      const userId = claimedUsers.get(emojis[i]);
      const mention = userId ? `<@${userId}>` : 'OPEN';
      assigned.push(`${positions[i]} — ${mention}`);
    }
    await channel.send(assigned.join('\n'));

    // Wait for link
    const linkListener = async msg => {
      if (msg.channel.id === channel.id && msg.content.includes('https://')) {
        client.off('messageCreate', linkListener);
        for (const [emoji, userId] of claimedUsers) {
          try {
            const u = await client.users.fetch(userId);
            await u.send(`Here’s the friendly, join up: ${msg.content}`);
          } catch { console.error('DM failed for', userId); }
        }
      }
    };
    client.on('messageCreate', linkListener);
  });
}
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);