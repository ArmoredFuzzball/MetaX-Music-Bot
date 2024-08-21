import { Client, Events, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { joinVoiceChannel, createAudioResource, createAudioPlayer, AudioPlayerStatus, getVoiceConnection } from '@discordjs/voice';
import ytdl    from '@distube/ytdl-core';
import Scraper from '@yimura/scraper';
import config  from './config.json' assert { type: 'json' };

console.log("MetaX Music Bot: Copyright (C) 2024 ArmoredFuzzball");
console.log("This program comes with ABSOLUTELY NO WARRANTY.");

const bot = new Client({ intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates ]});
const ytdlOptions = { filter: "audioonly", quality: "highestaudio", highWaterMark: 1e+9 };

bot.login(config.discord);
await new Promise(res => bot.once(Events.ClientReady, res));
bot.user.setActivity('your commands', { type: ActivityType.Watching });
console.log(`Logged in as ${bot.user.tag}!`);

//memory usage logger
const startUsage = process.memoryUsage().rss / 1024 / 1024;
function printUsage() {
    const currentUsage = process.memoryUsage().rss / 1024 / 1024;
    const diff = currentUsage - startUsage;
    console.log(`Total: ${Math.round(currentUsage)}MB | Change: ${Math.round(diff)}MB`);
}
// setInterval(printUsage, 2000);

//slash command setup
new REST().setToken(config.discord).put(Routes.applicationCommands(bot.user.id), { body: [
	new SlashCommandBuilder().setName('play').setDescription('Plays a song.').addStringOption(option => option.setName('song').setDescription('The song to play.').setRequired(true)).toJSON(),
	new SlashCommandBuilder().setName('dc'  ).setDescription('Disconnects the bot from the voice channel.').toJSON(),
	new SlashCommandBuilder().setName('skip').setDescription('Skips the current song.').toJSON(),
	new SlashCommandBuilder().setName('np'  ).setDescription('Shows what is currently playing.').toJSON(),
	new SlashCommandBuilder().setName('loop').setDescription('Loops the current song.').toJSON(),
    new SlashCommandBuilder().setName('queue').setDescription('Shows the current queue.').toJSON()
]}).then(() => console.log('Successfully registered application commands.')).catch(console.error);

//slash command handler
bot.on(Events.InteractionCreate, async (int) => {
	if (!int.isChatInputCommand()) return;
    await int.deferReply();
    const response = await (executeCommand(int).catch(notifyError));
    console.log(`Guild: ${int.guild.name} | User: ${int.user.tag} | Response: ${response}`);
    int.editReply(response);
});

//leave after inactivity
bot.on('voiceStateUpdate', (oldState, newState) => {
    if (oldState.member.user.bot) return;
    const voiceChannel = oldState.channel;
    if (!voiceChannel) return;
    if (voiceChannel.members.size > 1) return;
    const server = Servers[oldState.guild.id];
    const timeout = () => { if (server && voiceChannel.members.size === 1) server.disconnect() };
    setTimeout(timeout, 1000 * 60 * 10);
});

//command parsers
async function executeCommand(int) {
    const guildName    = int.guild.name;
    const guildId      = int.guild.id;
    const voiceChannel = int.member.voice.channel;
    const msgChannel   = int.channel;
    console.log(`Guild: ${int.guild.name} | User: ${int.user.tag} | Command: ${int.commandName}`);
    switch (int.commandName) {
        case "play":  return playCommand(guildId, guildName, voiceChannel, msgChannel, int.options.getString('song'));
        case "dc":    return exitCommand(guildId);
        case "skip":  return skipCommand(guildId, voiceChannel);
        case "np":    return listCommand(guildId);
        case "loop":  return loopCommand(guildId, voiceChannel);
        case "queue": return queueCommand(guildId);
    };
}

async function notifyError(err) {
    switch (err) {
        case "novoice":      return "You need to be in a voice channel!";
        case "notconnected": return "I'm not connected to a voice channel!";
        case "noresults":    return "No results found. Try a link instead!";
        case "notyoutube":   return "This is not a YouTube link!";
        case "notplayable":  return "Video isn't playable. Is it an album link?";
        case "restricted":   return "This video is age restricted!";
        case "noqueue":      return "There is nothing to skip!";
        default:             return `Unknown ${err}`;
    };
}

// command functions
async function playCommand(guildId, guildName, voiceChannel, msgChannel, song) {
    if (!voiceChannel) throw "novoice";
    if (!Servers[guildId]) Servers[guildId] = new Server(guildId, guildName, voiceChannel, msgChannel);
    const result = await Servers[guildId].queue(song);
    return `Queueing ${result}`;
}

