/**
 * PodcastPublishSection Component
 * One-click podcast generation and export
 */

import React, { useState, useEffect } from 'react';
import { Loader2, Image, Rss, Sparkles, Radio, FileAudio, Wand2, Download, Check, AlertCircle, Film } from 'lucide-react';
import { generatePodcastCoverArt, createPodcastZip, downloadBlob, PodcastMetadata, EpisodeMetadata } from '../services/podcastService';
import { generateOpenAICoverArt } from '../services/openaiService';
import { bufferToWav, bufferToMp3, createWebmVideo, mergeAudioBuffers } from '../utils/audioUtils';
import { GeneratedPodcastInfo, ImageProvider } from '../types';

interface PodcastPublishSectionProps {
    storyText: string;
    items: { audioBuffer?: AudioBuffer | null }[];
    geminiApiKey: string;
    openaiApiKey: string;
    podcastInfo: GeneratedPodcastInfo | null;
    onGenerateAllAudio?: () => Promise<AudioBuffer[]>;
}

// Generation step status
type StepStatus = 'pending' | 'running' | 'done' | 'error';

interface GenerationStep {
    id: string;
    label: string;
    status: StepStatus;
    error?: string;
}

export const PodcastPublishSection: React.FC<PodcastPublishSectionProps> = ({
    storyText,
    items,
    geminiApiKey,
    openaiApiKey,
    podcastInfo,
    onGenerateAllAudio
}) => {
    // Cover art state
    const [coverArtBase64, setCoverArtBase64] = useState<string | null>(null);
    const [imageProvider, setImageProvider] = useState<ImageProvider>('gemini');

    // Podcast metadata
    const [podcastTitle, setPodcastTitle] = useState('');
    const [podcastDescription, setPodcastDescription] = useState('');
    const [podcastAuthor, setPodcastAuthor] = useState('');
    const [episodeTitle, setEpisodeTitle] = useState('');
    const [coverPrompt, setCoverPrompt] = useState('');

    // Generated outputs
    const [mp3Blob, setMp3Blob] = useState<Blob | null>(null);
    const [webmBlob, setWebmBlob] = useState<Blob | null>(null);
    const [rssZipBlob, setRssZipBlob] = useState<Blob | null>(null);

    // Generation state
    const [isGenerating, setIsGenerating] = useState(false);
    const [steps, setSteps] = useState<GenerationStep[]>([]);

    // Auto-fill from podcastInfo
    useEffect(() => {
        if (podcastInfo) {
            setPodcastTitle(podcastInfo.podcastName || '');
            setPodcastAuthor(podcastInfo.author || '');
            setEpisodeTitle(podcastInfo.episodeTitle || '');
            setPodcastDescription(podcastInfo.description || '');
            setCoverPrompt(podcastInfo.coverPrompt || '');
        }
    }, [podcastInfo]);

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
            alert('請填寫 Podcast 名稱和作者');
            return;
        }

        setIsGenerating(true);
        setMp3Blob(null);
        setWebmBlob(null);
        setRssZipBlob(null);

        const initialSteps: GenerationStep[] = [
            { id: 'audio', label: '生成音訊', status: allAudioGenerated ? 'done' : 'pending' },
            { id: 'cover', label: '生成封面圖', status: coverArtBase64 ? 'done' : 'pending' },
            { id: 'mp3', label: '合成 MP3', status: 'pending' },
            { id: 'webm', label: '合成 WebM 影片', status: 'pending' },
            { id: 'rss', label: '打包 RSS + MP3', status: 'pending' },
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
                updateStep('audio', 'error', '沒有可用的音訊');
                throw new Error('沒有可用的音訊。請先個別生成音訊後再試。');
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
                updateStep('webm', 'error', '需要封面圖');
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
                            Podcast 發布區
                        </h3>
                        <p className="text-xs text-zinc-500">
                            一鍵生成所有內容並匯出
                        </p>
                    </div>
                </div>

                {/* Audio Status */}
                <div className="flex items-center gap-2 text-sm">
                    <FileAudio size={16} className="text-zinc-500" />
                    <span className="text-zinc-400">
                        {items.filter(i => i.audioBuffer).length}/{items.length} 音訊
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
                <div className="space-y-1">
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
                <div className="space-y-1">
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
                <div className="space-y-1">
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
                <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">封面圖生成</label>
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
                        Podcast 描述
                        {podcastInfo?.description && <Wand2 size={10} className="text-purple-400" />}
                    </label>
                    <textarea
                        value={podcastDescription}
                        onChange={(e) => setPodcastDescription(e.target.value)}
                        placeholder="簡短描述你的 Podcast 內容..."
                        className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 resize-none h-16"
                    />
                </div>
                <div className="col-span-2 space-y-1">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                        封面圖提示詞
                        {podcastInfo?.coverPrompt && <Wand2 size={10} className="text-purple-400" />}
                    </label>
                    <textarea
                        value={coverPrompt}
                        onChange={(e) => setCoverPrompt(e.target.value)}
                        placeholder="描述封面圖的風格和內容，例：一個復古風格的收音機在深夜發光..."
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
                    <span className="text-xs text-zinc-500">封面預覽</span>
                </div>

                {/* Generate All Button */}
                <div className="col-span-2 flex flex-col justify-center">
                    <button
                        onClick={handleGenerateAll}
                        disabled={isGenerating || !podcastTitle || !podcastAuthor || items.length === 0}
                        className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 size={24} className="animate-spin" />
                                生成中...
                            </>
                        ) : (
                            <>
                                <Sparkles size={24} />
                                一鍵生成全部
                            </>
                        )}
                    </button>
                    <p className="text-xs text-zinc-500 text-center mt-2">
                        音訊 → 封面圖 → MP3 → MP4 影片 → RSS 打包
                    </p>
                </div>
            </div>

            {/* Generation Progress */}
            {steps.length > 0 && (
                <div className="bg-black/30 rounded-lg p-4 space-y-2">
                    <div className="text-sm font-semibold text-zinc-300 mb-3">生成進度</div>
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
            )}

            {/* Download Buttons */}
            {(mp3Blob || webmBlob || rssZipBlob || coverArtBase64) && (
                <div className="bg-black/30 rounded-lg p-4">
                    <div className="text-sm font-semibold text-zinc-300 mb-3">下載檔案</div>
                    <div className="grid grid-cols-4 gap-3">
                        <button
                            onClick={handleDownloadMp3}
                            disabled={!mp3Blob}
                            className="flex flex-col items-center gap-2 p-3 bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <Download size={20} className="text-orange-400" />
                            <span className="text-xs text-zinc-300">MP3 音訊</span>
                        </button>
                        <button
                            onClick={handleDownloadWebm}
                            disabled={!webmBlob}
                            className="flex flex-col items-center gap-2 p-3 bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <Film size={20} className="text-red-400" />
                            <span className="text-xs text-zinc-300">WebM 影片</span>
                        </button>
                        <button
                            onClick={handleDownloadRss}
                            disabled={!rssZipBlob}
                            className="flex flex-col items-center gap-2 p-3 bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <Download size={20} className="text-amber-400" />
                            <span className="text-xs text-zinc-300">RSS 包</span>
                        </button>
                        <button
                            onClick={handleDownloadCover}
                            disabled={!coverArtBase64}
                            className="flex flex-col items-center gap-2 p-3 bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <Download size={20} className="text-purple-400" />
                            <span className="text-xs text-zinc-300">封面圖</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Platform Info */}
            <div className="bg-black/20 rounded-lg p-3 border border-zinc-800">
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Rss size={14} />
                    <span>支援平台：YouTube Music (MP4)、Spotify、Apple Podcasts、Podbean (RSS+MP3)</span>
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
