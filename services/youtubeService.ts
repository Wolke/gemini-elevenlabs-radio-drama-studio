/**
 * YouTube Data API Service
 * Handles OAuth 2.0 authentication and video upload for YouTube Music Podcast
 */

// YouTube API Configuration
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';

// Scopes required for video upload
const YOUTUBE_SCOPES = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube',
];

export interface YouTubeUploadMetadata {
    title: string;
    description: string;
    tags?: string[];
    categoryId?: string; // Default: 22 (People & Blogs), 10 = Music
    privacyStatus?: 'public' | 'private' | 'unlisted';
    madeForKids?: boolean;
    playlistId?: string; // For podcast playlist
}

export interface YouTubeUploadProgress {
    bytesUploaded: number;
    totalBytes: number;
    percentage: number;
}

export interface YouTubeUploadResult {
    videoId: string;
    title: string;
    url: string;
}

// Store auth state
let accessToken: string | null = null;
let tokenExpiry: number | null = null;

/**
 * Initialize YouTube OAuth flow
 * Opens a popup window for Google sign-in
 */
export async function initiateYouTubeAuth(clientId: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const redirectUri = window.location.origin;
        const scope = YOUTUBE_SCOPES.join(' ');

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'token');
        authUrl.searchParams.set('scope', scope);
        authUrl.searchParams.set('include_granted_scopes', 'true');
        authUrl.searchParams.set('prompt', 'consent');

        // Open popup
        const popup = window.open(
            authUrl.toString(),
            'youtube_auth',
            'width=600,height=700,left=200,top=100'
        );

        if (!popup) {
            reject(new Error('無法開啟認證視窗，請檢查彈出視窗封鎖設定'));
            return;
        }

        // Listen for OAuth callback
        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;

            if (event.data?.type === 'youtube_oauth_callback') {
                window.removeEventListener('message', handleMessage);
                popup.close();

                if (event.data.access_token) {
                    accessToken = event.data.access_token;
                    tokenExpiry = Date.now() + (event.data.expires_in * 1000);
                    resolve(event.data.access_token);
                } else if (event.data.error) {
                    reject(new Error(event.data.error_description || event.data.error));
                }
            }
        };

        window.addEventListener('message', handleMessage);

        // Poll for popup close
        const checkClosed = setInterval(() => {
            if (popup.closed) {
                clearInterval(checkClosed);
                window.removeEventListener('message', handleMessage);
                // Check if we have a token from hash fragment
                const hash = popup.location?.hash;
                if (hash) {
                    const params = new URLSearchParams(hash.substring(1));
                    const token = params.get('access_token');
                    if (token) {
                        accessToken = token;
                        tokenExpiry = Date.now() + (parseInt(params.get('expires_in') || '3600') * 1000);
                        resolve(token);
                        return;
                    }
                }
                reject(new Error('認證取消'));
            }
        }, 500);

        // Timeout after 5 minutes
        setTimeout(() => {
            clearInterval(checkClosed);
            popup.close();
            reject(new Error('認證逾時'));
        }, 5 * 60 * 1000);
    });
}

/**
 * Check if we have a valid access token
 */
export function isYouTubeAuthenticated(): boolean {
    return !!accessToken && !!tokenExpiry && Date.now() < tokenExpiry;
}

/**
 * Get stored access token
 */
export function getYouTubeAccessToken(): string | null {
    if (isYouTubeAuthenticated()) {
        return accessToken;
    }
    return null;
}

/**
 * Clear stored auth
 */
export function clearYouTubeAuth(): void {
    accessToken = null;
    tokenExpiry = null;
}

/**
 * Upload video to YouTube
 * Uses resumable upload protocol for reliability
 */
