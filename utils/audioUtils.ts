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
 * Creates a WebM video with static image and audio using native browser APIs
 * @param audioBlob - Audio file (WAV)
 * @param imageBase64 - Base64 encoded cover image (PNG/JPG)
 * @param duration - Duration in seconds
 * @returns WebM video blob
 */
export async function createWebmVideo(
  audioBlob: Blob,
  imageBase64: string,
  duration: number
): Promise<Blob> {
  // Create a canvas with the cover image
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d')!;

  // Load and draw the image
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = `data:image/png;base64,${imageBase64}`;
  });

  // Draw image centered and scaled to fit
  const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
  const x = (canvas.width - img.width * scale) / 2;
  const y = (canvas.height - img.height * scale) / 2;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

  // Create video stream from canvas
  const stream = canvas.captureStream(1); // 1 fps is enough for static image

  // Create audio context and source
  const audioContext = new AudioContext();
  const audioBuffer = await audioContext.decodeAudioData(await audioBlob.arrayBuffer());
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;

  // Create MediaStreamDestination for audio
  const dest = audioContext.createMediaStreamDestination();
  source.connect(dest);

  // Combine video and audio streams
  const combinedStream = new MediaStream([
    ...stream.getVideoTracks(),
    ...dest.stream.getAudioTracks()
  ]);

  // Record the combined stream
  const mediaRecorder = new MediaRecorder(combinedStream, {
    mimeType: 'video/webm;codecs=vp9,opus'
  });

  const chunks: Blob[] = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  // Start recording
  source.start();
  mediaRecorder.start();

  // Wait for duration + small buffer
  await new Promise(r => setTimeout(r, duration * 1000 + 500));

  // Stop recording
  mediaRecorder.stop();
  source.stop();
  audioContext.close();

  // Wait for data to be available
  await new Promise<void>(resolve => {
    mediaRecorder.onstop = () => resolve();
  });

  return new Blob(chunks, { type: 'video/webm' });
}