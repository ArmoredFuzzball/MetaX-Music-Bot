import { parentPort } from 'worker_threads';
import { createWriteStream, readFileSync } from 'fs';
import { PassThrough } from 'stream';
import Mixer from "./mixer.mjs";

import { Porcupine } from "@picovoice/porcupine-node";
import { Leopard }   from "@picovoice/leopard-node";
const picovoice = JSON.parse(readFileSync('config.json', 'utf8')).picovoice;
const keywords  = ['./wake_words/hey-meta.ppn', './wake_words/ok-meta.ppn'];
const porcupine = new Porcupine(picovoice, keywords, [1, 1]);
const leopard   = new Leopard(picovoice);

let Servers = {};
// let writeStream = createWriteStream('./output.pcm');
parentPort.on('message', async ({ guildId, userId, chunks }) => {
    if (!Servers[guildId]) {
        let mixer = new Mixer();
        Servers[guildId] = { mixer };
        mixer.on('data', async (chunk) => prepareFrames(guildId, chunk));
    }
    if (!Servers[guildId][userId]) {
        Servers[guildId][userId] = new PassThrough();
        Servers[guildId].mixer.addInput(Servers[guildId][userId]);
    }
    for (let chunk of chunks) Servers[guildId][userId].write(Buffer.from(chunk));
});

let inputCount = 0;
let leopardFrames = [];
let transcriptionTimeout = null;
let shouldTranscribe = false;

setInterval(async () => {
    if (shouldTranscribe) {
        const leopardFramesInt16 = new Int16Array(leopardFrames);
        let result = leopard.process(leopardFramesInt16);
        if (result && result.words.length > inputCount) {
            inputCount = result.words.length;
            if (transcriptionTimeout) transcriptionTimeout.refresh();
        }
    }
}, 300);

async function prepareFrames(guildId, chunk) {
    // writeStream.write(chunk);
    let frames = await getInt16Frames(chunk);
    for (let frame of frames) {
        leopardFrames.push(...frame);
        if (leopardFrames.length > 7000 && !shouldTranscribe) leopardFrames = leopardFrames.slice(leopardFrames.length - 7000);
        let keyword = porcupine.process(frame);
        if (keyword >= 0) {
            shouldTranscribe = true;
            inputCount = 0;
            if (transcriptionTimeout) return;
            console.log("META: listening");
            transcriptionTimeout = setTimeout(() => {
                if (!shouldTranscribe) return;
                const leopardFramesInt16 = new Int16Array(leopardFrames);
                shouldTranscribe = false;
                leopardFrames = [];
                let cmd = leopard.process(leopardFramesInt16);
                interpretCommand(guildId, cmd);
                transcriptionTimeout = null;
            }, 1600);
        }
    }
}

async function interpretCommand(guildId, cmd) {
    let transcript = cmd.transcript.toLowerCase();
    console.log("META:", transcript);
    parentPort.postMessage({ guildId, transcript });
}

// https://stackoverflow.com/questions/63995809/how-to-convert-from-prism-mediadiscordjs-opus-opus-stream-to-format-suitable
let frameAccumulator = [];
async function getInt16Frames(data) {
    let newFrames16 = new Array(data.length / 2);
    for (let i = 0; i < data.length; i += 2) {
        newFrames16[i / 2] = data.readInt16LE(i);
    }
    frameAccumulator = frameAccumulator.concat(newFrames16);
    let frames = chunkArray(frameAccumulator, porcupine.frameLength);
    if (frames[frames.length - 1].length !== porcupine.frameLength) {
        frameAccumulator = frames.pop();
    } else frameAccumulator = [];
    return frames;
}

function chunkArray(array, size) {
    return Array.from({ length: Math.ceil(array.length / size) }, (v, index) =>
        array.slice(index * size, index * size + size)
    );
}