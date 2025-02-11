# MetaX Music Bot
A lightweight Discord music bot using LavaLink and written in Node.js that can play audio from YouTube, YouTube Music, Spotify and Soundcloud. It works across multiple servers in parallel.

## Commands
| Command | Description |
|--|--|
| **/play \<query or url\>** | Queue something to be played. |
| **/dc** | Disconnect from the voice channel. |
| **/skip** | Skip the current song. |
| **/loop** | Loop the currently playing song. |
| **/np** | See what song is currently playing. |
| **/queue** | Show currently queued songs.

## Prerequisites
- A modern version of [Node.js](https://nodejs.org/en) that supports ECMAScript modules.
- A Discord bot token from the [Discord Developer Portal](https://discord.com/developers/applications).
- Find or host your own [LavaLink](https://github.com/lavalink-devs/Lavalink) node (Meta uses LavaLink v4).
Public instances can be found at https://lavalinks-list.vercel.app/.
- This instance should be running the [youtube-source](https://github.com/lavalink-devs/youtube-source) plugin to allow for YouTube playback.
- Keep in mind that playback performance is based entirely on your selection of a LavaLink node.

## How to use
- Ensure all prerequisites are met.
- Download the repository and run `npm install` in the project directory to install the required dependencies.
- Go to the `config.json` file in the project directory and change the `token` key to your bot's token, provided in the [Discord Developer Portal](https://discord.com/developers/applications).
- Change the `nodes` key to contain your LavaLink node instance(s).
- To start the bot, simply run `node ./index.mjs` in the project directory.