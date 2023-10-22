import { Client, Events, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { joinVoiceChannel, createAudioResource, createAudioPlayer, AudioPlayerStatus, getVoiceConnection } from '@discordjs/voice';
import ytdl    from '@distube/ytdl-core';
import Scraper from '@yimura/scraper';
import config  from './config.json' assert { type: 'json' };

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
bot.on(Events.InteractionCreate, (interact) => {
	if (!interact.isChatInputCommand()) return;
    try {
        if (interact.commandName == 'play') return playCommand(interact);
        if (interact.commandName == 'dc'  ) return exitCommand(interact);
        if (interact.commandName == 'skip') return skipCommand(interact);
        if (interact.commandName == 'np'  ) return listCommand(interact);
        if (interact.commandName == 'loop') return loopCommand(interact);
    } catch (err) {
        switch (err) {
            case "novoice":      interact.reply({ content: "You need to be in a voice channel to use this command!", ephemeral: true });
            case "notconnected": interact.reply({ content: "I'm not connected to a voice channel!", ephemeral: true });
            default:             interact.reply({ content: `Error: ${err}`, ephemeral: false });
        }
    }
});

// command functions
async function playCommand(interact) {
    const guildId      = interact.guild.id;
    const voiceChannel = interact.member.voice.channel;
    const msgChannel   = interact.channel;
    if (!voiceChannel) throw "novoice";
    if (!Servers[guildId]) Servers[guildId] = new Server(guildId, voiceChannel, msgChannel);
    const result = await Servers[guildId].queue(interact.options.getString('song'));
    Servers[guildId].play();
    interact.reply({ content: `Queueing ${result}`, ephemeral: false });
}

async function exitCommand(interact) {
    const guildId      = interact.guild.id;
    const voiceChannel = interact.member.voice.channel;
    if (!voiceChannel)     throw "novoice";
    if (!Servers[guildId]) throw "notconnected";
    Servers[guildId].disconnect();
    interact.reply({ content: "Disconnected from voice channel.", ephemeral: false });
}

async function skipCommand(interact) {
    const guildId      = interact.guild.id;
    const voiceChannel = interact.member.voice.channel;
    if (!voiceChannel)     throw "novoice";
    if (!Servers[guildId]) throw "notconnected";
    Servers[guildId].skip();
    interact.reply({ content: "Skipped song.", ephemeral: false });
}

async function listCommand(interact) {
    const guildId = interact.guild.id;
    if (!Servers[guildId]) throw "notconnected";
    const song = Servers[guildId].nowPlaying;
    interact.reply({ content: `Now playing: ${song}`, ephemeral: false });
}

async function loopCommand(interact) {
    const guildId = interact.guild.id;
    const voiceChannel = interact.member.voice.channel;
    if (!voiceChannel)     throw "novoice";
    if (!Servers[guildId]) throw "notconnected";
    Servers[guildId].looping = !Servers[guildId].looping;
    interact.reply({ content: `Looping set to ${Servers[guildId].looping}.`, ephemeral: false });
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
    }

    async queue(song) {
        if (!song.includes('https://')) song = (await scraper.search(song)).videos[0].link;
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
        this.player.on(AudioPlayerStatus.Idle, () => this.songOver());
        this.player.on('error', (err) => {
            this.msgChannel.send(`Error: ${err}`);
            this.songOver();
        });
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