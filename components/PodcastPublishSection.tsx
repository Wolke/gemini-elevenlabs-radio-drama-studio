/**
 * PodcastPublishSection Component
 * One-click podcast generation and export
 */

import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Loader2, Image, Rss, Sparkles, Radio, FileAudio, Wand2, Download, Check, AlertCircle, Film, Save, RefreshCw, Upload, Youtube, ExternalLink } from 'lucide-react';
import { generatePodcastCoverArt, createPodcastZip, downloadBlob, PodcastMetadata, EpisodeMetadata } from '../services/podcastService';
import { generateOpenAICoverArt } from '../services/openaiService';
import { bufferToWav, bufferToMp3, createWebmVideo, mergeAudioBuffers } from '../utils/audioUtils';
import { GeneratedPodcastInfo, ImageProvider } from '../types';
import {
    uploadToYouTube,
    getYouTubeAccessToken,
    addVideoToPlaylist,
    YouTubeUploadProgress,
    YouTubeUploadResult,
    YouTubePlaylist
} from '../services/youtubeService';

interface PodcastPublishSectionProps {
    storyText: string;
    items: { audioBuffer?: AudioBuffer | null }[];
    geminiApiKey: string;
    openaiApiKey: string;
    podcastInfo: GeneratedPodcastInfo | null;
    onGenerateAllAudio?: () => Promise<AudioBuffer[]>;
    onGeneratingChange?: (isGenerating: boolean) => void;
    onUploadStateChange?: (state: { isUploading: boolean; progress: YouTubeUploadProgress | null; result: YouTubeUploadResult | null; error: string | null }) => void;
    // Download state props
    mp3Blob: Blob | null;
    setMp3Blob: (blob: Blob | null) => void;
    webmBlob: Blob | null;
    setWebmBlob: (blob: Blob | null) => void;
    rssZipBlob: Blob | null;
    setRssZipBlob: (blob: Blob | null) => void;
    coverArtBase64: string | null;
    setCoverArtBase64: (base64: string | null) => void;
    // YouTube props from Config
    isYouTubeLoggedIn: boolean;
    selectedPlaylistId: string;
    youtubePlaylists: YouTubePlaylist[];
}

export interface PodcastPublishSectionRef {
    handleGenerateAll: () => Promise<void>;
    isGenerating: boolean;
    handleUploadToYouTube: () => Promise<void>;
    isUploadingToYouTube: boolean;
}

// Generation step status
type StepStatus = 'pending' | 'running' | 'done' | 'error';

interface GenerationStep {
    id: string;
    label: string;
    status: StepStatus;
    error?: string;
}

