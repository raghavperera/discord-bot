// index.js – Parma FC Discord Bot
import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  Collection
} from 'discord.js';
import {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus
} from '@discordjs/voice';
import express from 'express';
import 'dotenv/config';
import play from 'play-dl';

const TOKEN          = process.env.DISCORD_TOKEN;
const CLIENT_ID      = process.env.CLIENT_ID;
const GUILD_ID       = process.env.GUILD_ID;
const VOICE_CHANNEL  = '1368359914145058956';  // your VC ID
const PREFIX         = '!';
const ALLOWED_ROLES  = ['Admin', 'Friendlies Department'];
const POSITIONS      = ['GK','CB','CB2','CM','LW','RW','ST'];
const EMOJIS         = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣'];
const ACT_EMOJI      = '<:parma:1387523238891880479>';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Keepalive on Render
express().listen(process.env.PORT||3000, ()=>console.log('Express up'));

// Auto-react ✅ to @everyone/@here
client.on('messageCreate', msg => {
  if ((msg.mentions.everyone||msg.content.includes('@here')) && !msg.author.bot)
    msg.react('✅').catch(()=>{});
});

// Auto-join & reconnect to VC
async function joinVC() {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(VOICE_CHANNEL);
  if (!channel?.isVoiceBased()) return;
  const conn = joinVoiceChannel({
    channelId: VOICE_CHANNEL,
    guildId:    guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfMute: true
  });
  conn.on(VoiceConnectionStatus.Disconnected, ()=>setTimeout(joinVC,5000));
}
client.once('ready', ()=>joinVC());

// === !dmrole (prefix) ===
client.on('messageCreate', async msg => {
  if (!msg.content.startsWith(`${PREFIX}dmrole`)||msg.author.bot) return;
  if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
  const role = msg.mentions.roles.first();
  const text = msg.content.split(' ').slice(2).join(' ');
  if (!role||!text) return msg.reply('Usage: `!dmrole @role message`');
  const failed=[];
  await msg.reply(`Dming ${role.members.size} users...`);
  for(const member of role.members.values()){
    if(member.user.bot) continue;
    try{ await member.send(text); }
    catch{ failed.push(member.user.tag); }
  }
  if(failed.length) msg.author.send(`Failed to DM:\n${failed.join('\n')}`);
});

// === /dmrole slash ===
const rest = new REST({version:'10'}).setToken(TOKEN);
client.once('ready', async ()=>{
  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body:[ new SlashCommandBuilder()
      .setName('dmrole')
      .setDescription('DM all users in a role')
      .addRoleOption(opt=>opt.setName('role').setDescription('Role').setRequired(true))
      .addStringOption(opt=>opt.setName('message').setDescription('Message').setRequired(true))
      .toJSON()
    ]
  });
});
client.on('interactionCreate', async i=>{
  if(!i.isChatInputCommand()||i.commandName!=='dmrole') return;
  if(!i.member.permissions.has(PermissionsBitField.Flags.Administrator))
    return i.reply({content:'No permission',ephemeral:true});
  const role = i.options.getRole('role');
  const text = i.options.getString('message');
  await i.reply({content:'Dming…',ephemeral:true});
  const failed=[];
  for(const member of role.members.values()){
    if(member.user.bot) continue;
    try{ await member.send(text); }catch{ failed.push(member.user.tag); }
  }
  if(failed.length) i.followUp({content:`Failed:\n${failed.join('\n')}`,ephemeral:true});
});

// === !activitycheck ===
client.on('messageCreate', async msg=>{
  if(!msg.content.startsWith(`${PREFIX}activitycheck`)) return;
  const parts = msg.content.split(' ');
  const goal = parseInt(parts[1])||40;
  const embed = new EmbedBuilder()
    .setTitle('🔔 AGNELLO FC ACTIVITY CHECK')
    .setDescription(`**React with:** ${ACT_EMOJI}\n**Goal:** ${goal}\n**Duration:** 1 Day`)
    .setColor('Blue');
  const sent = await msg.channel.send({content:'@here',embeds:[embed]});
  await sent.react(ACT_EMOJI);
});

