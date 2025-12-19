
import { ScriptItem, CastMember, SceneDefinition, AspectRatio } from '../types';
import { getAudioContext } from './audioUtils';

/**
 * Generates a video (WebM) by drawing images to a canvas and syncing with audio playback.
 */
export async function generateVideoFromScript(
  items: ScriptItem[],
  cast: CastMember[],
  scenes: SceneDefinition[],
  aspectRatio: AspectRatio,
  onProgress: (msg: string) => void
): Promise<Blob> {

  // 1. Setup Canvas dimensions based on aspect ratio
  // Use higher resolution for better quality
  const width = aspectRatio === '16:9' ? 1920 : 1080;
  const height = aspectRatio === '16:9' ? 1080 : 1920;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Could not create canvas context");

  // Fill black initially
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2. Setup Audio Recording
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 44100 });
  const dest = audioCtx.createMediaStreamDestination();

  // 3. Setup MediaRecorder with HIGH QUALITY settings
  const canvasStream = canvas.captureStream(30); // 30fps
  const audioTrack = dest.stream.getAudioTracks()[0];
  if (audioTrack) {
    canvasStream.addTrack(audioTrack);
  }

  const chunks: Blob[] = [];

  // Use higher bitrate for better quality (8 Mbps)
  const recorderOptions: MediaRecorderOptions = {
    mimeType: 'video/webm; codecs=vp9',
    videoBitsPerSecond: 8000000  // 8 Mbps for high quality
  };

  const recorder = new MediaRecorder(canvasStream, recorderOptions);

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.start();

  // Helper to load image
  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  };

  // Helper to draw image with cover style
  const drawImageProp = (img: HTMLImageElement) => {
    // Fill background black
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Use "cover" style to fill canvas
    const coverScale = Math.max(canvas.width / img.width, canvas.height / img.height);
    const cx = (canvas.width / 2) - (img.width / 2) * coverScale;
    const cy = (canvas.height / 2) - (img.height / 2) * coverScale;

    ctx.drawImage(img, cx, cy, img.width * coverScale, img.height * coverScale);
  };

  // Track last loaded image to maintain frame continuity
  let lastLoadedImage: HTMLImageElement | null = null;

  // 4. Playback Loop
  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      onProgress(`Processing frame ${i + 1}/${items.length}...`);

      // A. Determine Image Source
      // Priority:
      // 1. Item's own generated image (most specific)
      // 2. Character's portrait (fallback)
      // 3. Keep previous frame (continuity)

      let imgSrc: string | undefined = undefined;

      // Try item's own image first - this should be the generated dialogue image
      if (item.imageUrl) {
        imgSrc = item.imageUrl;
        console.log(`[Video] Item ${i + 1}: Using item's generated image`);
      }

      // Fallback 1: Character portrait (for SPEECH items)
      if (!imgSrc && item.character) {
        const char = cast.find(c => c.name === item.character);
        if (char?.imageUrl) {
          imgSrc = char.imageUrl;
          console.log(`[Video] Item ${i + 1}: Fallback to character portrait: ${item.character}`);
        }
      }

      // Fallback 2: Scene background image (useful for SFX and narrator items)
      if (!imgSrc && item.location) {
        const scene = scenes.find(s => s.name === item.location);
        if (scene?.imageUrl) {
          imgSrc = scene.imageUrl;
          console.log(`[Video] Item ${i + 1}: Fallback to scene background: ${item.location}`);
        }
      }

      if (!imgSrc) {
        console.log(`[Video] Item ${i + 1}: No image found, keeping previous frame`);
      }

      // Add data: prefix if needed
      if (imgSrc && !imgSrc.startsWith('data:')) {
        imgSrc = `data:image/png;base64,${imgSrc}`;
      }

      // Load and draw if we have a new image
      if (imgSrc) {
        try {
          const img = await loadImage(imgSrc);
          lastLoadedImage = img;
          drawImageProp(img);
        } catch (e) {
          console.warn("Failed to load image for item", i);
          // Use last image if current failed
          if (lastLoadedImage) {
            drawImageProp(lastLoadedImage);
          }
        }
      } else if (lastLoadedImage) {
        // No new image, but we have a previous one - keep showing it
        drawImageProp(lastLoadedImage);
      }
      // If no image at all, canvas stays black (or previous state)

      // B. Play Audio
      if (item.audioBuffer) {
        const source = audioCtx.createBufferSource();
        source.buffer = item.audioBuffer;
        source.connect(dest);
        source.start(0);

        // Wait for audio to finish
        await new Promise<void>((resolve) => {
          source.onended = () => resolve();
          // Fallback timeout
          setTimeout(resolve, (item.audioBuffer!.duration * 1000) + 100);
        });

        // Small pause between lines
        await new Promise(r => setTimeout(r, 200));

      } else {
        // If no audio, show image for 2 seconds
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  } catch (error) {
    console.error("Video generation error", error);
    throw error;
  } finally {
    recorder.stop();
    audioCtx.close();
  }

  // Wait for stop event
  return new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      resolve(blob);
    };
  });
}