export async function uploadToYouTube(
    videoBlob: Blob,
    metadata: YouTubeUploadMetadata,
    token: string,
    onProgress?: (progress: YouTubeUploadProgress) => void
): Promise<YouTubeUploadResult> {
    // Step 1: Initialize resumable upload
    const initResponse = await fetch(
        `${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-Upload-Content-Length': videoBlob.size.toString(),
                'X-Upload-Content-Type': videoBlob.type || 'video/webm',
            },
            body: JSON.stringify({
                snippet: {
                    title: metadata.title,
                    description: metadata.description,
                    tags: metadata.tags || [],
                    categoryId: metadata.categoryId || '22', // People & Blogs
                    defaultLanguage: 'zh-TW',
                    defaultAudioLanguage: 'zh-TW',
                },
                status: {
                    privacyStatus: metadata.privacyStatus || 'private',
                    selfDeclaredMadeForKids: metadata.madeForKids ?? false,
                },
            }),
        }
    );

    if (!initResponse.ok) {
        const error = await initResponse.json().catch(() => ({}));
        throw new Error(error.error?.message || `初始化上傳失敗: ${initResponse.status}`);
    }

    const uploadUrl = initResponse.headers.get('Location');
    if (!uploadUrl) {
        throw new Error('無法取得上傳 URL');
    }

    // Step 2: Upload the video file
    const totalBytes = videoBlob.size;
    const chunkSize = 5 * 1024 * 1024; // 5MB chunks
    let bytesUploaded = 0;

    while (bytesUploaded < totalBytes) {
        const start = bytesUploaded;
        const end = Math.min(bytesUploaded + chunkSize, totalBytes);
        const chunk = videoBlob.slice(start, end);

        const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Length': chunk.size.toString(),
                'Content-Range': `bytes ${start}-${end - 1}/${totalBytes}`,
            },
            body: chunk,
        });

        if (uploadResponse.status === 308) {
            // Resume incomplete - check Range header for bytes received
            const range = uploadResponse.headers.get('Range');
            if (range) {
                const match = range.match(/bytes=0-(\d+)/);
                if (match) {
                    bytesUploaded = parseInt(match[1]) + 1;
                }
            } else {
                bytesUploaded = end;
            }
        } else if (uploadResponse.ok) {
            // Upload complete
            const result = await uploadResponse.json();
            return {
                videoId: result.id,
                title: result.snippet.title,
                url: `https://www.youtube.com/watch?v=${result.id}`,
            };
        } else {
            const error = await uploadResponse.json().catch(() => ({}));
            throw new Error(error.error?.message || `上傳失敗: ${uploadResponse.status}`);
        }

        // Report progress
        if (onProgress) {
            onProgress({
                bytesUploaded,
                totalBytes,
                percentage: Math.round((bytesUploaded / totalBytes) * 100),
            });
        }
    }

    throw new Error('上傳未完成');
}

/**
 * Simple upload (non-resumable) for smaller files
 */
export async function simpleUploadToYouTube(
    videoBlob: Blob,
    metadata: YouTubeUploadMetadata,
    token: string
): Promise<YouTubeUploadResult> {
    const formData = new FormData();

    // Add metadata
    const metadataBlob = new Blob([JSON.stringify({
        snippet: {
            title: metadata.title,
            description: metadata.description,
            tags: metadata.tags || [],
            categoryId: metadata.categoryId || '22',
            defaultLanguage: 'zh-TW',
            defaultAudioLanguage: 'zh-TW',
        },
        status: {
            privacyStatus: metadata.privacyStatus || 'private',
            selfDeclaredMadeForKids: metadata.madeForKids ?? false,
        },
    })], { type: 'application/json' });

    formData.append('metadata', metadataBlob);
    formData.append('video', videoBlob, 'podcast.webm');

    const response = await fetch(
        `${YOUTUBE_UPLOAD_URL}?uploadType=multipart&part=snippet,status`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
            body: formData,
        }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `上傳失敗: ${response.status}`);
    }

    const result = await response.json();
    return {
        videoId: result.id,
        title: result.snippet.title,
        url: `https://www.youtube.com/watch?v=${result.id}`,
    };
}

/**
 * Add video to a playlist (for podcast series)
 */
