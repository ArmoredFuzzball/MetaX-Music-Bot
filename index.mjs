import { Client, Events, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { joinVoiceChannel, createAudioResource, createAudioPlayer, AudioPlayerStatus, getVoiceConnection } from '@discordjs/voice';
import ytdl    from '@distube/ytdl-core';
import Scraper from '@yimura/scraper';
import config  from './config.json' assert { type: 'json' };

console.log("MetaX Music Bot: Copyright (C) 2023 Sloan Stubler");
console.log("This program comes with ABSOLUTELY NO WARRANTY.");

const bot = new Client({ intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates ]});

bot.login(config.discord);
await new Promise(res => bot.once(Events.ClientReady, res));
bot.user.setActivity('your commands', { type: ActivityType.Watching });
console.log(`Logged in as ${bot.user.tag}!`);

//command setup
await new REST().setToken(config.discord).put(Routes.applicationCommands(bot.user.id), { body: [
	new SlashCommandBuilder().setName('play').setDescription('Plays a song.').addStringOption(option => option.setName('song').setDescription('The song to play.').setRequired(true)).toJSON(),
	new SlashCommandBuilder().setName('dc'  ).setDescription('Disconnects the bot from the voice channel.').toJSON(),
	new SlashCommandBuilder().setName('skip').setDescription('Skips the current song.').toJSON(),
	new SlashCommandBuilder().setName('np'  ).setDescription('Shows what is currently playing.').toJSON(),
	new SlashCommandBuilder().setName('loop').setDescription('Loops the current song.').toJSON()
]});
console.log('Successfully registered application commands.');

//slash command handler
bot.on(Events.InteractionCreate, async (int) => {
	if (!int.isChatInputCommand()) return;
    const guildId      = int.guild.id;
    const voiceChannel = int.member.voice.channel;
    const msgChannel   = int.channel;
    try {
        const response = await (async () => {
            switch (int.commandName) {
                case "play": return await playCommand(guildId, voiceChannel, msgChannel, int.options.getString('song'));
                case "dc":   return await exitCommand(guildId);
                case "skip": return await skipCommand(guildId, voiceChannel);
                case "np":   return await listCommand(guildId);
                case "loop": return await loopCommand(guildId, voiceChannel);
            }
        })();
        int.reply({ content: response, ephemeral: false });
    } catch (err) {
        switch (err) {
            case "novoice":      int.reply({ content: "You need to be in a voice channel to use this command!", ephemeral: true  }); break;
            case "notconnected": int.reply({ content: "I'm not connected to a voice channel!",                  ephemeral: true  }); break;
            case "noresults":    int.reply({ content: "No results found. Try a link instead!",                  ephemeral: true  }); break;
            default:             int.reply({ content: `Unexpected Error: ${err}`,                               ephemeral: false }); break;
        }
    }
});

// command functions
async function playCommand(guildId, voiceChannel, msgChannel, song) {
    if (!voiceChannel) throw "novoice";
    if (!Servers[guildId]) Servers[guildId] = new Server(guildId, voiceChannel, msgChannel);
    const result = await Servers[guildId].queue(song);
    Servers[guildId].play();
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

const scraper = new Scraper.default();
const Servers = {};
class Server {
    constructor(guildId, voiceChannel, msgChannel) {
        this.guildId    = guildId;
        this.msgChannel = msgChannel;
        this.songQueue  = [];
        this.looping    = false;
        this.nowPlaying = null;
        this.player     = createAudioPlayer();
        const connection = joinVoiceChannel({
            channelId:      voiceChannel.id,
            guildId:        voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf:       true
        });
        connection.subscribe(this.player);
        this.player.on('error', (err) => {
            this.msgChannel.send(`Unexpected Error: ${err}`);
            this.songOver();
        });
        this.player.on('stateChange', (oldState, newState) => {
            if (oldState.status === AudioPlayerStatus.Playing && newState.status === AudioPlayerStatus.Idle) this.songOver();
        });
    }

    async queue(song) {
        if (!song.includes('https://')) {
            const result = await scraper.search(song);
            if (!result || !result.videos || result.videos.length === 0) throw "noresults";
            song = result.videos[0].link;
        }
        this.songQueue.push(song);
        this.play();
        return song;
    }

    async play() {
        if (this.songQueue.length == 0) return;
        if (this.player.state.status !== AudioPlayerStatus.Idle) return;
        this.nowPlaying = this.songQueue[0];
        const stream = ytdl(this.nowPlaying, { quality: "highestaudio", highWaterMark: 1e+7 });
        this.player.play(createAudioResource(stream));
    }

    songOver() {
        if (!this.looping) this.songQueue.shift();
        this.play();
    }
    
    skip() {
        if (this.looping) this.songQueue.shift();
        this.player.stop();
    }

    disconnect() {
        this.player.stop();
        getVoiceConnection(this.guildId).destroy();
        delete Servers[this.guildId];
    }
}