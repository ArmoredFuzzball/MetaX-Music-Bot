import { Client, Events, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { joinVoiceChannel, createAudioResource, createAudioPlayer, getVoiceConnection, AudioPlayerStatus, EndBehaviorType  } from '@discordjs/voice';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { Worker } from 'worker_threads';
import { opus } from 'prism-media';
//moving this into the Server class may prevent residual audio from playing after leaving a voice channel while downloading a song
import ytdl from '@distube/ytdl-core';
import Scraper from '@yimura/scraper';

const bot = new Client({ intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates ]});
const discord = JSON.parse(readFileSync('config.json', 'utf8')).discord;

bot.login(discord);
await new Promise(resolve => bot.once(Events.ClientReady, resolve));
bot.user.setActivity('your commands', { type: ActivityType.Watching });
console.log(`Logged in as ${bot.user.tag}!`);

//command setup
await new REST().setToken(discord).put(Routes.applicationCommands(bot.user.id), { body: [
	new SlashCommandBuilder().setName('join').setDescription('Joins the voice channel you are in.').toJSON(),
	new SlashCommandBuilder().setName('play').setDescription('Plays a song.').addStringOption(option => option.setName('song').setDescription('The song to play.').setRequired(true)).toJSON(),
	new SlashCommandBuilder().setName('dc'  ).setDescription('Disconnects the bot from the voice channel.').toJSON(),
	new SlashCommandBuilder().setName('skip').setDescription('Skips the current song.').toJSON(),
	new SlashCommandBuilder().setName('np'  ).setDescription('Shows what is currently playing.').toJSON(),
	new SlashCommandBuilder().setName('loop').setDescription('Loops the current song.').toJSON()
]});
console.log('Successfully registered application commands.');

//worker setup
const PLAYER = new Worker('./listener.mjs');
console.log('Successfully started listener worker.');
PLAYER.on('message', async ({guildId, transcript}) => {
    let cmd = transcript.split(' ')[0];
    if (cmd.includes('lay')) {
        let song = transcript.substring(5).trim();
        await Servers[guildId].add(song);
        Servers[guildId].play();
        console.log(`Added ${song} to the queue.`);
    } else
    if (cmd.includes('ski')) {
        Servers[guildId].skip();
        console.log('Skipped song.');
    }
});

//slash command handler
bot.on(Events.InteractionCreate, async (interaction) => {
	if (!interaction.isChatInputCommand()) return;
	if (interaction.commandName == 'join') return joinCommand (interaction);
	if (interaction.commandName == 'play') return playCommand (interaction);
	if (interaction.commandName == 'dc'  ) return leaveCommand(interaction);
	if (interaction.commandName == 'skip') return skipCommand (interaction);
	if (interaction.commandName == 'np'  ) return npCommand   (interaction);
	if (interaction.commandName == 'loop') return loopCommand (interaction);
});

//commands
async function joinCommand(int) {
    let guildId      = int.guild.id;
    let voiceChannel = int.member.voice.channel;
    if (!voiceChannel) return int.reply({ content: 'You need to join a voice channel first!', ephemeral: true });
    if (!Servers[guildId]) Servers[guildId] = new Server(guildId);
    Servers[guildId].join(voiceChannel, int.channel);
	int.reply({ content: `Joined ${int.member.voice.channel.name}.`, ephemeral: false });
}

async function leaveCommand(int) {
    let guildId = int.guild.id;
    if (!Servers[guildId]) return int.reply({ content: 'I am not in a voice channel.', ephemeral: true });
    Servers[guildId].leave();
	int.reply({ content: 'Disconnected from voice channel.', ephemeral: false });
}

async function skipCommand(int) {
    let guildId = int.guild.id;
	if (!Servers[guildId])               return int.reply({ content: 'I am not in a voice channel.', ephemeral: true });
    if (Servers[guildId].player == null) return int.reply({ content: 'I am not playing anything.', ephemeral: true });
    Servers[guildId].skip();
	int.reply({ content: 'Skipped song.', ephemeral: false });
}

async function playCommand(int) {
    let guildId        = int.guild.id;
    let voiceChannel   = int.member.voice.channel;
    let messageChannel = int.channel;
    if (!voiceChannel) return int.reply({ content: 'You need to join a voice channel first!', ephemeral: true });
    await int.deferReply();
    if (!Servers[guildId]) {
        Servers[guildId] = new Server(guildId);
        Servers[guildId].join(voiceChannel, messageChannel);
    }
    let result = await Servers[guildId].add(int.options.getString('song'));
    if (!result) return int.followUp({ content: 'I couldn\'t find that song! Try a link instead.', ephemeral: true });
    Servers[guildId].play();
    int.followUp({ content: `Queueing ${result}`, ephemeral: false });
}

async function npCommand(int) {
    let guildId = int.guild.id;
    if (Servers[guildId]) int.reply({ content: `Now playing: ${Servers[guildId].nowPlaying || 'nothing'}`, ephemeral: false });
    else                  int.reply({ content: 'I\'m not in a voice channel!', ephemeral: true });
}

