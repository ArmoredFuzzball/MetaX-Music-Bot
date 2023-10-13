//https://codereview.stackexchange.com/questions/253515/nodejs-stream-readable-implementation-to-combine-pcm-audio-streams

import { Readable } from "stream"

const CHANNELS = 2
const BIT_DEPTH = 16

const SAMPLE_BYTES = BIT_DEPTH / 8
const FRAME_BYTES = SAMPLE_BYTES * CHANNELS
const SAMPLE_MAX = Math.pow(2, BIT_DEPTH - 1) - 1
const SAMPLE_MIN = -SAMPLE_MAX - 1

/**
 * Combines 16-bit 2-channel PCM audio streams into one.
 *
 * Usage:
 *
 * const mixer = new Mixer()
 *
 * mixer.addInput(somePCMAudioStream)
 * mixer.addInput(anotherPCMAudioStream)
 *
 * mixer.pipe(yourAudioPlayer)
 *
 * // remove one of the streams after 2 seconds
 * setTimeout(() => mixer.removeInput(somePCMAudioStream), 2000)
 */
class Mixer extends Readable {
    // list of input streams, buffers, and event handlers (for cleanup)
    inputs = []

    // true when _read() is called, false when this.push() later returns false
    thirsty = false

    debugPrint = false

    constructor(opts) {
        super(opts ? { highWaterMark: opts.highWaterMark } : undefined)
        this.mixerHighWaterMark =
            opts?.mixerHighWaterMark ?? this.readableHighWaterMark
        this.gainMultiplier = opts?.gainDivide ? 1 / opts.gainDivide : 1
    }

    log(message, ...optionalParams) {
        if (this.debugPrint) {
            console.log(message, ...optionalParams)
        }
    }

    /**
     * Called by Readable.prototype.read() whenever it wants more data
     */
    _read() {
        this.log("_read")
        this.thirsty = true

        // we need data so resume any streams that don't have a bunch already
        this.inputs.forEach(v => {
            if (v.buffer.length < this.mixerHighWaterMark) {
                if (v.stream) {
                    this.log(
                        `  Resuming ${v.name}, need more data (have ${v.buffer.length})`
                    )
                    v.stream?.resume()
                } else {
                    this.log(
                        `  Would resume ${v.name} but it's removed (have ${v.buffer.length})`
                    )
                }
            }
        })

        // have to do this in case all our streams are removed, but there's still
        // some buffers hanging around
        this._doProcessing()
    }

    /**
     * Adds a stream to the list of inputs.
     *
     * @param name is just for debug info
     */
    addInput(stream, name) {
        this.log(`+ Adding ${name}`)
        const obj = {
            stream: stream,
            buffer: Buffer.allocUnsafe(0),
            name: name,
            ondata: chunk => {
                this.log(
                    `  Got ${chunk.length} data for ${name}, (${obj.buffer.length
                    } => ${chunk.length + obj.buffer.length})`
                )
                // this handler is only called when the downstream is thirsty so the
                // streams were all resumed
                obj.buffer = Buffer.concat([obj.buffer, chunk])

                this._doProcessing()
                if (obj.buffer.length >= this.mixerHighWaterMark) {
                    // we couldn't keep processing, but we have a lot of data for this
                    // particular input buffer, so we pause it until we need to _read
                    // again
                    this.log(`  Pausing ${name}, have enough (have ${obj.buffer.length})`)
                    stream.pause()
                }
            },
            onend: () => {
                this.log(`  end ${name}`)
                this.removeInput(stream)
            }
        }

        // These are removed in removeInput, so we don't keep getting data events
        // if a user decides to remove an input mid-stream
        stream.on("data", obj.ondata)
        stream.once("end", obj.onend)

        // stream.pause();

        this.inputs.push(obj)
    }