export const PodcastPublishSection = forwardRef<PodcastPublishSectionRef, PodcastPublishSectionProps>(({
    storyText,
    items,
    geminiApiKey,
    openaiApiKey,
    podcastInfo,
    onGenerateAllAudio,
    // YouTube props from Config
    isYouTubeLoggedIn,
    onGeneratingChange,
    selectedPlaylistId,
    youtubePlaylists,
    // Download state props
    mp3Blob, setMp3Blob,
    webmBlob, setWebmBlob,
    rssZipBlob, setRssZipBlob,
    coverArtBase64, setCoverArtBase64,
    onUploadStateChange
}, ref) => {
    // Cover art state
    // removed local coverArtBase64 state
    const [imageProvider, setImageProvider] = useState<ImageProvider>('gemini');

    // Generation state
    const [isGenerating, setIsGenerating] = useState(false);
    const [steps, setSteps] = useState<GenerationStep[]>([]);

    // Sync generation state with parent
    useEffect(() => {
        onGeneratingChange?.(isGenerating);
    }, [isGenerating, onGeneratingChange]);

    // Podcast metadata - load title/author from localStorage
    const [podcastTitle, setPodcastTitle] = useState(() => localStorage.getItem('podcastTitle') || '');
    const [podcastAuthor, setPodcastAuthor] = useState(() => localStorage.getItem('podcastAuthor') || '');
    const [podcastDescription, setPodcastDescription] = useState('');
    const [episodeTitle, setEpisodeTitle] = useState('');
    const [coverPrompt, setCoverPrompt] = useState('');
    const [isSaved, setIsSaved] = useState(false);

    // Generated outputs
    // removed local blobs state

    // YouTube upload state (only upload-related, login/channel/playlist comes from props)
    const [isUploadingToYouTube, setIsUploadingToYouTube] = useState(false);
    const [youtubeUploadProgress, setYoutubeUploadProgress] = useState<YouTubeUploadProgress | null>(null);
    const [youtubeUploadResult, setYoutubeUploadResult] = useState<YouTubeUploadResult | null>(null);
    const [youtubeUploadError, setYoutubeUploadError] = useState<string | null>(null);

    // Sync upload state with parent
    useEffect(() => {
        onUploadStateChange?.({
            isUploading: isUploadingToYouTube,
            progress: youtubeUploadProgress,
            result: youtubeUploadResult,
            error: youtubeUploadError
        });
    }, [isUploadingToYouTube, youtubeUploadProgress, youtubeUploadResult, youtubeUploadError, onUploadStateChange]);

    // Auto-fill from podcastInfo (only episodeTitle, description, coverPrompt - NOT title/author)
    useEffect(() => {
        if (podcastInfo) {
            // Only set episode-specific fields, not podcast title/author (those are saved)
            setEpisodeTitle(podcastInfo.episodeTitle || '');
            setPodcastDescription(podcastInfo.description || '');
            setCoverPrompt(podcastInfo.coverPrompt || '');
        }
    }, [podcastInfo, setEpisodeTitle, setPodcastDescription, setCoverPrompt]);

    // Save podcast title/author to localStorage
    const handleSavePodcastInfo = () => {
        localStorage.setItem('podcastTitle', podcastTitle);
        localStorage.setItem('podcastAuthor', podcastAuthor);
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 2000);
    };

    // Calculate status
    const hasAudio = items.some(item => item.audioBuffer);
    const allAudioGenerated = items.every(item => item.audioBuffer);
    const totalDuration = items.reduce((acc, item) => acc + (item.audioBuffer?.duration || 0), 0);
    const hasGeminiKey = !!geminiApiKey;
    const hasOpenaiKey = !!openaiApiKey;
    const hasAnyImageKey = hasGeminiKey || hasOpenaiKey;

    // Update step status helper
    const updateStep = (id: string, status: StepStatus, error?: string) => {
        setSteps(prev => prev.map(s => s.id === id ? { ...s, status, error } : s));
    };

    // === GENERATE ALL ===
    const handleGenerateAll = async () => {
        if (!podcastTitle || !podcastAuthor) {
            alert('Please enter Podcast title and author');
            return;
        }

        setIsGenerating(true);
        setMp3Blob(null);
        setWebmBlob(null);
        setRssZipBlob(null);
        setCoverArtBase64(null); // Clear cover art on new generation

        const initialSteps: GenerationStep[] = [
            { id: 'audio', label: 'Generate Audio', status: allAudioGenerated ? 'done' : 'pending' },
            { id: 'cover', label: 'Generate Cover', status: coverArtBase64 ? 'done' : 'pending' },
            { id: 'mp3', label: 'Create MP3', status: 'pending' },
            { id: 'webm', label: 'Create WebM Video', status: 'pending' },
            { id: 'rss', label: 'Package RSS + MP3', status: 'pending' },
        ];
        setSteps(initialSteps);

        try {
            // Step 1: Generate all audio if not done
            let buffers: AudioBuffer[] = items
                .map(i => i.audioBuffer)
                .filter((b): b is AudioBuffer => !!b);

            if (!allAudioGenerated && onGenerateAllAudio) {
                updateStep('audio', 'running');
                buffers = await onGenerateAllAudio();
                updateStep('audio', 'done');
            } else {
                updateStep('audio', 'done');
            }

            // If still no buffers after generation, throw error
            if (buffers.length === 0) {
                updateStep('audio', 'error', 'No audio available');
                throw new Error('No audio available. Please generate audio individually first.');
            }

            const mergedBuffer = await mergeAudioBuffers(buffers);
            const wavBlob = bufferToWav(mergedBuffer);

            // Step 2: Generate cover art if not done
            let cover = coverArtBase64;
            if (!cover && hasAnyImageKey) {
                updateStep('cover', 'running');
                try {
                    const prompt = coverPrompt || `Based on this story: "${storyText.slice(0, 500)}..."`;
                    if (imageProvider === 'openai' && hasOpenaiKey) {
                        const rawCover = await generateOpenAICoverArt(prompt, openaiApiKey);
                        // Compress for iTunes compatibility (<500KB)
                        const { compressImageForPodcast } = await import('../services/podcastService');
                        cover = await compressImageForPodcast(rawCover);
                    } else if (hasGeminiKey) {
                        // Gemini already compresses in generatePodcastCoverArt
                        cover = await generatePodcastCoverArt(prompt, podcastTitle, geminiApiKey);
                    }
                    setCoverArtBase64(cover);
                    updateStep('cover', 'done');
                } catch (e: any) {
                    console.error('Cover art error:', e);
                    updateStep('cover', 'error', e.message);
                }
            } else {
                updateStep('cover', cover ? 'done' : 'error');
            }

            // Step 3: Convert to MP3
            updateStep('mp3', 'running');
            try {
                const mp3 = await bufferToMp3(mergedBuffer);
                setMp3Blob(mp3);
                updateStep('mp3', 'done');
            } catch (e: any) {
                console.error('MP3 error:', e);
                updateStep('mp3', 'error', e.message);
            }

            // Step 4: Create WebM video (only if we have cover)
            if (cover) {
                updateStep('webm', 'running');
                try {
                    const webm = await createWebmVideo(wavBlob, cover, mergedBuffer.duration);
                    setWebmBlob(webm);
                    updateStep('webm', 'done');
                } catch (e: any) {
                    console.error('WebM error:', e);
                    updateStep('webm', 'error', e.message);
                }
            } else {
                updateStep('webm', 'error', 'Cover art required');
            }

            // Step 5: Create RSS ZIP package
            updateStep('rss', 'running');
            try {
                const mp3ForZip = mp3Blob || await bufferToMp3(mergedBuffer);
                const podcastMeta: PodcastMetadata = {
                    title: podcastTitle,
                    description: podcastDescription || storyText.slice(0, 500),
                    author: podcastAuthor,
                    language: 'zh-TW',
                    category: 'Arts',
                    explicit: false,
                };
                const episodeMeta: EpisodeMetadata = {
                    title: episodeTitle || `${podcastTitle} - Episode 1`,
                    description: storyText.slice(0, 1000),
                    audioFileName: 'episode_001.mp3',
                    duration: mergedBuffer.duration,
                    publishDate: new Date(),
                    episodeNumber: 1,
                };
                const zip = await createPodcastZip(
                    podcastMeta,
                    [{ metadata: episodeMeta, audioBlob: mp3ForZip }],
                    cover || undefined
                );
                setRssZipBlob(zip);
                updateStep('rss', 'done');
            } catch (e: any) {
                console.error('RSS ZIP error:', e);
                updateStep('rss', 'error', e.message);
            }

        } catch (e: any) {
            console.error('Generation error:', e);
        } finally {
            setIsGenerating(false);
        }
    };

    useImperativeHandle(ref, () => ({
        handleGenerateAll,
        isGenerating,
        handleUploadToYouTube,
        isUploadingToYouTube
    }));

    // Regenerate Cover Art
    const [isRegeneratingCover, setIsRegeneratingCover] = useState(false);
    const handleRegenerateCover = async () => {
        if (!coverPrompt && !storyText) {
            alert('Story content or prompt required to generate cover');
            return;
        }
        if (!hasAnyImageKey) {
            alert('Gemini or OpenAI API Key required');
            return;
        }

        setIsRegeneratingCover(true);
        try {
            const prompt = coverPrompt || `Based on this story: "${storyText.slice(0, 500)}..."`;
            let cover;

            if (imageProvider === 'openai' && hasOpenaiKey) {
                const rawCover = await generateOpenAICoverArt(prompt, openaiApiKey);
                // Compress for iTunes compatibility (<500KB)
                const { compressImageForPodcast } = await import('../services/podcastService');
                cover = await compressImageForPodcast(rawCover);
            } else if (hasGeminiKey) {
                // Gemini already compresses in generatePodcastCoverArt
                cover = await generatePodcastCoverArt(prompt, podcastTitle, geminiApiKey);
            } else {
                throw new Error('No valid API key for selected provider');
            }

            setCoverArtBase64(cover);
        } catch (e: any) {
            console.error('Cover regeneration error:', e);
            alert('Cover generation failed: ' + e.message);
        } finally {
            setIsRegeneratingCover(false);
        }
    };

    // Regenerate MP3 only
    const [isRegeneratingMp3, setIsRegeneratingMp3] = useState(false);
    const handleRegenerateMp3 = async () => {
        const buffers = items
            .map(i => i.audioBuffer)
            .filter((b): b is AudioBuffer => !!b);
        if (buffers.length === 0) {
            alert('No audio available');
            return;
        }
        setIsRegeneratingMp3(true);
        try {
            const mergedBuffer = await mergeAudioBuffers(buffers);
            const mp3 = await bufferToMp3(mergedBuffer);
            setMp3Blob(mp3);
        } catch (e: any) {
            console.error('MP3 regeneration error:', e);
            alert('MP3 conversion failed: ' + e.message);
        } finally {
            setIsRegeneratingMp3(false);
        }
    };

    // Regenerate WebM only
    const [isRegeneratingWebm, setIsRegeneratingWebm] = useState(false);
    const handleRegenerateWebm = async () => {
        const buffers = items
            .map(i => i.audioBuffer)
            .filter((b): b is AudioBuffer => !!b);
        if (buffers.length === 0) {
            alert('No audio available');
            return;
        }
        if (!coverArtBase64) {
            alert('Cover art required to generate video');
            return;
        }
        setIsRegeneratingWebm(true);
        try {
            const mergedBuffer = await mergeAudioBuffers(buffers);
            const wavBlob = bufferToWav(mergedBuffer);
            const webm = await createWebmVideo(wavBlob, coverArtBase64, mergedBuffer.duration);
            setWebmBlob(webm);
        } catch (e: any) {
            console.error('WebM regeneration error:', e);
            alert('WebM conversion failed: ' + e.message);
        } finally {
            setIsRegeneratingWebm(false);
        }
    };

    // Download handlers
    const handleDownloadMp3 = () => mp3Blob && downloadBlob(mp3Blob, `${episodeTitle || 'podcast'}.mp3`);
    const handleDownloadWebm = () => webmBlob && downloadBlob(webmBlob, `${episodeTitle || 'podcast'}.webm`);
    const handleDownloadRss = () => rssZipBlob && downloadBlob(rssZipBlob, `${podcastTitle.replace(/\s+/g, '_')}_podcast.zip`);
    const handleDownloadCover = () => {
        if (coverArtBase64) {
            const blob = base64ToBlob(coverArtBase64, 'image/png');
            downloadBlob(blob, 'cover.png');
        }
    };

    // === YouTube Upload ===
    // Note: Login/channel/playlist selection is now handled in App.tsx Config

    // Handle Upload to YouTube
    const handleUploadToYouTube = async () => {
        if (!webmBlob) {
            alert('Please generate WebM video first');
            return;
        }

        const token = getYouTubeAccessToken();
        if (!token) {
            alert('Please login to YouTube first');
            return;
        }

        setIsUploadingToYouTube(true);
        setYoutubeUploadProgress(null);
        setYoutubeUploadResult(null);
        setYoutubeUploadError(null);

        try {
            const result = await uploadToYouTube(
                webmBlob,
                {
                    title: episodeTitle || `${podcastTitle} - New Episode`,
                    description: `${podcastDescription || storyText.slice(0, 500)}\n\n${podcastInfo?.tags?.map(t => `#${t}`).join(' ') || ''}`,
                    tags: podcastInfo?.tags || [podcastTitle],
                    categoryId: '22', // People & Blogs (good for podcasts)
                    privacyStatus: 'private', // Start as private for safety
                    madeForKids: false,
                },
                token,
                (progress) => setYoutubeUploadProgress(progress)
            );

            // Add to playlist if selected
            if (selectedPlaylistId && result.videoId) {
                try {
                    await addVideoToPlaylist(result.videoId, selectedPlaylistId, token);
                    const playlist = youtubePlaylists.find(p => p.id === selectedPlaylistId);
                    console.log(`Video added to playlist: ${playlist?.title}`);
                } catch (e) {
                    console.warn('Could not add video to playlist:', e);
                }
            }

            setYoutubeUploadResult(result);
        } catch (e: any) {
            console.error('YouTube upload error:', e);
            setYoutubeUploadError(e.message);
        } finally {
            setIsUploadingToYouTube(false);
            setYoutubeUploadProgress(null);
        }
    };

    // Step icon component
    const StepIcon = ({ status }: { status: StepStatus }) => {
        switch (status) {
            case 'done': return <Check size={16} className="text-green-400" />;
            case 'running': return <Loader2 size={16} className="animate-spin text-blue-400" />;
            case 'error': return <AlertCircle size={16} className="text-red-400" />;
            default: return <div className="w-4 h-4 rounded-full border-2 border-zinc-600" />;
        }
    };

    return (
        <section className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-500/30 rounded-xl p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-purple-500/20 to-blue-500/20 rounded-lg">
                        <Radio className="text-purple-400" size={24} />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                            Podcast Publish
                        </h3>
                        <p className="text-xs text-zinc-500">
                            One-click generate and export all content
                        </p>
                    </div>
                </div>

                {/* Audio Status */}
                <div className="flex items-center gap-2 text-sm">
                    <FileAudio size={16} className="text-zinc-500" />
                    <span className="text-zinc-400">
                        {items.filter(i => i.audioBuffer).length}/{items.length} audio
                    </span>
                    {totalDuration > 0 && (
                        <span className="text-zinc-500">
                            ({Math.floor(totalDuration / 60)}:{Math.floor(totalDuration % 60).toString().padStart(2, '0')})
                        </span>
                    )}
                </div>
            </div>

            {/* Metadata Form - 2 columns */}
            <div className="grid grid-cols-2 gap-4">
                {/* Podcast Name + Author + Save Button - First Row */}
                <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                        Podcast Title *
                    </label>
                    <input
                        type="text"
                        value={podcastTitle}
                        onChange={(e) => setPodcastTitle(e.target.value)}
                        placeholder="e.g., Late Night Radio Drama"
                        className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                    />
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                        Author *
                        <button
                            onClick={handleSavePodcastInfo}
                            className="ml-auto flex items-center gap-1 px-2 py-0.5 text-xs bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
                            title="Save Podcast Info"
                        >
                            {isSaved ? <Check size={12} className="text-green-400" /> : <Save size={12} />}
                            {isSaved ? 'Saved' : 'Save'}
                        </button>
                    </label>
                    <input
                        type="text"
                        value={podcastAuthor}
                        onChange={(e) => setPodcastAuthor(e.target.value)}
                        placeholder="e.g., Voice Studio"
                        className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                    />
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                        Episode Title
                        {podcastInfo?.episodeTitle && <Wand2 size={10} className="text-purple-400" />}
                    </label>
                    <input
                        type="text"
                        value={episodeTitle}
                        onChange={(e) => setEpisodeTitle(e.target.value)}
                        placeholder="e.g., Episode 1: The Beginning"
                        className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                    />
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Cover Art Generator</label>
                    <div className="flex gap-1 bg-black/40 border border-zinc-700 rounded-lg p-1">
                        <button
                            onClick={() => setImageProvider('gemini')}
                            disabled={!hasGeminiKey}
                            className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${imageProvider === 'gemini' && hasGeminiKey ? 'bg-emerald-600 text-white' : 'text-zinc-500 hover:text-zinc-300'} ${!hasGeminiKey ? 'opacity-30 cursor-not-allowed' : ''}`}
                        >
                            Gemini
                        </button>
                        <button
                            onClick={() => setImageProvider('openai')}
                            disabled={!hasOpenaiKey}
                            className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${imageProvider === 'openai' && hasOpenaiKey ? 'bg-cyan-600 text-white' : 'text-zinc-500 hover:text-zinc-300'} ${!hasOpenaiKey ? 'opacity-30 cursor-not-allowed' : ''}`}
                        >
                            DALL-E
                        </button>
                    </div>
                </div>
                <div className="col-span-2 space-y-1">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                        Podcast Description
                        {podcastInfo?.description && <Wand2 size={10} className="text-purple-400" />}
                    </label>
                    <textarea
                        value={podcastDescription}
                        onChange={(e) => setPodcastDescription(e.target.value)}
                        placeholder="Brief description of your podcast content..."
                        className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 resize-none h-16"
                    />
                </div>
                <div className="col-span-2 space-y-1">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                        Cover Art Prompt
                        {podcastInfo?.coverPrompt && <Wand2 size={10} className="text-purple-400" />}
                    </label>
                    <textarea
                        value={coverPrompt}
                        onChange={(e) => setCoverPrompt(e.target.value)}
                        placeholder="Describe the style and content of the cover, e.g., A retro-style radio glowing in the night..."
                        className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 resize-none h-16"
                    />
                </div>
            </div>

            {/* Main Action Area */}
            <div className="grid grid-cols-3 gap-4">
                {/* Cover Preview */}
                <div className="bg-black/30 rounded-lg p-3 flex flex-col items-center justify-center">
                    <div className="w-24 h-24 bg-zinc-800 rounded-lg flex items-center justify-center border border-zinc-700 overflow-hidden mb-2">
                        {coverArtBase64 ? (
                            <img
                                src={`data:image/png;base64,${coverArtBase64}`}
                                alt="Cover"
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <Image size={32} className="text-zinc-600" />
                        )}
                    </div>
                    <span className="text-xs text-zinc-500">Cover Preview</span>
                </div>

                {/* Generate All Button */}
                <div className="col-span-2 flex items-center justify-center text-xs text-zinc-500 text-center">
                    Audio → Cover Art → MP3 → WebM Video → RSS Package
                </div>
            </div>


            {/* Generation Progress */}
            {
                steps.length > 0 && (
                    <div className="bg-black/30 rounded-lg p-4 space-y-2">
                        <div className="text-sm font-semibold text-zinc-300 mb-3">Generation Progress</div>
                        <div className="grid grid-cols-5 gap-2">
                            {steps.map(step => (
                                <div key={step.id} className="flex flex-col items-center gap-1">
                                    <StepIcon status={step.status} />
                                    <span className={`text-xs ${step.status === 'done' ? 'text-green-400' : step.status === 'error' ? 'text-red-400' : 'text-zinc-500'}`}>
                                        {step.label}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )
            }

            {/* Regenerate Buttons - show when audio exists */}
            {
                hasAudio && (
                    <div className="flex gap-3">
                        <button
                            onClick={handleRegenerateCover}
                            disabled={isRegeneratingCover || isGenerating}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 rounded-lg text-sm text-purple-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isRegeneratingCover ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                            Regenerate Cover
                        </button>
                        <button
                            onClick={handleRegenerateMp3}
                            disabled={isRegeneratingMp3 || isGenerating}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-orange-600/20 hover:bg-orange-600/30 border border-orange-500/30 rounded-lg text-sm text-orange-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isRegeneratingMp3 ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                            Regenerate MP3
                        </button>
                        <button
                            onClick={handleRegenerateWebm}
                            disabled={isRegeneratingWebm || isGenerating || !coverArtBase64}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 rounded-lg text-sm text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isRegeneratingWebm ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                            Regenerate WebM
                        </button>
                    </div>
                )
            }

            {/* Download Buttons Section REMOVED */}

            {/* YouTube Upload Section MOVED TO FOOTER */}

            {/* Platform Info */}
            <div className="bg-black/20 rounded-lg p-3 border border-zinc-800">
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Rss size={14} />
                    <span>Supported platforms: YouTube Music (MP4), Spotify, Apple Podcasts, Podbean (RSS+MP3)</span>
                </div>
            </div>
        </section >
    );
});

// Helper function
function base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64);
    const byteNumbers = new Uint8Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    return new Blob([byteNumbers.buffer], { type: mimeType });
}