async function loopCommand(int) {
    let guildId = int.guild.id;
    if (Servers[guildId]) {
        Servers[guildId].shouldLoop = !Servers[guildId].shouldLoop;
        int.reply({ content: `Looping is now ${Servers[guildId].shouldLoop ? 'ON' : 'OFF'}.`, ephemeral: false });
    } else int.reply({ content: 'I\'m not in a voice channel!', ephemeral: true });
}

bot.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    if (msg.content.startsWith('!')) msg.reply('Use slash commands instead! The commands are the same.');
});

bot.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (!newState.channel) return;
    let userId = newState.member.user.id;
    if (userId == bot.user.id) return;
    let guildId = newState.guild.id;
    if (!Servers[guildId] || Servers[guildId].voiceChannel.id != newState.channel.id) return;
    let connection = getVoiceConnection(guildId);
    Servers[guildId].subscribeUser(userId, connection);
});

//core functions
async function stream2array(stream) {
    const chunks = [];
    return new Promise((resolve, reject) => {
      stream.on('data',  (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('error', (err)   => reject(err));
      stream.on('end',   ()      => resolve(Buffer.concat(chunks)));
    });
}

const scraper = new Scraper.default();
async function getLinkFromText(song) {
	let results = await scraper.search(song);
	let video = results.videos[0];
    if (!video || !video.link) return false;
    else             return video.link;
}

let userChunks = {};
async function packageChunks(guildId, userId, chunk) {
    if (!userChunks[userId]) userChunks[userId] = [];
    userChunks[userId].push(chunk);
    if (userChunks[userId].length >= 10) {
        PLAYER.postMessage({ guildId, userId, chunks: userChunks[userId] });
        userChunks[userId] = [];
    }
}

const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);
const Servers = {};
class Server {
    constructor(guildId) {
        this.guildId        = guildId;
        this.queue          = [];
        this.player         = null;
        this.nowPlaying     = null;
        this.shouldLoop     = false;
        this.messageChannel = null;
        this.voiceChannel   = null;
    }

    async add(song) {
        if (song.startsWith('https://')) {
            this.queue.push(song);
            return song;
        }
        let result = await getLinkFromText(song);
        if (result) {
            this.queue.push(result);
            return result;
        } else return false;
    }

    skip() { 
        if (this.player) this.player.stop();
        this.nowPlaying = null;
    }

    async join(voiceChannel, messageChannel) {
        this.messageChannel = messageChannel;
        this.voiceChannel   = voiceChannel;
        let connection = joinVoiceChannel({
            channelId:      voiceChannel.id,
            guildId:        voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf:       false
        });
        for (let user of voiceChannel.members.values()) {
            this.subscribeUser(user.id, connection);
        }
    }

    async subscribeUser(userId, connection) {
        if (connection.receiver.subscriptions.has(userId)) return;
        let buffer = [];
        let stream = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
        stream.on('data', async (chunk) => {
            buffer.push(chunk)
            if (buffer.length > 10) buffer.shift();
        });
        let readable = new Readable({ read() {
            setTimeout(async () => {
                if (buffer.length > 0) this.push(buffer.shift());
                else this.push(SILENCE_FRAME);
            }, 21);
        }});
        let decoder = new opus.Decoder({ rate: 16000, channels: 1, frameSize: 960 });
        readable.pipe(decoder);
        decoder.on('data', async (chunk) => packageChunks(this.guildId, userId, chunk));
    }

    async play() {
        //if the player is already playing, do nothing
        if (this.player && this.player.state.status !== AudioPlayerStatus.Idle) return;
        let url = this.queue.shift();
        //download and store the music in a buffer
        let info;
        try {
            info = await ytdl.getInfo(url);
        } catch (error) {
            this.messageChannel.send('Something went wrong while getting the next track!');
            if (this.queue.length > 0) this.play();
            return;
        }
        //check if the video is age restricted
        let status = info.player_response.playabilityStatus.status;
        let title  = info.player_response.videoDetails.title;
        if (status == "LOGIN_REQUIRED") {
            this.messageChannel.send(`"${title}" is age restricted! I cannot access it. Try another video.`);
            if (this.queue.length > 0) this.play();
            return;
        }
        let buffer = ytdl.downloadFromInfo(info, { quality: "highestaudio" });
        //convert the buffer to a readable stream
        let music = Readable.from(await stream2array(buffer));
        //play the music
        this.player  = createAudioPlayer();
        let resource = createAudioResource(music);
        this.player.play(resource);
        getVoiceConnection(this.guildId).subscribe(this.player);
        this.nowPlaying = url;
        //when the music ends, play the next one
        this.player.on(AudioPlayerStatus.Idle, async () => {
            if (this.shouldLoop && this.nowPlaying) this.queue.unshift(this.nowPlaying);
            this.nowPlaying = null;
            this.player     = null;
            if (this.queue.length > 0) this.play();
        });
    }

    leave() {
        if (this.player) this.player.stop();
        getVoiceConnection(this.guildId).destroy();
        delete Servers[this.guildId];
    }
}