    /**
     * Removes streams, but not necessarily buffers (so they can be used up first)
     */
    removeInput(stream) {
        this.inputs.forEach(v => {
            if (v.stream === stream) {
                this.log(`  (delayed) Removing ${v.name}, short length`)
                v.stream.removeListener("data", v.ondata)
                v.stream.removeListener("end", v.onend)
                v.stream = null
            }
        })
        this._doProcessing()
    }

    /**
     * Schedules several _process() calls for the next event loop.
     *
     * Schedules it async so that streams have a chance to emit "end" (and get
     * dropped from the input list) before we process everything.
     *
     * @param cb invoked when processing completes
     */
    _doProcessing() {
        while (this._process()) { }
    }

    /**
     * Calculates the sum for the first N bytes of all input buffers, where N is
     * equal to the length of the shortest buffer.
     *
     * @return  true if you should call _process again because there's more data
     *          to process (sort of like this.push())
     */
    _process() {
        if (!this.thirsty) return false

        this.log("Processing...")

        // get the shortest buffer and remove old inputs
        let shortest = Infinity

        this.inputs = this.inputs.filter(v => {
            if (v.stream === null && v.buffer.length < FRAME_BYTES) {
                this.log(`- (fufilled) Removing ${v.name}`)
                return false
            } else {
                shortest = Math.min(shortest, v.buffer.length)
                return true
            }
        })

        if (this.inputs.length === 0) {
            this.log("Length 0, stop processing")
            return false
        }

        if (shortest < FRAME_BYTES) {
            this.log(
                `  Shortest (${this.inputs
                    .filter(v => v.buffer.length === shortest)
                    .map(v => v.name)
                    .join()}) is too small, stop processing`
            )
            return false // don't keep processing, we don't have data
        }
        const frames = Math.floor(shortest / FRAME_BYTES)

        const out = Buffer.allocUnsafe(frames * FRAME_BYTES)

        // sum up N int16LEs
        for (let f = 0; f < frames; f++) {
            const offsetLeft = FRAME_BYTES * f
            const offsetRight = FRAME_BYTES * f + SAMPLE_BYTES
            let sumLeft = 0
            let sumRight = 0
            this.inputs.forEach(v => {
                sumLeft += this.gainMultiplier * v.buffer.readInt16LE(offsetLeft)
                sumRight += this.gainMultiplier * v.buffer.readInt16LE(offsetRight)
            })

            this.log(
                `    (left) ${this.inputs
                    .map(v => {
                        const x = v.buffer.readInt16LE(offsetLeft)
                        return `${x} <0x${x.toString(16).padStart(4, "0")}>`
                    })
                    .join(" + ")} = ${sumLeft} <0x${sumLeft
                        .toString(16)
                        .padStart(4, "0")}>`
            )
            this.log(
                `    (right) ${this.inputs
                    .map(v => {
                        const x = v.buffer.readInt16LE(offsetRight)
                        return `${x} <0x${x.toString(16).padStart(4, "0")}>`
                    })
                    .join(" + ")} = ${sumRight} <0x${sumRight
                        .toString(16)
                        .padStart(4, "0")}>`
            )

            out.writeInt16LE(
                Math.min(SAMPLE_MAX, Math.max(SAMPLE_MIN, sumLeft)),
                offsetLeft
            )
            out.writeInt16LE(
                Math.min(SAMPLE_MAX, Math.max(SAMPLE_MIN, sumRight)),
                offsetRight
            )
        }

        // shorten all buffers by N
        this.inputs.forEach(v => (v.buffer = v.buffer.slice(FRAME_BYTES * frames)))

        // keep processing if we can push more...
        this.log("Trying push!")
        const ret = this.push(out)
        if (!ret) {
            this.thirsty = false
            this.inputs.forEach(v => v.stream?.pause())
        }
        return ret
    }

    _destroy() {
        this.inputs.forEach(v => {
            v.stream?.removeListener("data", v.ondata)
            v.stream?.removeListener("end", v.onend)
            v.stream?.pause()
        })
        this.inputs = []
    }
}

export default Mixer