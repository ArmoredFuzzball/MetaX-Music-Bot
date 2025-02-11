import net from 'net';
net.setDefaultAutoSelectFamily(false);

import { Client, Events, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { joinVoiceChannel, createAudioResource, createAudioPlayer, AudioPlayerStatus, getVoiceConnection, AudioPlayerError, StreamType } from '@discordjs/voice';
import ytdl    from '@distube/ytdl-core';
import Scraper from '@yimura/scraper';
import config  from './config.json' with { type: 'json' };
import { isReadable, Readable } from 'stream';

console.log("MetaX Music Bot: Copyright (C) 2025 ArmoredFuzzball");
console.log("This program comes with ABSOLUTELY NO WARRANTY.");

const bot = new Client({ intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates ]});

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
    if (oldState.member && oldState.member.user.bot) return;
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
        case "novoice":       return "You need to be in a voice channel!";
        case "notconnected":  return "I'm not connected to a voice channel!";
        case "noresults":     return "No results found. Try a link instead!";
        case "notyoutube":    return "This is not a YouTube link!";
        case "notplayable":   return "Video isn't playable. Is it an album link?";
        case "restricted":    return "This video is age restricted!";
        case "noqueue":       return "There is nothing to skip!";
        case "noformats":     return "No audio formats found for this video!";
        case "downloaderror": return "Error downloading video!";
        case "maxattempts":   return "Failed to download video after multiple attempts!";
        default:              {
            console.error(err);
            return `Unknown ${err}`;
        }
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
    const song = Servers[guildId].songQueue[0];
    if (!song) return "No song is currently playing.";
    return `Now playing: ${song.rawurl}`;
}

async function loopCommand(guildId, voiceChannel) {
    if (!voiceChannel)     throw "novoice";
    if (!Servers[guildId]) throw "notconnected";
    Servers[guildId].looping = !Servers[guildId].looping;
    return `Looping set to ${Servers[guildId].looping}.`;
}

async function queueCommand(guildId) {
    if (!Servers[guildId]) throw "notconnected";
    const queue = Servers[guildId].songQueue.map((song, index) => `${index === 0 ? ">" : index}. ${song.rawurl}`);
    return queue.join('\n');
}

const scraper = new Scraper.default();
/** @type {Object<string, Server>} */
const Servers = {};
class Server {
    /**
     * @param {string} guildId
     * @param {string} guildName
     * @param {import('discord.js').VoiceChannel} voiceChannel
     * @param {import('discord.js').TextChannel} msgChannel
     */
    constructor(guildId, guildName, voiceChannel, msgChannel) {
        this.guildName  = guildName;
        this.guildId    = guildId;
        this.msgChannel = msgChannel;
        this.songQueue  = [];
        this.looping    = false;
        this.stream     = null;
        this.playlock   = false;
        this.player     = createAudioPlayer();
        const connection = joinVoiceChannel({
            channelId:      voiceChannel.id,
            guildId:        voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf:       true
        });
        connection.subscribe(this.player);
        this.player.on('error', (error) => parseStreamError(error, this.msgChannel));
        this.player.on('stateChange', (oldState, newState) => this._transition(oldState.status, newState.status));
    }

    async queue(rawurl) {
        let url;
        if (!rawurl.includes('https://') && !rawurl.includes('http://')) {
            const result = await scraper.search(rawurl);
            if (!result || !result.videos || result.videos.length === 0) throw "noresults";
            rawurl = result.videos[0].link;
            url    = result.videos[0].link;
        } else url = await decipherURL(rawurl);
        this.songQueue.push({ rawurl, url });
        this.play();
        return rawurl;
    }

    async play() {
        if (this.player.state.status !== AudioPlayerStatus.Idle) return;
        if (this.playlock) return;
        try {
            this.playlock = true;
            const res = await fetch(this.songQueue[0].url, { priority: 'high', headers: { 'User-Agent': 'Mozilla/5.0' }, keepalive: true });
            if (res.ok && isReadable(res.body)) {
                this.stream = Readable.fromWeb(res.body, { highWaterMark: 1e7 });
                this.stream.once('error', (error) => {
                    console.error("Web stream error:", error);
                });
                // this.stream = res.body;
                const inputType = getInputType(res.headers.get('content-type'));
                const resource = createAudioResource(this.stream, { inputType });
                this.player.play(resource);
            } else throw res.statusText;
        } catch (error) {
            this.playlock = false;
            parseStreamError(error, this.msgChannel)
        }
    }