async function exitCommand(guildId) {
    if (!Servers[guildId]) throw "notconnected";
    Servers[guildId].disconnect();
    return "Disconnected from voice channel.";
}

async function skipCommand(guildId, voiceChannel) {
    if (!voiceChannel)     throw "novoice";
    if (!Servers[guildId]) throw "notconnected";
    if (Servers[guildId].songQueue.length === 0) throw "noqueue";
    Servers[guildId].skip();
    return "Skipped song.";
}

async function listCommand(guildId) {
    if (!Servers[guildId]) throw "notconnected";
    const song = Servers[guildId].nowPlaying;
    return `Now playing: ${song}`;
}

async function loopCommand(guildId, voiceChannel) {
    if (!voiceChannel)     throw "novoice";
    if (!Servers[guildId]) throw "notconnected";
    Servers[guildId].looping = !Servers[guildId].looping;
    return `Looping set to ${Servers[guildId].looping}.`;
}

async function queueCommand(guildId) {
    if (!Servers[guildId]) throw "notconnected";
    const queue = Servers[guildId].songQueue;
    if (queue.length === 0) return 'Queue is empty.';
    if (queue.length === 1) return 'Now playing: ' + queue[0];
    const response = [];
    for (let i = 0; i < queue.length; i++) {
        if (i === 0) response.push('Now playing: ' + queue[i]);
        else response.push(i + ': ' + queue[i]);
    }
    return response.join('\n');
}

const scraper = new Scraper.default();
/** @type {Object<string, Server>} */
const Servers = {};
class Server {
    constructor(guildId, guildName, voiceChannel, msgChannel) {
        this.guildName  = guildName;
        this.guildId    = guildId;
        this.msgChannel = msgChannel;
        this.songQueue  = [];
        this.looping    = false;
        this.nowPlaying = null;
        this.stream     = null;
        this.player     = createAudioPlayer();
        const connection = joinVoiceChannel({
            channelId:      voiceChannel.id,
            guildId:        voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf:       true
        });
        connection.subscribe(this.player);
        this.player.on('error', (err) => {
            console.error(`Guild: ${this.guildName} | Error: ${err}`);
            this.msgChannel.send(err + '. Check the console for more details.');
        });
        this.player.on('stateChange', (oldState, newState) => this._transition(oldState.status, newState.status));
    }

    async queue(song) {
        if (!song.includes('https://')) {
            const result = await scraper.search(song);
            if (!result || !result.videos || result.videos.length === 0) throw "noresults";
            song = result.videos[0].link;
        }
        await ytdl.getBasicInfo(song).catch(parseVideoError);
        this.songQueue.push(song);
        setTimeout(() => this.play(), 500);
        return song;
    }

    play() {
        if (this.songQueue.length === 0) return;
        if (this.player.state.status !== AudioPlayerStatus.Idle) return;
        this.nowPlaying = this.songQueue[0];
        this.stream = ytdl(this.nowPlaying, ytdlOptions);
        this.player.play(createAudioResource(this.stream));
    }
    
    skip() {
        if (this.looping) this.songQueue.shift();
        this.player.stop();
    }

    disconnect() {
        this.player.stop(true);
        getVoiceConnection(this.guildId).destroy();
        delete Servers[this.guildId];
    }

    _transition(oldStatus, newStatus) {
        if (!Servers[this.guildId]) return;
        console.log(`Guild: ${this.guildName} | Status: ${oldStatus} -> ${newStatus}`);
        if (oldStatus !== AudioPlayerStatus.Playing) return;
        if (newStatus !== AudioPlayerStatus.Idle)    return;
        clearStreamBuffer(this.stream);
        if (!this.looping) this.songQueue.shift();
        setTimeout(() => this.play(), 1000);
    }
}

//free up memory because ytdl won't do it for us
async function clearStreamBuffer(readable) {
    readable.destroy();
    await new Promise(res => setTimeout(res, 200));
    while (true) {
        const chunk = readable.read();
        if (chunk === null) return;
    }
}

//ytdl error conversion
function parseVideoError(err) {
    switch (err.toString().substring(7).split(':')[0]) {
        case 'Not a YouTube domain':        throw 'notyoutube';
        case 'No video id found':           throw 'notplayable';
        case 'Sign in to confirm your age': throw 'restricted';
        default: throw err;
    }
}