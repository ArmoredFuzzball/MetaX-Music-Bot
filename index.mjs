import { Client, Events, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { Shoukaku, Connectors } from 'shoukaku';
import config from './config.json' with { type: 'json' };

//https://guide.shoukaku.shipgirl.moe/guides/3-common/
//https://lavalinks-list.vercel.app/
//https://github.com/lavalink-devs/youtube-source

console.log("MetaX Music Bot: Copyright (C) 2025 ArmoredFuzzball");
console.log("This program comes with ABSOLUTELY NO WARRANTY.");

const bot = new Client({ intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates ]});
const shoukaku = new Shoukaku(new Connectors.DiscordJS(bot), config.nodes);

shoukaku.on("error", (node, error) => console.log(`Node "${node}" encountered an error: ${error.message}`));

const WARNING = Object.freeze({
    NORESULTS: "No results found!",
    NOQUEUE: "There is nothing to skip!",
    NOVOICE: "You need to be in a voice channel!",
    NOTCONNECTED: "I'm not connected to a voice channel!",
    UNSUPPORTED: "Unsupported URL! Start your query with 'spotify' or 'soundcloud'!",
    NOTPLAYING: "No song is currently playing!"
});

bot.login(config.token);
await new Promise(res => bot.once(Events.ClientReady, res));
console.log(`Logged in as ${bot.user.tag}!`);
bot.user.setActivity('your commands', { type: ActivityType.Watching });

new REST().setToken(config.token).put(Routes.applicationCommands(bot.user.id), { body: [
	new SlashCommandBuilder().setName('play').setDescription('Plays a song.').addStringOption(option => option.setName('song').setDescription('The song to play, YouTube URL or any query.').setRequired(true)).toJSON(),
	new SlashCommandBuilder().setName('dc'  ).setDescription('Disconnects the bot from the voice channel.').toJSON(),
	new SlashCommandBuilder().setName('skip').setDescription('Skips the current song.').toJSON(),
    new SlashCommandBuilder().setName('loop').setDescription('Loops the current song.').toJSON(),
	new SlashCommandBuilder().setName('np'  ).setDescription('Shows what is currently playing.').toJSON(),
    new SlashCommandBuilder().setName('queue').setDescription('Shows the current queue.').toJSON()
]}).then(() => console.log('Successfully registered application commands.')).catch(console.error);

bot.on(Events.InteractionCreate, async (int) => {
	if (!int.isChatInputCommand()) return;
    await int.deferReply();
    const response = await executeCommand(int).catch(console.error);
    console.log(`Guild: ${int.guild.name} | User: ${int.user.tag} | Response: ${response}`);
    int.editReply(response);
});

bot.on('voiceStateUpdate', (oldState, _) => {
    if (oldState.member && oldState.member.user.bot) return;
    const voiceChannel = oldState.channel;
    if (!voiceChannel) return;
    if (voiceChannel.members.size > 1) return;
    const server = Servers[oldState.guild.id];
    setTimeout(() => { if (server && voiceChannel.members.size === 1) disconnect(server.guildId) }, 1000 * 60 * 5);
});

async function executeCommand(int) {
    const guildId      = int.guild.id;
    const voiceChannel = int.member.voice.channel;
    const msgChannel   = int.channel;
    console.log(`Guild: ${int.guild.name} | User: ${int.user.tag} | Command: ${int.commandName}`);
    switch (int.commandName) {
        case "play":  return playCommand(guildId, voiceChannel, msgChannel, int.options.getString('song'));
        case "dc":    return exitCommand(guildId, voiceChannel);
        case "skip":  return skipCommand(guildId, voiceChannel);
        case "loop":  return loopCommand(guildId, voiceChannel);
        case "np":    return listCommand(guildId);
        case "queue": return queueCommand(guildId);
        default:      return "Unknown command!";
    };
}

async function playCommand(guildId, voiceChannel, msgChannel, song) {
    if (!voiceChannel) return WARNING.NOVOICE;
    if (!Servers[guildId]) await initialize(guildId, voiceChannel, msgChannel);
    const result = await queue(guildId, song);
    play(guildId);
    return result;
}

async function exitCommand(guildId, voiceChannel) {
    if (!voiceChannel)     return WARNING.NOVOICE;
    if (!Servers[guildId]) return WARNING.NOTCONNECTED;
    disconnect(guildId);
    return "Disconnected from voice channel.";
}

