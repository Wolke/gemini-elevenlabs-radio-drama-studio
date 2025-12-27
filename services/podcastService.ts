/**
 * Podcast Publishing Service
 * Handles cover art generation and export for podcast platforms
 */

// === Cover Art Generation (using Gemini/Nano Banana Pro) ===

/**
 * Generate podcast cover art using Gemini's image generation capabilities
 * @param prompt - Description of the desired cover art
 * @param title - Podcast episode title (for text overlay)
 * @param apiKey - Gemini API key
 */
export async function generatePodcastCoverArt(
    prompt: string,
    title: string,
    apiKey: string
): Promise<string> {
    // Use Gemini 2.0 Flash with image generation
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            contents: [{
                parts: [{
                    text: `Create a professional podcast cover art image (square format, 1400x1400 pixels ideal for podcast platforms).

Title: "${title}"

Style requirements:
- Modern, clean design suitable for podcast platforms
- Bold typography for the title if included
- Eye-catching colors and visual elements
- Professional radio drama / audio storytelling aesthetic

Additional context: ${prompt}

Generate a high-quality cover art that would look great on Spotify, Apple Podcasts, and YouTube Music.`
                }]
            }],
            generationConfig: {
                responseModalities: ["IMAGE", "TEXT"],
                responseMimeType: "text/plain"
            }
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to generate cover art: ${response.statusText}`);
    }

    const data = await response.json();

    // Extract base64 image from response
    const imagePart = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (!imagePart?.inlineData?.data) {
        throw new Error('No image generated. Please try a different prompt.');
    }

    return imagePart.inlineData.data; // Base64 encoded image
}

// === RSS Feed Generation ===

export interface PodcastMetadata {
    title: string;
    description: string;
    author: string;
    email?: string;
    language: string;
    category: string;
    explicit: boolean;
    websiteUrl?: string;
    coverArtBase64?: string;
}

export interface EpisodeMetadata {
    title: string;
    description: string;
    audioFileName: string;
    duration: number; // in seconds
    publishDate: Date;
    episodeNumber?: number;
    seasonNumber?: number;
}

/**
 * Generate RSS feed XML for podcast hosting platforms
 */
export function generateRSSFeed(
    podcast: PodcastMetadata,
    episodes: EpisodeMetadata[],
    baseUrl: string = 'https://example.com/podcast'
): string {
    const escapeXml = (str: string) => str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const formatDuration = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
    };

    const episodesXml = episodes.map((ep, idx) => `
    <item>
      <title>${escapeXml(ep.title)}</title>
      <description><![CDATA[${ep.description}]]></description>
      <enclosure url="${baseUrl}/episodes/${ep.audioFileName}" type="audio/mpeg" length="0"/>
      <guid isPermaLink="false">${baseUrl}/episodes/${ep.audioFileName}</guid>
      <pubDate>${ep.publishDate.toUTCString()}</pubDate>
      <itunes:duration>${formatDuration(ep.duration)}</itunes:duration>
      <itunes:episode>${ep.episodeNumber || idx + 1}</itunes:episode>
      ${ep.seasonNumber ? `<itunes:season>${ep.seasonNumber}</itunes:season>` : ''}
      <itunes:explicit>${podcast.explicit ? 'yes' : 'no'}</itunes:explicit>
    </item>`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" 
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(podcast.title)}</title>
    <description><![CDATA[${podcast.description}]]></description>
    <language>${podcast.language}</language>
    <link>${podcast.websiteUrl || baseUrl}</link>
    <atom:link href="${baseUrl}/feed.xml" rel="self" type="application/rss+xml"/>
    
    <itunes:author>${escapeXml(podcast.author)}</itunes:author>
    <itunes:owner>
      <itunes:name>${escapeXml(podcast.author)}</itunes:name>
      ${podcast.email ? `<itunes:email>${escapeXml(podcast.email)}</itunes:email>` : ''}
    </itunes:owner>
    <itunes:category text="${escapeXml(podcast.category)}"/>
    <itunes:explicit>${podcast.explicit ? 'yes' : 'no'}</itunes:explicit>
    <itunes:image href="${baseUrl}/cover.jpg"/>
    
    ${episodesXml}
  </channel>
</rss>`;
}

// === MP4 Video Generation (for YouTube Music) ===

/**
 * Create a simple MP4 video with static image and audio
 * Uses browser canvas and MediaRecorder for encoding
 */
