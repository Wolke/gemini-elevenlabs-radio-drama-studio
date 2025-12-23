
import React, { useState, useRef, useEffect } from 'react';
import { DramaState, ItemType, ScriptItem, CastMember, ElevenLabsVoice, VoiceType } from './types';
import { generateScriptFromStory, generateSpeech } from './services/geminiService';
import { generateElevenLabsSfx, generateElevenLabsSpeech, fetchElevenLabsVoices } from './services/elevenLabsService';
import { decodeRawPCM, decodeAudioFile, getAudioContext, mergeAudioBuffers, bufferToWav, blobToBase64 } from './utils/audioUtils';
import { ScriptItemCard } from './components/ScriptItemCard';
import { Player } from './components/Player';
import { Wand2, Play, Square, Settings2, Sparkles, AlertCircle, FileText, Users, Volume2, Loader2, Speaker, ToggleLeft, ToggleRight, Key, Download, Save, FolderOpen, Mic, Mic2, RefreshCw } from 'lucide-react';

const GEMINI_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir",
  "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina",
  "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird",
  "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"
].sort();

const isNarrator = (name: string) => {
  const n = name.trim().toLowerCase();
  return n === 'narrator' || n === '旁白' || n === 'system' || n.includes('narrator') || n.includes('旁白');
};

