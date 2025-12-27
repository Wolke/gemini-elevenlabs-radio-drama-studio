/**
 * PodcastPublishSection Component
 * Provides UI for generating cover art and publishing to podcast platforms
 */

import React, { useState, useEffect } from 'react';
import { Loader2, Image, Youtube, Rss, Sparkles, Radio, FileAudio, Archive, Wand2, Film, Music } from 'lucide-react';
import { generatePodcastCoverArt, createPodcastZip, downloadBlob, PodcastMetadata, EpisodeMetadata } from '../services/podcastService';
import { generateOpenAICoverArt } from '../services/openaiService';
import { bufferToWav, bufferToMp3, createMp4Video } from '../utils/audioUtils';
import { GeneratedPodcastInfo, ImageProvider } from '../types';

interface PodcastPublishSectionProps {
    storyText: string;
    items: { audioBuffer?: AudioBuffer | null }[];
    geminiApiKey: string;
    openaiApiKey: string;
    podcastInfo: GeneratedPodcastInfo | null;
}

export const PodcastPublishSection: React.FC<PodcastPublishSectionProps> = ({
    storyText,
    items,
    geminiApiKey,
    openaiApiKey,
    podcastInfo
}) => {
    // Cover art state
    const [coverPrompt, setCoverPrompt] = useState('');
    const [coverArtBase64, setCoverArtBase64] = useState<string | null>(null);
    const [isGeneratingCover, setIsGeneratingCover] = useState(false);
    const [coverError, setCoverError] = useState<string | null>(null);
    const [imageProvider, setImageProvider] = useState<ImageProvider>('gemini');

    // Podcast metadata - initialize from podcastInfo if available
    const [podcastTitle, setPodcastTitle] = useState('');
    const [podcastDescription, setPodcastDescription] = useState('');
    const [podcastAuthor, setPodcastAuthor] = useState('');
    const [episodeTitle, setEpisodeTitle] = useState('');

    // Export state
    const [isExportingYouTube, setIsExportingYouTube] = useState(false);
    const [isExportingMp4, setIsExportingMp4] = useState(false);
    const [isExportingRSS, setIsExportingRSS] = useState(false);
    const [exportProgress, setExportProgress] = useState('');

    // Auto-fill from podcastInfo when it changes
    useEffect(() => {
        if (podcastInfo) {
            setPodcastTitle(podcastInfo.podcastName || '');
            setPodcastAuthor(podcastInfo.author || '');
            setEpisodeTitle(podcastInfo.episodeTitle || '');
            setPodcastDescription(podcastInfo.description || '');
            setCoverPrompt(podcastInfo.coverPrompt || '');
        }
    }, [podcastInfo]);

    // Calculate if we have audio to export
    const hasAudio = items.some(item => item.audioBuffer);

    // Calculate total duration
    const totalDuration = items.reduce((acc, item) => {
        return acc + (item.audioBuffer?.duration || 0);
    }, 0);

    // Check which API keys are available
    const hasGeminiKey = !!geminiApiKey;
    const hasOpenaiKey = !!openaiApiKey;
    const hasAnyImageKey = hasGeminiKey || hasOpenaiKey;

    // Generate cover art using selected provider
    const handleGenerateCover = async () => {
        if (!hasAnyImageKey) {
            setCoverError('Please enter Gemini or OpenAI API key first.');
            return;
        }

        setIsGeneratingCover(true);
        setCoverError(null);

        try {
            const prompt = coverPrompt || `Based on this story: "${storyText.slice(0, 500)}..."`;
            let base64: string;

            if (imageProvider === 'openai' && hasOpenaiKey) {
                base64 = await generateOpenAICoverArt(prompt, openaiApiKey);
            } else if (hasGeminiKey) {
                base64 = await generatePodcastCoverArt(
                    prompt,
                    podcastTitle || 'Radio Drama',
                    geminiApiKey
                );
            } else {
                throw new Error('No API key available for the selected provider');
            }

            setCoverArtBase64(base64);
        } catch (e: any) {
            console.error('Cover generation error:', e);
            setCoverError(e.message || 'Failed to generate cover art');
        } finally {
            setIsGeneratingCover(false);
        }
    };

    // Export for YouTube Music (WebM video with static cover)
    const handleExportYouTube = async () => {
        if (!hasAudio) {
            alert('Please generate audio first.');
            return;
        }

        setIsExportingYouTube(true);
        try {
            // Merge all audio buffers
            const buffers = items
                .map(i => i.audioBuffer)
                .filter((b): b is AudioBuffer => !!b);

            // Create merged WAV blob
            const { mergeAudioBuffers } = await import('../utils/audioUtils');
            const merged = await mergeAudioBuffers(buffers);
            const wavBlob = bufferToWav(merged);

            if (coverArtBase64) {
                // If we have cover art, create video
                const { createVideoFromAudioAndImage } = await import('../services/podcastService');
                try {
                    const videoBlob = await createVideoFromAudioAndImage(
                        wavBlob,
                        coverArtBase64,
                        merged.duration
                    );
                    downloadBlob(videoBlob, `${episodeTitle || 'podcast_episode'}.webm`);
                } catch (videoError) {
                    console.warn('Video creation failed, falling back to audio + image download:', videoError);
                    // Fallback: download audio and cover separately
                    downloadBlob(wavBlob, `${episodeTitle || 'podcast_episode'}.wav`);

                    // Also download cover as image
                    const coverBlob = base64ToBlob(coverArtBase64, 'image/png');
                    downloadBlob(coverBlob, 'cover.png');
                    alert('Video creation not supported in this browser. Downloaded audio and cover image separately. You can combine them using video editing software for YouTube upload.');
                }
            } else {
                // No cover, just download audio
                downloadBlob(wavBlob, `${episodeTitle || 'podcast_episode'}.wav`);
                alert('Consider generating a cover art for better YouTube Music presentation!');
            }
        } catch (e: any) {
            console.error('YouTube export error:', e);
            alert(`Export failed: ${e.message}`);
        } finally {
            setIsExportingYouTube(false);
        }
    };

    // Export MP4 video for YouTube Music with FFmpeg
    const handleExportMp4 = async () => {
        if (!hasAudio) {
            alert('請先生成音訊');
            return;
        }

        if (!coverArtBase64) {
            alert('請先生成封面圖以製作 MP4 影片');
            return;
        }

        setIsExportingMp4(true);
        setExportProgress('正在合併音訊...');

        try {
            // Merge all audio buffers
            const buffers = items
                .map(i => i.audioBuffer)
                .filter((b): b is AudioBuffer => !!b);

            const { mergeAudioBuffers } = await import('../utils/audioUtils');
            const merged = await mergeAudioBuffers(buffers);
            const wavBlob = bufferToWav(merged);

            setExportProgress('正在載入 FFmpeg...');

            // Create MP4 with FFmpeg
            const mp4Blob = await createMp4Video(wavBlob, coverArtBase64);

            setExportProgress('正在儲存...');
            downloadBlob(mp4Blob, `${episodeTitle || 'podcast_episode'}.mp4`);
            setExportProgress('');
        } catch (e: any) {
            console.error('MP4 export error:', e);
            alert(`MP4 匯出失敗: ${e.message}\n\n如果問題持續，請嘗試使用 YouTube Music 按鈕匯出 WebM 格式。`);
            setExportProgress('');
        } finally {
            setIsExportingMp4(false);
        }
    };

    // Export RSS package for third-party platforms
    const handleExportRSS = async () => {
        if (!hasAudio) {
            alert('Please generate audio first.');
            return;
        }

        if (!podcastTitle || !podcastAuthor) {
            alert('Please fill in podcast title and author.');
            return;
        }

        setIsExportingRSS(true);
        try {
            // Merge all audio buffers
            const buffers = items
                .map(i => i.audioBuffer)
                .filter((b): b is AudioBuffer => !!b);

            const { mergeAudioBuffers } = await import('../utils/audioUtils');
            const merged = await mergeAudioBuffers(buffers);

            // Convert to MP3 for better compatibility with podcast platforms
            setExportProgress('正在轉換為 MP3...');
            const mp3Blob = await bufferToMp3(merged);

            // Prepare podcast metadata
            const podcastMeta: PodcastMetadata = {
                title: podcastTitle,
                description: podcastDescription || storyText.slice(0, 500),
                author: podcastAuthor,
                language: 'zh-TW',
                category: 'Arts',
                explicit: false,
            };

            // Prepare episode metadata
            const episodeMeta: EpisodeMetadata = {
                title: episodeTitle || `${podcastTitle} - Episode 1`,
                description: storyText.slice(0, 1000),
                audioFileName: 'episode_001.mp3',
                duration: merged.duration,
                publishDate: new Date(),
                episodeNumber: 1,
            };

            // Create ZIP package with MP3
            const zipBlob = await createPodcastZip(
                podcastMeta,
                [{ metadata: episodeMeta, audioBlob: mp3Blob }],
                coverArtBase64 || undefined
            );

            downloadBlob(zipBlob, `${podcastTitle.replace(/\s+/g, '_')}_podcast_package.zip`);
            setExportProgress('');
        } catch (e: any) {
            console.error('RSS export error:', e);
            alert(`匯出失敗: ${e.message}`);
            setExportProgress('');
        } finally {
            setIsExportingRSS(false);
        }
    };

    return (
        <section className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-500/30 rounded-xl p-6 space-y-6">
            {/* Section Header */}
            <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-purple-500/20 to-blue-500/20 rounded-lg">
                    <Radio className="text-purple-400" size={24} />
                </div>
                <div>
                    <h3 className="text-lg font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                        Podcast 發布區
                    </h3>
                    <p className="text-xs text-zinc-500">
                        {podcastInfo ? '✨ 資訊已由 AI 自動生成，可自行編輯' : '生成封面、匯出至 YouTube Music 或第三方平台'}
                    </p>
                </div>
            </div>

            {/* Podcast Metadata Form */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                        Podcast 名稱 *
                        {podcastInfo?.podcastName && <Wand2 size={10} className="text-purple-400" />}
                    </label>
                    <input
                        type="text"
                        value={podcastTitle}
                        onChange={(e) => setPodcastTitle(e.target.value)}
                        placeholder="例：深夜廣播劇場"
                        className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                    />
                </div>
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                        作者 *
                        {podcastInfo?.author && <Wand2 size={10} className="text-purple-400" />}
                    </label>
                    <input
                        type="text"
                        value={podcastAuthor}
                        onChange={(e) => setPodcastAuthor(e.target.value)}
                        placeholder="例：聲優工作室"
                        className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                    />
                </div>
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                        本集標題
                        {podcastInfo?.episodeTitle && <Wand2 size={10} className="text-purple-400" />}
                    </label>
                    <input
                        type="text"
                        value={episodeTitle}
                        onChange={(e) => setEpisodeTitle(e.target.value)}
                        placeholder="例：第一集：故事開始"
                        className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                    />
                </div>
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">總時長</label>
                    <div className="flex items-center gap-2 bg-black/40 border border-zinc-700 rounded-lg px-3 py-2">
                        <FileAudio size={16} className="text-zinc-500" />
                        <span className="text-sm text-zinc-300">
                            {totalDuration > 0
                                ? `${Math.floor(totalDuration / 60)}:${Math.floor(totalDuration % 60).toString().padStart(2, '0')}`
                                : '尚未生成音訊'
                            }
                        </span>
                    </div>
                </div>
                <div className="md:col-span-2 space-y-2">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                        Podcast 描述
                        {podcastInfo?.description && <Wand2 size={10} className="text-purple-400" />}
                    </label>
                    <textarea
                        value={podcastDescription}
                        onChange={(e) => setPodcastDescription(e.target.value)}
                        placeholder="簡短描述你的 Podcast 內容..."
                        className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 resize-none h-20"
                    />
                </div>
            </div>

            {/* Cover Art Section */}
            <div className="bg-black/30 rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Image size={18} className="text-purple-400" />
                        <span className="text-sm font-semibold text-zinc-300">封面圖生成</span>
                    </div>
                    {/* Image Provider Toggle */}
                    <div className="flex gap-1 bg-zinc-900 rounded p-0.5">
                        <button
                            onClick={() => setImageProvider('gemini')}
                            disabled={!hasGeminiKey}
                            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${imageProvider === 'gemini' && hasGeminiKey ? 'bg-emerald-600 text-white' : 'text-zinc-500 hover:text-zinc-300'} ${!hasGeminiKey ? 'opacity-30 cursor-not-allowed' : ''}`}
                        >
                            Gemini
                        </button>
                        <button
                            onClick={() => setImageProvider('openai')}
                            disabled={!hasOpenaiKey}
                            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${imageProvider === 'openai' && hasOpenaiKey ? 'bg-cyan-600 text-white' : 'text-zinc-500 hover:text-zinc-300'} ${!hasOpenaiKey ? 'opacity-30 cursor-not-allowed' : ''}`}
                        >
                            DALL-E
                        </button>
                    </div>
                </div>

                <div className="flex gap-4">
                    {/* Cover Preview */}
                    <div className="w-32 h-32 bg-zinc-800 rounded-lg flex items-center justify-center border border-zinc-700 overflow-hidden flex-shrink-0">
                        {coverArtBase64 ? (
                            <img
                                src={`data:image/png;base64,${coverArtBase64}`}
                                alt="Podcast Cover"
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <div className="text-center text-zinc-600 p-2">
                                <Image size={32} className="mx-auto mb-1" />
                                <span className="text-[10px]">Preview</span>
                            </div>
                        )}
                    </div>

                    {/* Cover Generation Form */}
                    <div className="flex-1 space-y-3">
                        <div className="space-y-1">
                            <label className="text-xs text-zinc-500 flex items-center gap-1">
                                封面描述
                                {podcastInfo?.coverPrompt && <span className="text-purple-400">(AI 已生成提示)</span>}
                            </label>
                            <textarea
                                value={coverPrompt}
                                onChange={(e) => setCoverPrompt(e.target.value)}
                                placeholder="例：一個復古風格的收音機在深夜發光，周圍有星星和神秘的霧氣"
                                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-purple-500 resize-none h-16"
                            />
                        </div>
                        <button
                            onClick={handleGenerateCover}
                            disabled={isGeneratingCover || !hasAnyImageKey}
                            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-lg text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isGeneratingCover ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : (
                                <Sparkles size={14} />
                            )}
                            用 {imageProvider === 'openai' ? 'DALL-E' : 'Gemini'} 生成封面
                        </button>
                        {coverError && <p className="text-red-400 text-xs">{coverError}</p>}
                        {!hasAnyImageKey && <p className="text-amber-400 text-xs">⚠ 需要 Gemini 或 OpenAI API Key</p>}
                    </div>
                </div>
            </div>

            {/* Export Buttons */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* MP4 Export for YouTube Music */}
                <button
                    onClick={handleExportMp4}
                    disabled={!hasAudio || !coverArtBase64 || isExportingMp4}
                    className="flex items-center justify-center gap-3 px-4 py-4 bg-gradient-to-r from-red-600/20 to-orange-600/20 hover:from-red-600/30 hover:to-orange-600/30 border border-red-500/30 rounded-xl text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                    {isExportingMp4 ? (
                        <Loader2 size={24} className="animate-spin text-red-400" />
                    ) : (
                        <Film size={24} className="text-red-400 group-hover:scale-110 transition-transform" />
                    )}
                    <div>
                        <div className="font-bold text-zinc-200">MP4 影片</div>
                        <div className="text-xs text-zinc-500">YouTube Music 推薦</div>
                    </div>
                </button>

                {/* WebM Export (fallback) */}
                <button
                    onClick={handleExportYouTube}
                    disabled={!hasAudio || isExportingYouTube}
                    className="flex items-center justify-center gap-3 px-4 py-4 bg-gradient-to-r from-pink-600/20 to-red-600/20 hover:from-pink-600/30 hover:to-red-600/30 border border-pink-500/30 rounded-xl text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                    {isExportingYouTube ? (
                        <Loader2 size={24} className="animate-spin text-pink-400" />
                    ) : (
                        <Youtube size={24} className="text-pink-400 group-hover:scale-110 transition-transform" />
                    )}
                    <div>
                        <div className="font-bold text-zinc-200">WebM 影片</div>
                        <div className="text-xs text-zinc-500">瀏覽器原生</div>
                    </div>
                </button>

                {/* Third-party RSS Export */}
                <button
                    onClick={handleExportRSS}
                    disabled={!hasAudio || isExportingRSS || !podcastTitle || !podcastAuthor}
                    className="flex items-center justify-center gap-3 px-4 py-4 bg-gradient-to-r from-orange-600/20 to-amber-600/20 hover:from-orange-600/30 hover:to-amber-600/30 border border-orange-500/30 rounded-xl text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                    {isExportingRSS ? (
                        <Loader2 size={24} className="animate-spin text-orange-400" />
                    ) : (
                        <Music size={24} className="text-orange-400 group-hover:scale-110 transition-transform" />
                    )}
                    <div>
                        <div className="font-bold text-zinc-200">第三方 Podcast</div>
                        <div className="text-xs text-zinc-500">RSS + MP3 ZIP</div>
                    </div>
                </button>
            </div>

            {/* Export Progress */}
            {exportProgress && (
                <div className="flex items-center gap-2 text-sm text-purple-400">
                    <Loader2 size={16} className="animate-spin" />
                    <span>{exportProgress}</span>
                </div>
            )}

            {/* Platform Info */}
            <div className="bg-black/20 rounded-lg p-3 border border-zinc-800">
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Rss size={14} />
                    <span>支援平台：Spotify、Apple Podcasts、Podbean、Google Podcasts、YouTube Music</span>
                </div>
            </div>
        </section>
    );
};

// Helper function
function base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64);
    const byteNumbers = new Uint8Array(byteCharacters.length);

    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }

    return new Blob([byteNumbers.buffer], { type: mimeType });
}