export async function createVideoFromAudioAndImage(
    audioBlob: Blob,
    imageBase64: string,
    duration: number
): Promise<Blob> {
    return new Promise(async (resolve, reject) => {
        try {
            // Create offscreen canvas for the video frame
            const canvas = document.createElement('canvas');
            canvas.width = 1920;
            canvas.height = 1080;
            const ctx = canvas.getContext('2d')!;

            // Load cover image
            const img = new Image();
            img.onload = async () => {
                // Draw centered image on canvas
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Calculate dimensions to maintain aspect ratio and center
                const scale = Math.min(
                    canvas.width / img.width,
                    canvas.height / img.height
                );
                const x = (canvas.width - img.width * scale) / 2;
                const y = (canvas.height - img.height * scale) / 2;
                ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

                // Create video stream from canvas
                const videoStream = canvas.captureStream(1); // 1 FPS for static image

                // Create audio context for mixing
                const audioContext = new AudioContext();
                const audioBuffer = await audioContext.decodeAudioData(await audioBlob.arrayBuffer());

                // Create audio source and destination
                const audioSource = audioContext.createBufferSource();
                audioSource.buffer = audioBuffer;

                const audioDestination = audioContext.createMediaStreamDestination();
                audioSource.connect(audioDestination);

                // Combine video and audio streams
                const combinedStream = new MediaStream([
                    ...videoStream.getVideoTracks(),
                    ...audioDestination.stream.getAudioTracks()
                ]);

                // Create MediaRecorder
                const mediaRecorder = new MediaRecorder(combinedStream, {
                    mimeType: 'video/webm;codecs=vp9,opus',
                    videoBitsPerSecond: 2500000,
                    audioBitsPerSecond: 128000
                });

                const chunks: Blob[] = [];
                mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) chunks.push(e.data);
                };

                mediaRecorder.onstop = () => {
                    const videoBlob = new Blob(chunks, { type: 'video/webm' });
                    resolve(videoBlob);
                };

                mediaRecorder.onerror = (e) => reject(e);

                // Start recording and audio playback
                mediaRecorder.start();
                audioSource.start();

                // Stop after audio duration
                setTimeout(() => {
                    mediaRecorder.stop();
                    audioSource.stop();
                    audioContext.close();
                }, duration * 1000 + 500); // Add small buffer
            };

            img.onerror = () => reject(new Error('Failed to load cover image'));
            img.src = `data:image/png;base64,${imageBase64}`;
        } catch (error) {
            reject(error);
        }
    });
}

// === ZIP Export ===

/**
 * Create a ZIP file containing RSS feed and audio files
 * Uses JSZip library (needs to be loaded)
 */
export async function createPodcastZip(
    podcast: PodcastMetadata,
    episodes: { metadata: EpisodeMetadata; audioBlob: Blob }[],
    coverImageBase64?: string
): Promise<Blob> {
    // Dynamic import JSZip (we'll add this as a dependency)
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    // Add RSS feed
    const rssFeed = generateRSSFeed(
        podcast,
        episodes.map(e => e.metadata),
        'https://YOUR_HOSTING_URL' // Placeholder for user to replace
    );
    zip.file('feed.xml', rssFeed);

    // Add cover image if provided
    if (coverImageBase64) {
        const coverBlob = base64ToBlob(coverImageBase64, 'image/png');
        zip.file('cover.png', coverBlob);
    }

    // Add audio files in episodes folder
    const episodesFolder = zip.folder('episodes')!;
    for (const episode of episodes) {
        episodesFolder.file(episode.metadata.audioFileName, episode.audioBlob);
    }

    // Add README with instructions
    const readme = `# Podcast Upload Package

## Contents
- feed.xml: RSS feed for podcast platforms
- cover.png: Podcast cover art (${podcast.title})
- episodes/: Audio files for each episode

## How to Use

### For Spotify / Apple Podcasts / Podbean:
1. Upload all files to a web hosting service (e.g., AWS S3, GitHub Pages, Netlify)
2. Update the URLs in feed.xml to point to your hosted files
3. Submit your RSS feed URL to your preferred podcast platform

### For YouTube Music:
1. Go to YouTube Studio → Content → Podcasts
2. Click "Create" → "New Podcast" → "Submit an RSS feed"
3. Enter your hosted RSS feed URL

## Generated on
${new Date().toISOString()}

## Podcast Info
Title: ${podcast.title}
Author: ${podcast.author}
Episodes: ${episodes.length}
`;
    zip.file('README.md', readme);

    return await zip.generateAsync({ type: 'blob' });
}

// Helper function to convert base64 to Blob
function base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64);
    const byteNumbers = new Uint8Array(byteCharacters.length);

    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }

    return new Blob([byteNumbers.buffer], { type: mimeType });
}

// Export helper for downloading
export function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
