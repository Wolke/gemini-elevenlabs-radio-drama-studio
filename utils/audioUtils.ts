// Base64 decoding
function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Decode Raw PCM to AudioBuffer (For Gemini)
export async function decodeRawPCM(
  base64Data: string,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  const bytes = decodeBase64(base64Data);
  const dataInt16 = new Int16Array(bytes.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Decode standard audio files (MP3/WAV) to AudioBuffer (For ElevenLabs)
export async function decodeAudioFile(
  base64Data: string,
  ctx: AudioContext
): Promise<AudioBuffer> {
  const bytes = decodeBase64(base64Data);
  // Copy to a fresh ArrayBuffer because decodeAudioData detaches the buffer
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return await ctx.decodeAudioData(arrayBuffer);
}

// Shared AudioContext (created on user interaction usually, but we can init lazily)
let audioContext: AudioContext | null = null;

export const getAudioContext = () => {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 24000 // Match Gemini TTS default, though decodeAudioData will resample if needed
    });
  }
  return audioContext;
};

// --- Export Utilities ---

/**
 * Merges multiple AudioBuffers into a single AudioBuffer sequentially.
 */
export async function mergeAudioBuffers(buffers: AudioBuffer[]): Promise<AudioBuffer> {
  const ctx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(
    1, // Output channels (mono is safer for mixed sources)
    1, // Temporary length, will be ignored by constructor but needed
    44100 // Standard export sample rate
  );

  // Calculate total duration
  const totalDuration = buffers.reduce((acc, b) => acc + b.duration, 0);
  const totalLength = Math.ceil(totalDuration * 44100);

  // Create the actual context with correct length
  const offlineCtx = new OfflineAudioContext(1, totalLength, 44100);

  let currentOffset = 0;
  for (const buffer of buffers) {
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineCtx.destination);
    source.start(currentOffset);
    currentOffset += buffer.duration;
  }

  return await offlineCtx.startRendering();
}

/**
 * Encodes an AudioBuffer to a WAV Blob.
 */
export function bufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // write WAVE header
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit (hardcoded in this encoder)

  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  // write interleaved data
  for (i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while (pos < buffer.length) {
    for (i = 0; i < numOfChan; i++) {
      // clamp
      sample = Math.max(-1, Math.min(1, channels[i][pos]));
      // scale to 16-bit signed int
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(44 + offset, sample, true);
      offset += 2;
    }
    pos++;
  }

  return new Blob([bufferArr], { type: "audio/wav" });

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}

/**
 * Convert Blob to Base64 Data URL string
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Encodes an AudioBuffer to MP3 format using @breezystack/lamejs
 * Falls back to WAV if MP3 encoding fails
 */
export async function bufferToMp3(buffer: AudioBuffer): Promise<Blob> {
  try {
    // Import the ES module compatible version of lamejs
    const { Mp3Encoder } = await import('@breezystack/lamejs');

    const mp3encoder = new Mp3Encoder(1, buffer.sampleRate, 128); // mono, sample rate, 128kbps
    const samples = buffer.getChannelData(0);

    // Convert Float32Array to Int16Array
    const sampleBlockSize = 1152; // must be multiple of 576
    const int16Samples = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      int16Samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    const mp3Data: Uint8Array[] = [];

    // Encode in blocks
    for (let i = 0; i < int16Samples.length; i += sampleBlockSize) {
      const sampleChunk = int16Samples.subarray(i, i + sampleBlockSize);
      const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
      if (mp3buf.length > 0) {
        mp3Data.push(new Uint8Array(mp3buf));
      }
    }

    // Flush remaining data
    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }

    // Combine all chunks into one Uint8Array
    const totalLength = mp3Data.reduce((acc, arr) => acc + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of mp3Data) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return new Blob([result.buffer], { type: 'audio/mp3' });
  } catch (error) {
    console.warn('MP3 encoding failed, using WAV format instead:', error);
    // Fallback to WAV if MP3 encoding fails
    return bufferToWav(buffer);
  }
}


/**
 * Creates an MP4 video with static image and audio using FFmpeg WASM
 * @param audioBlob - Audio file (WAV or MP3)
 * @param imageBase64 - Base64 encoded cover image (PNG/JPG)
 * @returns MP4 video blob
 */
export async function createMp4Video(
  audioBlob: Blob,
  imageBase64: string
): Promise<Blob> {
  // Dynamic import FFmpeg
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const { fetchFile, toBlobURL } = await import('@ffmpeg/util');

  const ffmpeg = new FFmpeg();

  // Load FFmpeg WASM
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  // Write audio file
  const audioData = await fetchFile(audioBlob);
  await ffmpeg.writeFile('audio.wav', audioData);

  // Write image file
  const imageBytes = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
  await ffmpeg.writeFile('cover.png', imageBytes);

  // Create MP4: loop image for duration of audio, add audio track
  await ffmpeg.exec([
    '-loop', '1',           // Loop the image
    '-i', 'cover.png',      // Input image
    '-i', 'audio.wav',      // Input audio
    '-c:v', 'libx264',      // Video codec: H.264
    '-tune', 'stillimage',  // Optimize for still image
    '-c:a', 'aac',          // Audio codec: AAC
    '-b:a', '192k',         // Audio bitrate
    '-pix_fmt', 'yuv420p',  // Pixel format for compatibility
    '-shortest',            // End when shortest input ends (audio)
    '-movflags', '+faststart', // Optimize for web playback
    'output.mp4'
  ]);

  // Read the output file
  const data = await ffmpeg.readFile('output.mp4');

  // Convert to ArrayBuffer for Blob compatibility
  const buffer = data instanceof Uint8Array
    ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    : data;

  return new Blob([buffer], { type: 'video/mp4' });
}