export async function addVideoToPlaylist(
    videoId: string,
    playlistId: string,
    token: string
): Promise<void> {
    const response = await fetch(
        `${YOUTUBE_API_BASE}/playlistItems?part=snippet`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                snippet: {
                    playlistId,
                    resourceId: {
                        kind: 'youtube#video',
                        videoId,
                    },
                },
            }),
        }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `加入播放清單失敗: ${response.status}`);
    }
}

export interface YouTubeChannel {
    id: string;
    title: string;
    description: string;
    thumbnailUrl?: string;
    customUrl?: string;
}

/**
 * Get all channels accessible by the authenticated user
 * This includes owned channels and managed brand accounts
 */
export async function listChannels(token: string): Promise<YouTubeChannel[]> {
    const channels: YouTubeChannel[] = [];
    let nextPageToken: string | null = null;

    do {
        const url = new URL(`${YOUTUBE_API_BASE}/channels`);
        url.searchParams.set('part', 'snippet,contentDetails');
        url.searchParams.set('mine', 'true');
        url.searchParams.set('maxResults', '50');
        if (nextPageToken) {
            url.searchParams.set('pageToken', nextPageToken);
        }

        const response = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || `無法取得頻道: ${response.status}`);
        }

        const data = await response.json();

        for (const item of data.items || []) {
            channels.push({
                id: item.id,
                title: item.snippet.title,
                description: item.snippet.description || '',
                thumbnailUrl: item.snippet.thumbnails?.default?.url,
                customUrl: item.snippet.customUrl,
            });
        }

        nextPageToken = data.nextPageToken || null;
    } while (nextPageToken);

    return channels;
}

export async function getChannelInfo(token: string): Promise<{ channelId: string; title: string }> {
    const response = await fetch(
        `${YOUTUBE_API_BASE}/channels?part=snippet&mine=true`,
        {
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `無法取得頻道資訊: ${response.status}`);
    }

    const data = await response.json();
    if (!data.items || data.items.length === 0) {
        throw new Error('找不到 YouTube 頻道');
    }

    return {
        channelId: data.items[0].id,
        title: data.items[0].snippet.title,
    };
}

export interface YouTubePlaylist {
    id: string;
    title: string;
    description: string;
    itemCount: number;
    thumbnailUrl?: string;
    channelId?: string;
}

/**
 * List playlists for a specific channel (or all user's playlists if no channelId)
 */
export async function listPlaylists(token: string, channelId?: string): Promise<YouTubePlaylist[]> {
    const playlists: YouTubePlaylist[] = [];
    let nextPageToken: string | null = null;

    do {
        const url = new URL(`${YOUTUBE_API_BASE}/playlists`);
        url.searchParams.set('part', 'snippet,contentDetails');
        url.searchParams.set('maxResults', '50');
        if (channelId) {
            url.searchParams.set('channelId', channelId);
        } else {
            url.searchParams.set('mine', 'true');
        }
        if (nextPageToken) {
            url.searchParams.set('pageToken', nextPageToken);
        }

        const response = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || `無法取得播放清單: ${response.status}`);
        }

        const data = await response.json();

        for (const item of data.items || []) {
            playlists.push({
                id: item.id,
                title: item.snippet.title,
                description: item.snippet.description || '',
                itemCount: item.contentDetails?.itemCount || 0,
                thumbnailUrl: item.snippet.thumbnails?.default?.url,
            });
        }

        nextPageToken = data.nextPageToken || null;
    } while (nextPageToken);

    return playlists;
}

/**
 * Create a new playlist (for podcast series)
 */
export async function createPlaylist(
    token: string,
    title: string,
    description: string = ''
): Promise<YouTubePlaylist> {
    const response = await fetch(
        `${YOUTUBE_API_BASE}/playlists?part=snippet,contentDetails`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                snippet: {
                    title,
                    description,
                    defaultLanguage: 'zh-TW',
                },
            }),
        }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `無法建立播放清單: ${response.status}`);
    }

    const item = await response.json();
    return {
        id: item.id,
        title: item.snippet.title,
        description: item.snippet.description || '',
        itemCount: 0,
    };
}

