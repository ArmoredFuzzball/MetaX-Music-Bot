# MetaX Music Bot
A lightweight Discord bot written in Node.js that can play videos from YouTube and YouTube Music. It can also work across multiple servers in parallel.
NOTE: Livestream support is basically nonexistent. Sometimes they play, sometimes they brick your queue.

## Commands
| Command | Description |
|--|--|
| **/play \<name or url\>** | Queue a video to be played. |
| **/dc** | Disconnect from the voice channel. |
| **/skip** | Skip the current song. |
| **/np** | See what song is currently playing. |
| **/loop** | Loop the currently playing song. |
| **/queue** | Show currently queued songs.

## How to use
Create a `config.json` file in the project directory. This file should contain a single key-value pair, like so:
```
{
	"discord": "your-bot-token"
}
```
Where `your-bot-token` is the token for your bot application, provided in the Discord Developer Portal.
To start the bot, simply run `npm ./index.mjs` in the project directory.