// === !hostfriendly for Parma FC ===
client.on('messageCreate', async msg=>{
  if(!msg.content.toLowerCase().startsWith(`${PREFIX}hostfriendly`)) return;
  if(msg.author.bot) return;
  const member = await msg.guild.members.fetch(msg.author.id);
  if(!member.roles.cache.some(r=>ALLOWED_ROLES.includes(r.name)))
    return msg.reply('No perm.');
  const args = msg.content.split(' ').slice(1);
  const hostPos = args[0]?.toUpperCase();
  if(hostPos &&!POSITIONS.includes(hostPos))
    return msg.reply(`Choose one: ${POSITIONS.join(', ')}`);
  const claimed={}, userClaims=new Map();
  if(hostPos){
    claimed[hostPos]=msg.author;
    userClaims.set(msg.author.id,hostPos);
  }
  const embed = new EmbedBuilder()
    .setTitle('🔵 PARMA FC 7v7 FRIENDLY 🔵')
    .setDescription(
      POSITIONS.map((p,i)=>`React ${EMOJIS[i]} → ${p}`).join('\n')
      +'\n\n@here'
    )
    .setColor('Blue');
  const sent = await msg.channel.send({content:'@here',embeds:[embed]});
  for(const e of EMOJIS) await sent.react(e);
  const coll = sent.createReactionCollector({filter:(r,u)=>EMOJIS.includes(r.emoji.name)&&!u.bot,time:600000});
  coll.on('collect',async(reaction,user)=>{
    if(userClaims.has(user.id)){
      const urs=sent.reactions.cache.filter(r=>r.users.cache.has(user.id));
      for(const r of urs.values()) if(r.emoji.name!==reaction.emoji.name) await r.users.remove(user.id);
      return;
    }
    const p=positionsMap[reaction.emoji.name];
    if(claimed[p]) return;
    // ensure first reactor
    const users=await reaction.users.fetch();
    const nonBot=[...users.values()].filter(u=>!u.bot).map(u=>u.id);
    if(nonBot[0]!==user.id){
      await reaction.users.remove(user.id);
      return;
    }
    claimed[p]=user; userClaims.set(user.id,p);
    await msg.channel.send(`✅ ${p} confirmed for <@${user.id}>`);
    if(Object.keys(claimed).length===7){
      coll.stop();
      const lineup=POSITIONS.map(p=>`${p}: <@${claimed[p]?.id||'Unfilled'}>`).join('\n');
      await msg.channel.send(`**Final Lineup:**\n${lineup}`);
      await msg.channel.send('Finding friendly, looking for a rob.');
    }
  });
  setTimeout(()=>{ if(Object.keys(claimed).length<7) msg.channel.send('@here more reacts to get a friendly'); },60000);
  coll.on('end',()=>{ if(Object.keys(claimed).length<7) msg.channel.send('❌ Friendly cancelled.'); });
  const linkColl = msg.channel.createMessageCollector({filter:m=>m.author.id===msg.author.id,time:3600000});
  linkColl.on('collect',async m=>{
    if(m.content.includes('http')){
      for(const u of Object.values(claimed)){
        try{ await u.send(`Join: ${m.content}`); }catch{}
      }
      linkColl.stop();
    }
  });
});

// === MUSIC COMMANDS ===
client.on('messageCreate', async msg=>{
  if(!msg.content.startsWith(PREFIX)||msg.author.bot) return;
  const args = msg.content.slice(PREFIX.length).split(/ +/);
  const cmd  = args.shift().toLowerCase();
  const serverQueue = queue.get(msg.guild.id);
  if(cmd==='play'){
    const query = args.join(' ');
    if(!query) return msg.reply('Provide a song name or URL.');
    const voiceChannel=msg.member.voice.channel;
    if(!voiceChannel) return msg.reply('Join VC first.');
    const perms=voiceChannel.permissionsFor(msg.client.user);
    if(!perms.has('Connect')||!perms.has('Speak')) return msg.reply('No VC perms.');
    const results=await play.search(query,{limit:1});
    if(!results.length) return msg.reply('No results.');
    const song={title:results[0].title,url:results[0].url};
    if(!serverQueue){
      const qc={textChannel:msg.channel,voiceChannel,connection:null,songs:[],loop:false};
      queue.set(msg.guild.id,qc); qc.songs.push(song);
      try{
        const conn=joinVoiceChannel({
          channelId:voiceChannel.id,
          guildId:msg.guild.id,
          adapterCreator:voiceChannel.guild.voiceAdapterCreator
        });
        qc.connection=conn; playSong(msg.guild,qc.songs[0]);
      }catch(e){
        console.error(e); queue.delete(msg.guild.id);
      }
    } else {
      serverQueue.songs.push(song);
      msg.channel.send(`${song.title} added to queue.`);
    }
  }
  if(cmd==='skip'){
    if(!serverQueue) return msg.reply('Nothing playing.');
    serverQueue.songs.shift(); playSong(msg.guild,serverQueue.songs[0]);
  }
  if(cmd==='stop'){
    if(!serverQueue) return msg.reply('Nothing playing.');
    serverQueue.songs=[]; serverQueue.connection.destroy(); queue.delete(msg.guild.id);
  }
  if(cmd==='loop'){
    if(!serverQueue) return msg.reply('Nothing playing.');
    serverQueue.loop=!serverQueue.loop; msg.channel.send(`Loop ${serverQueue.loop?'On':'Off'}`);
  }
  if(cmd==='queue'){
    if(!serverQueue) return msg.reply('Queue empty.');
    msg.channel.send(serverQueue.songs.map((s,i)=>`${i+1}. ${s.title}`).join('\n'));
  }
});

async function playSong(guild,song){
  const serverQueue=queue.get(guild.id);
  if(!song){ serverQueue.connection.destroy(); queue.delete(guild.id); return; }
  const stream=await play.stream(song.url);
  const resource=createAudioResource(stream.stream,{inputType:stream.type});
  const player=createAudioPlayer();
  serverQueue.connection.subscribe(player);
  player.play(resource);
  player.on(AudioPlayerStatus.Idle,()=>{
    if(!serverQueue.loop) serverQueue.songs.shift();
    playSong(guild,serverQueue.songs[0]);
  });
}

client.login(TOKEN);