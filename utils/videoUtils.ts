
import { ScriptItem, CastMember, AspectRatio } from '../types';
import { getAudioContext } from './audioUtils';

/**
 * Generates a video (WebM) by drawing images to a canvas and syncing with audio playback.
 */
export async function generateVideoFromScript(
  items: ScriptItem[], 
  cast: CastMember[],
  aspectRatio: AspectRatio,
  onProgress: (msg: string) => void
): Promise<Blob> {
  
  // 1. Setup Canvas dimensions based on aspect ratio
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
  
  // 3. Setup MediaRecorder
  // Capture canvas stream at 30fps
  const canvasStream = canvas.captureStream(30);
  // Add audio track to the stream
  const audioTrack = dest.stream.getAudioTracks()[0];
  if (audioTrack) {
    canvasStream.addTrack(audioTrack);
  }

  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(canvasStream, {
    mimeType: 'video/webm; codecs=vp9'
  });

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
      img.src = src; // Base64 or URL
    });
  };

  // Helper to draw image cover
  const drawImageProp = (img: HTMLImageElement) => {
    // Fill background black
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw image "contain" or "cover" style
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const x = (canvas.width / 2) - (img.width / 2) * scale;
    const y = (canvas.height / 2) - (img.height / 2) * scale;
    // Use slightly larger scale to ensure "cover" if ratios slightly mismatch, 
    // or keep "contain" if we want to see everything.
    // Let's use "cover" logic (max scale)
    const coverScale = Math.max(canvas.width / img.width, canvas.height / img.height);
    const cx = (canvas.width / 2) - (img.width / 2) * coverScale;
    const cy = (canvas.height / 2) - (img.height / 2) * coverScale;
    
    ctx.drawImage(img, cx, cy, img.width * coverScale, img.height * coverScale);
  };

  // 4. Playback Loop
  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      onProgress(`Processing frame ${i + 1}/${items.length}...`);

      // A. Determine Image
      // 1. Item's own generated image
      // 2. Character's portrait
      // 3. Previous item's image (hold frame) - Note: this logic is implied if we just keep previous drawing
      //    But we clearRect/fillRect every frame, so we need to actively find the image.
      
      let imgSrc = item.imageUrl;
      
      // Fallback to character portrait if no scene image
      if (!imgSrc && item.character) {
        const char = cast.find(c => c.name === item.character);
        if (char?.imageUrl) {
          imgSrc = `data:image/png;base64,${char.imageUrl}`;
        }
      }
      
      // Since Base64 in state might be raw base64 string without data prefix
      if (imgSrc && !imgSrc.startsWith('data:')) {
          imgSrc = `data:image/png;base64,${imgSrc}`;
      }

      if (imgSrc) {
        try {
          const img = await loadImage(imgSrc);
          drawImageProp(img);
        } catch (e) {
          console.warn("Failed to load image for item", i);
        }
      }

      // B. Play Audio
      if (item.audioBuffer) {
        // We need to play the buffer into the recording destination
        // We clone the buffer data into the new context
        const source = audioCtx.createBufferSource();
        source.buffer = item.audioBuffer; // AudioBuffer is transferable/readable usually
        
        // Connect to destination (recording)
        source.connect(dest);
        
        source.start(0);

        // Wait for it to finish
        await new Promise<void>((resolve) => {
          source.onended = () => resolve();
          // Fallback if onended doesn't fire (rare but safe)
          setTimeout(resolve, (item.audioBuffer!.duration * 1000) + 100); 
        });
        
        // Small pause between lines
        await new Promise(r => setTimeout(r, 200));

      } else {
        // If no audio (e.g., failed gen), just show image for 3 seconds
        await new Promise(r => setTimeout(r, 3000));
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