    skip() {
        if (this.looping) this.songQueue.shift();
        this.player.stop();
    }

    disconnect() {
        this.player.stop(true);
        const connection = getVoiceConnection(this.guildId);
        if (connection) connection.destroy();
        delete Servers[this.guildId];
    }

    async _transition(oldStatus, newStatus) {
        if (!Servers[this.guildId]) return;
        console.log(`Guild: ${this.guildName} | Status: ${oldStatus} -> ${newStatus}`);
        if (newStatus !== AudioPlayerStatus.Idle) return;
        clearStreamBuffer(this.stream);
        this.playlock = false;
        if (oldStatus !== AudioPlayerStatus.Buffering) {
            if (this.looping && this.songQueue.length > 0) {
                // this prevents a failure when looping for extended periods
                this.songQueue[0].url = await decipherURL(this.songQueue[0].rawurl).catch(() => this.songQueue[0].url);
            } else this.songQueue.shift();
        }
        if (this.songQueue.length === 0) return;
        setTimeout(() => this.play(), 1000);
    }
}

/**
 * Find the appropriate stream type for the given content type.
 * This is used to optimize audio resource transcoding.
 * @param {String} contentType
 * @returns {StreamType}
 */
function getInputType(contentType) {
    // console.log(contentType);
    if (contentType == "audio/webm") return StreamType.WebmOpus;
    return StreamType.Arbitrary;
}

/**
 * Takes a raw URL and returns a playable URL.
 * @param {string} rawurl
 * @returns {Promise<string>}
 */
async function decipherURL(rawurl) {
    if (rawurl.includes('youtube') || rawurl.includes('youtu.be')) {
        const format = await getFirstReachableFormat(rawurl);
        if (!format) throw "noformats";
        return format.url;
    } else return rawurl;
}

/**
 * Clears the buffer of a readable stream.
 * This prevents memory leaks.
 * @param {Readable} readable
 */
function clearStreamBuffer(readable) {
    readable.destroy();
    while (true) {
        const chunk = readable.read();
        if (chunk === null) return;
    }
}

/**
 * @param {Error} error
 * @param {import('discord.js').TextChannel} msgChannel
 */
function parseStreamError(error, msgChannel) {
    if (error && error.cause && error.cause instanceof AggregateError) {
        console.error("AggregateError details:");
        for (const individualError of error.cause.errors) {
            console.error(individualError.name, individualError.stack);
        }
        msgChannel.send("Aggregate errors during playback.");
    } else if (error instanceof AudioPlayerError) {
        console.error("AudioPlayerError details:", error.stack);
        msgChannel.send("Audio player error during playback.");
    } else {
        console.error(error.name + "details:", error);
        msgChannel.send("Error during playback.");
    }
}

/**
 * Gets the first reachable video format from a YouTube URL, retrying up to the specified number of times.
 * @param {string} youtubeURL
 * @param {number} maxattempts
 * @returns {Promise<ytdl.videoFormat>}
 */
async function getFirstReachableFormat(youtubeURL, maxattempts = 3) {
    let attempt = 1;
    while (attempt < maxattempts) {
        const { formats } = await ytdl.getInfo(youtubeURL);
        // console.log("Found", formats.length, "video formats");

        const playableformats = formats.filter(format => !format.url.includes("https://manifest.googlevideo.com"));
        // console.log("Found", playableformats.length, "playable video formats");

        const useableFormats = playableformats.filter(format => format.hasAudio);
        // console.log("Found", useableFormats.length, "useable video formats");

        const orderedFormats = useableFormats.sort((a, b) => {
            if (a.audioCodec === "opus") return -1;
            if (b.audioCodec === "opus") return 1;
            return 0;
        });

        for (const format of orderedFormats) {
            try {
                const result = await fetch(format.url);
                if (result.ok) {
                    // console.log("Found a reachable video format");
                    return format;
                }
            } catch (error) {}
        }

        attempt++;
        console.log("Failed to find a reachable video format, retrying...");
    }
}