export default function App() {
  const [state, setState] = useState<DramaState>(() => {
    // Load API keys from localStorage if saved
    const savedGeminiKey = localStorage.getItem('geminiApiKey') || '';
    const savedElevenLabsKey = localStorage.getItem('elevenLabsApiKey') || '';
    return {
      storyText: '',
      cast: [],
      scenes: [],
      items: [],
      isGeneratingScript: false,
      isPlaying: false,
      currentPlayingId: null,
      enableSfx: true,
      includeNarrator: true,
      geminiApiKey: savedGeminiKey,
      elevenLabsApiKey: savedElevenLabsKey,
      useElevenLabsForSpeech: true,
      elevenLabsVoices: [],
      isLoadingVoices: false,
    };
  });

  const [saveGeminiKey, setSaveGeminiKey] = useState(() => {
    return localStorage.getItem('saveGeminiKey') === 'true';
  });
  const [saveElevenLabsKey, setSaveElevenLabsKey] = useState(() => {
    return localStorage.getItem('saveElevenLabsKey') === 'true';
  });

  const [isConfigExpanded, setIsConfigExpanded] = useState(true);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Save/clear API keys individually
  React.useEffect(() => {
    if (saveGeminiKey && state.geminiApiKey) {
      localStorage.setItem('saveGeminiKey', 'true');
      localStorage.setItem('geminiApiKey', state.geminiApiKey);
    } else {
      localStorage.removeItem('saveGeminiKey');
      localStorage.removeItem('geminiApiKey');
    }
  }, [saveGeminiKey, state.geminiApiKey]);

  React.useEffect(() => {
    if (saveElevenLabsKey && state.elevenLabsApiKey) {
      localStorage.setItem('saveElevenLabsKey', 'true');
      localStorage.setItem('elevenLabsApiKey', state.elevenLabsApiKey);
    } else {
      localStorage.removeItem('saveElevenLabsKey');
      localStorage.removeItem('elevenLabsApiKey');
    }
  }, [saveElevenLabsKey, state.elevenLabsApiKey]);

  // Fetch ElevenLabs voices when API key changes
  const handleFetchVoices = async () => {
    if (!state.elevenLabsApiKey) return;

    setState(prev => ({ ...prev, isLoadingVoices: true }));
    try {
      const voices = await fetchElevenLabsVoices(state.elevenLabsApiKey);
      setState(prev => ({ ...prev, elevenLabsVoices: voices, isLoadingVoices: false }));
    } catch (e: any) {
      setError(`Failed to fetch voices: ${e.message}`);
      setState(prev => ({ ...prev, isLoadingVoices: false }));
    }
  };

  const handleGenerateScript = async () => {
    if (!state.storyText.trim()) return;

    setError(null);
    setState(prev => ({ ...prev, isGeneratingScript: true }));

    try {
      // Pass ElevenLabs voices to AI so it can pick suitable ones for each character
      const { cast, scenes, items } = await generateScriptFromStory(
        state.storyText,
        state.enableSfx,
        state.includeNarrator,
        state.elevenLabsVoices,
        state.geminiApiKey
      );

      // Set voiceType based on whether AI assigned an ElevenLabs voice
      const finalCast = cast.map(member => {
        if (member.elevenLabsVoiceId && state.elevenLabsVoices.length > 0) {
          // AI picked a voice - verify it exists and get the name
          const elVoice = state.elevenLabsVoices.find(v => v.voice_id === member.elevenLabsVoiceId);
          if (elVoice) {
            return {
              ...member,
              voiceType: 'elevenlabs' as const,
              voice: elVoice.name,
            };
          }
        }
        // Default to Gemini voice
        return { ...member, voiceType: 'gemini' as const };
      });

      setState(prev => ({ ...prev, cast: finalCast, scenes, items, isGeneratingScript: false }));
      setIsConfigExpanded(false);
    } catch (e: any) {
      setError(e.message || "Failed to generate script.");
      setState(prev => ({ ...prev, isGeneratingScript: false }));
    }
  };

  const handleUpdateItem = (id: string, updates: Partial<ScriptItem>) => {
    setState(prev => ({
      ...prev,
      items: prev.items.map(item => item.id === id ? { ...item, ...updates } : item)
    }));
  };

  const handleRemoveItem = (id: string) => {
    setState(prev => ({
      ...prev,
      items: prev.items.filter(item => item.id !== id)
    }));
  };

  const handleMoveItem = (index: number, direction: 'up' | 'down') => {
    const newItems = [...state.items];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex >= 0 && targetIndex < newItems.length) {
      [newItems[index], newItems[targetIndex]] = [newItems[targetIndex], newItems[index]];
      setState(prev => ({ ...prev, items: newItems }));
    }
  };

  const handleUpdateCast = (characterName: string, updates: Partial<CastMember>) => {
    setState(prev => ({
      ...prev,
      cast: prev.cast.map(c => c.name === characterName ? { ...c, ...updates } : c)
    }));
  };

  const handleGenerateAudio = async (id: string, text: string, voice: string, expression: string) => {
    handleUpdateItem(id, { isLoadingAudio: true, generationError: undefined });
    try {
      const ctx = getAudioContext();
      let buffer: AudioBuffer;

      // Find character to get voice settings
      const item = state.items.find(i => i.id === id);
      const castMember = item?.character ? state.cast.find(c => c.name === item.character) : undefined;

      if (castMember?.voiceType === 'elevenlabs' && state.elevenLabsApiKey) {
        // Use ElevenLabs with specific voice ID + voicePrompt
        const base64 = await generateElevenLabsSpeech(text, castMember.elevenLabsVoiceId, voice, castMember.voicePrompt, state.elevenLabsApiKey);
        buffer = await decodeAudioFile(base64, ctx);
      } else if (state.useElevenLabsForSpeech && state.elevenLabsApiKey) {
        // Use ElevenLabs with mapped Gemini voice + voicePrompt
        const base64 = await generateElevenLabsSpeech(text, undefined, voice, castMember?.voicePrompt, state.elevenLabsApiKey);
        buffer = await decodeAudioFile(base64, ctx);
      } else {
        // Use Gemini TTS with voicePrompt
        const base64 = await generateSpeech(text, voice, castMember?.voicePrompt || '', expression, state.geminiApiKey);
        buffer = await decodeRawPCM(base64, ctx);
      }

      handleUpdateItem(id, {
        audioBuffer: buffer,
        isLoadingAudio: false,
        generationError: undefined
      });
    } catch (e: any) {
      console.error(e);
      handleUpdateItem(id, {
        isLoadingAudio: false,
        generationError: e.message || "Unknown error occurred"
      });
    }
  };

  const handleGenerateSfx = async (id: string, description: string) => {
    if (!state.elevenLabsApiKey) {
      alert("Please enter an ElevenLabs API Key in settings first.");
      return;
    }
    handleUpdateItem(id, { isLoadingAudio: true, generationError: undefined });
    try {
      const base64 = await generateElevenLabsSfx(description, 4, state.elevenLabsApiKey);
      const ctx = getAudioContext();
      const buffer = await decodeAudioFile(base64, ctx);

      handleUpdateItem(id, {
        audioBuffer: buffer,
        isLoadingAudio: false,
        generationError: undefined,
        youtubeId: undefined
      });
    } catch (e: any) {
      console.error(e);
      handleUpdateItem(id, {
        isLoadingAudio: false,
        generationError: e.message || "Failed to generate SFX"
      });
    }
  };

  const handleGenerateAllAudio = async () => {
    if (state.items.length === 0) return;
    setIsGeneratingAll(true);
    const itemsToProcess = state.items.filter(item =>
      (item.type === ItemType.SPEECH && !item.audioBuffer) ||
      (item.type === ItemType.SFX && !item.audioBuffer && state.elevenLabsApiKey && item.sfxDescription)
    );

    for (const item of itemsToProcess) {
      if (item.type === ItemType.SPEECH && item.text) {
        const char = state.cast.find(c => c.name === item.character);
        await handleGenerateAudio(item.id, item.text, char?.voice || 'Puck', item.expression || '');
      } else if (item.type === ItemType.SFX && item.sfxDescription) {
        await handleGenerateSfx(item.id, item.sfxDescription);
      }
      await new Promise(r => setTimeout(r, 500));
    }
    setIsGeneratingAll(false);
  };

  const handleExportWav = async () => {
    setIsExporting(true);
    try {
      const buffers = state.items
        .map(i => i.audioBuffer)
        .filter((b): b is AudioBuffer => !!b);

      if (buffers.length === 0) {
        alert("No generated audio to export.");
        setIsExporting(false);
        return;
      }

      const merged = await mergeAudioBuffers(buffers);
      const wavBlob = bufferToWav(merged);
      const url = URL.createObjectURL(wavBlob);

      const a = document.createElement('a');
      a.href = url;
      a.download = 'voice_drama.wav';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("Export failed.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveProject = async () => {
    const itemsToSave = await Promise.all(state.items.map(async (item) => {
      let audioBase64 = undefined;
      if (item.audioBuffer) {
        const wav = bufferToWav(item.audioBuffer);
        audioBase64 = await blobToBase64(wav);
      }
      return {
        ...item,
        audioBuffer: undefined,
        _audioBase64: audioBase64
      };
    }));

    const projectData = {
      version: 2.0,
      date: new Date().toISOString(),
      storyText: state.storyText,
      cast: state.cast,
      scenes: state.scenes || [],
      items: itemsToSave,
      config: {
        enableSfx: state.enableSfx,
        includeNarrator: state.includeNarrator,
        useElevenLabsForSpeech: state.useElevenLabsForSpeech
      }
    };

    const blob = new Blob([JSON.stringify(projectData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'voice_drama_project.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProjectLoading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);

        const ctx = getAudioContext();
        const restoredItems = await Promise.all(json.items.map(async (item: any) => {
          let audioBuffer = null;
          if (item._audioBase64) {
            let b64 = item._audioBase64;
            if (b64.includes(',')) b64 = b64.split(',')[1];
            audioBuffer = await decodeAudioFile(b64, ctx);
          }
          const { _audioBase64, ...rest } = item;
          return { ...rest, audioBuffer };
        }));

        setState(prev => ({
          ...prev,
          storyText: json.storyText || '',
          cast: json.cast || [],
          scenes: json.scenes || [],
          items: restoredItems,
          enableSfx: json.config?.enableSfx ?? true,
          includeNarrator: json.config?.includeNarrator ?? true,
          useElevenLabsForSpeech: json.config?.useElevenLabsForSpeech ?? true,
          isPlaying: false,
          currentPlayingId: null
        }));

      } catch (err) {
        console.error(err);
        alert("Failed to load project file.");
      } finally {
        setIsProjectLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const togglePlay = () => {
    setState(prev => ({ ...prev, isPlaying: !prev.isPlaying }));
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 p-4 md:p-8 max-w-5xl mx-auto">

      <input type="file" ref={fileInputRef} onChange={handleLoadProject} accept=".json" className="hidden" />

      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2">
            <Sparkles className="text-blue-400" />
            Voice Drama Studio
          </h1>
          <p className="text-zinc-500 text-sm mt-1">Powered by ElevenLabs + Google Cloud Gemini</p>
        </div>

        <div className="flex gap-2">
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg hover:bg-zinc-800 text-xs font-medium transition-colors">
            {isProjectLoading ? <Loader2 className="animate-spin" size={14} /> : <FolderOpen size={14} />}
            Load
          </button>
          <button onClick={handleSaveProject} className="flex items-center gap-2 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg hover:bg-zinc-800 text-xs font-medium transition-colors">
            <Save size={14} />
            Save
          </button>
          <button
            onClick={() => setIsConfigExpanded(!isConfigExpanded)}
            className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-xs font-medium transition-colors ${isConfigExpanded ? 'bg-zinc-800 border-zinc-600' : 'bg-zinc-900 border-zinc-700 hover:bg-zinc-800'}`}
          >
            <Settings2 size={14} />
            Config
          </button>
        </div>
      </header>

      {/* Configuration Panel */}
      {isConfigExpanded && (
        <section className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8 animate-in fade-in slide-in-from-top-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                <FileText size={16} /> Story Input
              </h3>
              <textarea
                value={state.storyText}
                onChange={(e) => setState(prev => ({ ...prev, storyText: e.target.value }))}
                placeholder="Paste your story or scene description here..."
                className="w-full h-40 bg-black/40 border border-zinc-700 rounded-lg p-4 text-sm focus:outline-none focus:border-blue-500 resize-none"
              />
              <button
                onClick={handleGenerateScript}
                disabled={state.isGeneratingScript || !state.storyText.trim() || !state.geminiApiKey}
                className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {state.isGeneratingScript ? <Loader2 className="animate-spin" size={18} /> : <Wand2 size={18} />}
                Generate Script & Cast
              </button>
              {!state.geminiApiKey && <p className="text-amber-400 text-xs text-center">⚠ Enter Gemini API Key first</p>}
              {error && <p className="text-red-400 text-xs text-center">{error}</p>}
            </div>

            <div className="space-y-6">
              <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                <Settings2 size={16} /> Settings
              </h3>

              <div className="space-y-4">
                {/* ElevenLabs API Key - Primary */}
                <div className="p-3 bg-blue-500/5 rounded-lg border border-blue-500/20 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 text-blue-400 rounded-md">
                      <Key size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-blue-300">ElevenLabs API Key</p>
                      <p className="text-xs text-zinc-500">Required for voice & SFX generation</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="Enter your ElevenLabs API Key..."
                      value={state.elevenLabsApiKey}
                      onChange={(e) => setState(prev => ({ ...prev, elevenLabsApiKey: e.target.value }))}
                      className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                    />
                    {state.elevenLabsApiKey && (
                      <button
                        onClick={() => setSaveElevenLabsKey(!saveElevenLabsKey)}
                        className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${saveElevenLabsKey ? 'bg-green-500/20 text-green-400' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}`}
                        title={saveElevenLabsKey ? 'Saved locally' : 'Click to save locally'}
                      >
                        <Save size={12} />
                      </button>
                    )}
                    <button
                      onClick={handleFetchVoices}
                      disabled={!state.elevenLabsApiKey || state.isLoadingVoices}
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium disabled:opacity-50 flex items-center gap-1"
                    >
                      {state.isLoadingVoices ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      Fetch Voices
                    </button>
                  </div>
                  {state.elevenLabsVoices.length > 0 && (
                    <p className="text-xs text-blue-400">✓ {state.elevenLabsVoices.length} voices loaded</p>
                  )}
                </div>

                {/* Use ElevenLabs for Speech Toggle */}
                <div className={`flex items-center justify-between p-3 rounded-lg border ${state.elevenLabsVoices.length > 0 ? 'bg-black/20 border-zinc-800/50' : 'bg-zinc-900/30 border-zinc-800/30 opacity-50'}`}>
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 text-blue-400 rounded-md">
                      <Volume2 size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Use ElevenLabs for Voices</p>
                      <p className="text-xs text-zinc-500">{state.elevenLabsVoices.length > 0 ? 'High-quality multilingual TTS' : 'Fetch voices first'}</p>
                    </div>
                  </div>
                  <button onClick={() => setState(prev => ({ ...prev, useElevenLabsForSpeech: !prev.useElevenLabsForSpeech }))} disabled={state.elevenLabsVoices.length === 0}>
                    {state.useElevenLabsForSpeech && state.elevenLabsVoices.length > 0 ? <ToggleRight size={28} className="text-blue-400" /> : <ToggleLeft size={28} className="text-zinc-600" />}
                  </button>
                </div>

                {/* Narrator Toggle */}
                <div className={`flex items-center justify-between p-3 rounded-lg border ${state.geminiApiKey ? 'bg-black/20 border-zinc-800/50' : 'bg-zinc-900/30 border-zinc-800/30 opacity-50'}`}>
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-500/10 text-purple-400 rounded-md">
                      <Mic2 size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Include Narrator</p>
                      <p className="text-xs text-zinc-500">{state.geminiApiKey ? 'Enable narrator role' : 'Requires Gemini API key'}</p>
                    </div>
                  </div>
                  <button onClick={() => setState(prev => ({ ...prev, includeNarrator: !prev.includeNarrator }))} disabled={!state.geminiApiKey}>
                    {state.includeNarrator && state.geminiApiKey ? <ToggleRight size={28} className="text-blue-400" /> : <ToggleLeft size={28} className="text-zinc-600" />}
                  </button>
                </div>

                {/* SFX Toggle */}
                <div className={`flex items-center justify-between p-3 rounded-lg border ${state.elevenLabsApiKey ? 'bg-black/20 border-zinc-800/50' : 'bg-zinc-900/30 border-zinc-800/30 opacity-50'}`}>
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-500/10 text-amber-400 rounded-md">
                      <Speaker size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Sound Effects</p>
                      <p className="text-xs text-zinc-500">{state.elevenLabsApiKey ? 'Include SFX cues (ElevenLabs)' : 'Requires ElevenLabs API key'}</p>
                    </div>
                  </div>
                  <button onClick={() => setState(prev => ({ ...prev, enableSfx: !prev.enableSfx }))} disabled={!state.elevenLabsApiKey}>
                    {state.enableSfx && state.elevenLabsApiKey ? <ToggleRight size={28} className="text-blue-400" /> : <ToggleLeft size={28} className="text-zinc-600" />}
                  </button>
                </div>

                {/* Gemini API Key */}
                <div className="p-3 bg-black/20 rounded-lg border border-zinc-800/50 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-md">
                      <Key size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Gemini API Key</p>
                      <p className="text-xs text-zinc-500">For script generation (& fallback TTS)</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="Enter your Gemini API Key..."
                      value={state.geminiApiKey}
                      onChange={(e) => setState(prev => ({ ...prev, geminiApiKey: e.target.value }))}
                      className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-emerald-500"
                    />
                    {state.geminiApiKey && (
                      <button
                        onClick={() => setSaveGeminiKey(!saveGeminiKey)}
                        className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${saveGeminiKey ? 'bg-green-500/20 text-green-400' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}`}
                        title={saveGeminiKey ? 'Saved locally' : 'Click to save locally'}
                      >
                        <Save size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Main Content Area */}
      {state.cast.length > 0 && (
        <main className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-20">

          {/* Left Column: Cast */}
          <section className="lg:col-span-1 space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users size={18} className="text-blue-400" /> Cast & Voices
            </h2>

            <div className="space-y-3">
              {state.cast.map((member, idx) => {
                const isNarratorMember = isNarrator(member.name);
                return (
                  <div key={idx} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isNarratorMember ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>
                        <Mic size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-sm truncate text-white">{member.name}</h4>
                        <p className="text-xs text-zinc-500 truncate">{member.description}</p>
                      </div>
                    </div>

                    {/* Voice Selection */}
                    <div className="space-y-2">
                      {/* Voice Type Selector */}
                      <div className="flex gap-1 bg-zinc-950 rounded p-1">
                        <button
                          onClick={() => handleUpdateCast(member.name, { voiceType: 'gemini' })}
                          className={`flex-1 py-1 px-2 rounded text-[10px] font-medium transition-colors ${member.voiceType === 'gemini' ? 'bg-emerald-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                        >
                          Gemini
                        </button>
                        <button
                          onClick={() => handleUpdateCast(member.name, { voiceType: 'elevenlabs' })}
                          disabled={state.elevenLabsVoices.length === 0}
                          className={`flex-1 py-1 px-2 rounded text-[10px] font-medium transition-colors ${member.voiceType === 'elevenlabs' ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-zinc-300'} disabled:opacity-30`}
                        >
                          ElevenLabs
                        </button>
                      </div>

                      {/* Voice Dropdown with Preview */}
                      <div className="flex gap-2">
                        {member.voiceType === 'elevenlabs' && state.elevenLabsVoices.length > 0 ? (
                          <>
                            <select
                              value={member.elevenLabsVoiceId || ''}
                              onChange={(e) => {
                                const voice = state.elevenLabsVoices.find(v => v.voice_id === e.target.value);
                                handleUpdateCast(member.name, {
                                  elevenLabsVoiceId: e.target.value,
                                  voice: voice?.name || member.voice
                                });
                              }}
                              className="flex-1 min-w-0 bg-zinc-950 border border-blue-500/30 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 truncate"
                            >
                              <option value="">Select Voice...</option>
                              {state.elevenLabsVoices.map(v => (
                                <option key={v.voice_id} value={v.voice_id}>
                                  {v.name} {v.category === 'cloned' ? '(Custom)' : ''}
                                </option>
                              ))}
                            </select>
                            {member.elevenLabsVoiceId && (
                              <button
                                onClick={() => {
                                  const voice = state.elevenLabsVoices.find(v => v.voice_id === member.elevenLabsVoiceId);
                                  if (voice?.preview_url) {
                                    const audio = new Audio(voice.preview_url);
                                    audio.play();
                                  }
                                }}
                                className="px-2 py-1 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded text-xs flex items-center gap-1"
                                title="Preview voice"
                              >
                                <Play size={12} fill="currentColor" />
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            <select
                              value={member.voice}
                              onChange={(e) => handleUpdateCast(member.name, { voice: e.target.value })}
                              className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs focus:outline-none"
                            >
                              {GEMINI_VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                            <button
                              onClick={async () => {
                                try {
                                  const base64 = await generateSpeech("Hello, this is a voice preview.", member.voice, '', '', state.geminiApiKey);
                                  const ctx = getAudioContext();
                                  const buffer = await decodeRawPCM(base64, ctx);
                                  const source = ctx.createBufferSource();
                                  source.buffer = buffer;
                                  source.connect(ctx.destination);
                                  source.start();
                                } catch (e) {
                                  console.error("Preview failed:", e);
                                }
                              }}
                              disabled={!state.geminiApiKey}
                              className="px-2 py-1 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded text-xs flex items-center gap-1 disabled:opacity-30"
                              title="Preview voice (requires API key)"
                            >
                              <Play size={12} fill="currentColor" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Voice Prompt Editor */}
                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-500 font-semibold uppercase">Voice Prompt (Accent/Style)</label>
                      <textarea
                        value={member.voicePrompt || ''}
                        onChange={(e) => handleUpdateCast(member.name, { voicePrompt: e.target.value })}
                        placeholder="e.g. Native Taiwanese Mandarin, warm and friendly"
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 resize-none h-12"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Right Column: Script */}
          <section className="lg:col-span-2 space-y-4">
            <div className="sticky top-0 z-10 bg-zinc-950/80 backdrop-blur-sm py-4 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <FileText size={18} className="text-blue-400" /> Script ({state.items.length} cues)
              </h2>
              <button
                onClick={handleGenerateAllAudio}
                disabled={isGeneratingAll}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-md text-xs font-medium transition-colors flex items-center gap-2"
              >
                {isGeneratingAll ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
                Generate All Audio
              </button>
            </div>

            <div className="space-y-4">
              {state.items.map((item, index) => {
                const castMember = state.cast.find(c => c.name === item.character);
                return (
                  <ScriptItemCard
                    key={item.id}
                    item={item}
                    index={index}
                    totalItems={state.items.length}
                    assignedVoice={castMember?.voice}
                    voiceType={castMember?.voiceType}
                    elevenLabsApiKey={state.elevenLabsApiKey}
                    onUpdate={handleUpdateItem}
                    onRemove={handleRemoveItem}
                    onMove={handleMoveItem}
                    onGenerateAudio={handleGenerateAudio}
                    onGenerateSfx={handleGenerateSfx}
                    onPreviewAudio={(buffer) => {
                      const ctx = getAudioContext();
                      const source = ctx.createBufferSource();
                      source.buffer = buffer;
                      source.connect(ctx.destination);
                      source.start();
                    }}
                    isPlaying={state.currentPlayingId === item.id}
                  />
                );
              })}
            </div>
          </section>

        </main>
      )}

      {/* Persistent Footer Controls */}
      {state.items.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 p-4 shadow-2xl z-50">
          <div className="max-w-5xl mx-auto flex items-center justify-between">

            <div className="flex items-center gap-4">
              <button
                onClick={togglePlay}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${state.isPlaying
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : 'bg-blue-500 text-black hover:bg-blue-400 hover:scale-105'
                  }`}
              >
                {state.isPlaying ? <Square size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
              </button>
              <div>
                <div className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Now Playing</div>
                <div className="text-sm font-medium text-zinc-200">
                  {state.currentPlayingId
                    ? `${state.items.findIndex(i => i.id === state.currentPlayingId) + 1}. ${state.items.find(i => i.id === state.currentPlayingId)?.type === 'speech' ? 'Dialogue' : 'SFX'}`
                    : 'Ready to start'}
                </div>
              </div>
            </div>

            <button
              onClick={handleExportWav}
              disabled={isExporting}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg text-sm font-bold transition-all shadow-lg hover:shadow-blue-500/25"
            >
              {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              Export WAV
            </button>

          </div>
        </div>
      )}

      <Player
        items={state.items}
        isPlaying={state.isPlaying}
        onPlayStateChange={(playing, id) => setState(prev => ({ ...prev, isPlaying: playing, currentPlayingId: id }))}
      />

    </div>
  );
}