async function skipCommand(guildId, voiceChannel) {
    if (!voiceChannel)     return WARNING.NOVOICE;
    if (!Servers[guildId]) return WARNING.NOTCONNECTED;
    if (!Servers[guildId].songQueue.length) return WARNING.NOQUEUE;
    skip(guildId);
    return "Skipped song.";
}

async function loopCommand(guildId, voiceChannel) {
    if (!voiceChannel)     return WARNING.NOVOICE;
    if (!Servers[guildId]) return WARNING.NOTCONNECTED;
    Servers[guildId].loop = !Servers[guildId].loop;
    return `Looping set to ${Servers[guildId].loop}.`;
}

async function listCommand(guildId) {
    if (!Servers[guildId]) return WARNING.NOTCONNECTED;
    const song = Servers[guildId].songQueue[0];
    if (!song) return WARNING.NOTPLAYING;
    return `Now playing: **${song.title}**\n${song.raw}`;
}

async function queueCommand(guildId) {
    if (!Servers[guildId]) return WARNING.NOTCONNECTED;
    const queue = Servers[guildId].songQueue.map((song, index) => `${index === 0 ? ">" : index}. **${song.title}** ${song.raw}`);
    return queue.join('\n');
}

/**
 * @typedef {Object} Server
 * @property {string} guildId
 * @property {import('discord.js').VoiceChannel} voiceChannel
 * @property {import('discord.js').TextChannel} textChannel
 * @property {Array<{ title: string, raw: string, url: string }>} songQueue
 * @property {boolean} loop
 * @property {boolean} isPlaying
 * @property {import('shoukaku').Node} node
*/

/** @type {Object<string, Server>} */ const Servers = {};

/**
 * @param {string} guildId
 * @param {import('discord.js').VoiceChannel} voiceChannel
 * @param {import('discord.js').TextChannel} textChannel
 */
async function initialize(guildId, voiceChannel, textChannel) {
    const server = {
        guildId,
        voiceChannel,
        textChannel,
        songQueue: [],
        loop: false,
        isPlaying: false,
        node: shoukaku.options.nodeResolver(shoukaku.nodes),
    };
    const player = await shoukaku.joinVoiceChannel({
        guildId,
        channelId: voiceChannel.id,
        deaf: true,
        shardId: 0
    });
    player.on("end", () => {
        server.isPlaying = false;
        if (!server.loop) server.songQueue.shift();
        play(server.guildId);
    });
    player.on("exception", async (error) => {
        server.isPlaying = false;
        console.error(error.exception);
        server.textChannel.send(`An error occurred: ${error.exception.message}`);
        play(server.guildId);
    });
    player.on('stuck', async () => {
        console.log("Track stuck, retrying...");
        await player.move();
        await player.resume();
    });
    Servers[guildId] = server;
}

async function queue(guildId, query) {
    const server = Servers[guildId];
    const metadata = await getMetadata(server.node, query);
    if (!metadata) return WARNING.NORESULTS;
    server.songQueue.push({ title: metadata.info.title, raw: metadata.info.uri, url: metadata.encoded });
    return `Queued **${metadata.info.title}**\n${metadata.info.uri}`;
}

function play(guildId) {
    const server = Servers[guildId];
    if (server.isPlaying) return;
    const song = server.songQueue[0];
    if (!song) return;
    server.isPlaying = true;
    const track = { track: { encoded: song.url } };
    shoukaku.players.get(guildId)?.playTrack(track);
}

function skip(guildId) {
    const server = Servers[guildId];
    if (!server.songQueue.length) return "Nothing to skip.";
    if (server.loop) server.songQueue.shift();
    shoukaku.players.get(guildId)?.stopTrack();
}

function disconnect(guildId) {
    shoukaku.players.get(guildId)?.stopTrack();
    shoukaku.leaveVoiceChannel(guildId);
    delete Servers[guildId];
}

/**
 * @param {import('shoukaku').Node} node 
 * @param {string} rawquery
 * @returns {Promise<import('shoukaku').Track>}
 */
async function getMetadata(node, rawquery) {
    let queryType = "ytsearch";
    if (validURL(rawquery)) {
        if (rawquery.includes("youtube") || rawquery.includes("youtu.be")) {
            const result = await node.rest.resolve(rawquery);
            return result.data;
        } else return;
    }
    if (rawquery.startsWith("spotify")) queryType = "spsearch";
    if (rawquery.startsWith("soundcloud")) queryType = "scsearch";
    const result = await node.rest.resolve(queryType + ":" + rawquery);
    return result.data?.shift();
}

function validURL(string) {
    try {
        new URL(string);
        return true;
    } catch (err) {
        return false;
    }
}