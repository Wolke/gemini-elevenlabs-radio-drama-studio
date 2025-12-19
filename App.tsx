
import React, { useState, useRef } from 'react';
import { DramaState, ItemType, ScriptItem, CastMember, SceneDefinition } from './types';
import { generateScriptFromStory, generateSpeech, generateCharacterSheet, generateSceneImage } from './services/geminiService';
import { generateElevenLabsSfx, generateElevenLabsSpeech } from './services/elevenLabsService';
import { decodeRawPCM, decodeAudioFile, getAudioContext, mergeAudioBuffers, bufferToWav, blobToBase64 } from './utils/audioUtils';
import { generateVideoFromScript } from './utils/videoUtils';
import { ScriptItemCard } from './components/ScriptItemCard';
import { Player } from './components/Player';
import { Wand2, Play, Square, Settings2, Sparkles, AlertCircle, FileText, Users, User, Volume2, Loader2, Speaker, ToggleLeft, ToggleRight, Key, ChevronDown, ChevronUp, Download, Save, FolderOpen, Upload, ImageIcon, Video, RefreshCw, Pencil, Palette, Smartphone, Monitor, ImagePlus, Mic, Mic2, MapPin } from 'lucide-react';

const VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir",
  "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina",
  "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird",
  "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"
].sort();

const PRESET_STYLES = [
  "Cinematic Realistic",
  "Anime / Manga",
  "Watercolor Picture Book",
  "Cyberpunk / Neon",
  "Vintage Noir",
  "3D Animation Style"
];

const isNarrator = (name: string) => {
  const n = name.trim().toLowerCase();
  return n === 'narrator' || n === '旁白' || n === 'system' || n.includes('narrator') || n.includes('旁白');
};

export default function App() {
  const [state, setState] = useState<DramaState>({
    storyText: '',
    cast: [],
    scenes: [],
    items: [],
    isGeneratingScript: false,
    isPlaying: false,
    currentPlayingId: null,
    enableSfx: false,
    includeNarrator: true, // Default to having a narrator
    enableImages: true,
    imageStyle: "Cinematic Realistic",
    aspectRatio: "16:9",
    geminiApiKey: '',
    elevenLabsApiKey: '',
    useElevenLabsForSpeech: false,
  });

  const [isConfigExpanded, setIsConfigExpanded] = useState(true);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isVideoExporting, setIsVideoExporting] = useState(false);
  const [videoExportProgress, setVideoExportProgress] = useState("");
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [customStyle, setCustomStyle] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Ref for file inputs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageUploadRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<{ type: 'cast' | 'scene', name: string } | null>(null);

  // Computed state: Check if all non-narrator cast members have images
  const allCastReady = state.cast
    .filter(c => !isNarrator(c.name))
    .every(c => !!c.imageUrl);

  const handleGenerateScript = async () => {
    if (!state.storyText.trim()) return;

    setError(null);
    setState(prev => ({ ...prev, isGeneratingScript: true }));

    try {
      // 1. Generate Script text with Narrator flag
      const { cast, scenes, items } = await generateScriptFromStory(state.storyText, state.enableSfx, state.includeNarrator, state.geminiApiKey);

      // Update state immediately with text
      setState(prev => ({ ...prev, cast, scenes, items, isGeneratingScript: false }));
      setIsConfigExpanded(false);

    } catch (e: any) {
      setError(e.message || "Failed to generate script.");
      setState(prev => ({ ...prev, isGeneratingScript: false }));
    }
  };

  const handleGenerateAllCastImages = async () => {
    if (state.cast.length === 0) return;
    setIsGeneratingImages(true);

    // Filter members who need images AND are NOT narrators
    const membersToProcess = state.cast.filter(m =>
      !m.imageUrl &&
      m.visualDescription &&
      !isNarrator(m.name)
    );

    for (const member of membersToProcess) {
      await handleGenerateCastImage(member.name, member.visualDescription!);
      await new Promise(r => setTimeout(r, 1500));
    }

    setIsGeneratingImages(false);
  };

  const handleGenerateAllSceneImages = async () => {
    if (state.items.length === 0) return;

    // Strictly enforce cast readiness
    if (!allCastReady) {
      alert("Please generate all character portraits before generating scene images.");
      return;
    }

    setIsGeneratingImages(true);

    const itemsToProcess = state.items.filter(item => {
      // Skip if already has image
      if (item.imageUrl) return false;
      return true;
    });

    for (const item of itemsToProcess) {
      // Re-use logic from single item generation to ensure consistency
      // This will look up item.location and use that scene description/image
      let prompt = "";
      if (item.type === ItemType.SPEECH) {
        // Include text content to capture actions/context described in dialogue or narration
        const content = item.text || "";
        if (item.character && isNarrator(item.character)) {
          // For Narrator, the text contains the action description
          prompt = `Visual event: "${content}". Atmosphere: ${item.expression || 'dramatic'}`;
        } else {
          // For characters, focus on their presence + dialogue context
          prompt = `Character: ${item.character}. Action/Context derived from dialogue: "${content}". Expression: ${item.expression || 'dramatic'}`;
        }
      } else {
        // SFX
        prompt = `Visual representation of sound effect: "${item.sfxDescription}"`;
      }

      await handleGenerateItemImage(item.id, prompt);
      await new Promise(r => setTimeout(r, 2000));
    }
    setIsGeneratingImages(false);
  };

  const handleGenerateCastImage = async (name: string, description: string) => {
    // Set loading state
    setState(prev => ({
      ...prev,
      cast: prev.cast.map(c => c.name === name ? { ...c, isGeneratingVisual: true } : c)
    }));

    try {
      const finalStyle = customStyle || state.imageStyle;
      const b64 = await generateCharacterSheet(description, finalStyle, state.geminiApiKey);

      setState(prev => ({
        ...prev,
        cast: prev.cast.map(c => c.name === name ? { ...c, imageUrl: b64, isGeneratingVisual: false } : c)
      }));
    } catch (e) {
      console.error(`Failed gen image for ${name}`, e);
      setState(prev => ({
        ...prev,
        cast: prev.cast.map(c => c.name === name ? { ...c, isGeneratingVisual: false } : c)
      }));
    }
  };

  const handleGenerateMasterSceneImage = async (sceneName: string, description: string) => {
    setState(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => s.name === sceneName ? { ...s, isGeneratingVisual: true } : s)
    }));

    try {
      const finalStyle = customStyle || state.imageStyle;
      // Master scenes are just empty backgrounds
      const b64 = await generateSceneImage(description, finalStyle, state.aspectRatio, undefined, undefined, state.geminiApiKey);

      setState(prev => ({
        ...prev,
        scenes: prev.scenes.map(s => s.name === sceneName ? { ...s, imageUrl: b64, isGeneratingVisual: false } : s)
      }));
    } catch (e) {
      console.error(e);
      setState(prev => ({
        ...prev,
        scenes: prev.scenes.map(s => s.name === sceneName ? { ...s, isGeneratingVisual: false } : s)
      }));
    }
  };

  // --- Image Upload Logic ---
  const triggerImageUpload = (type: 'cast' | 'scene', name: string) => {
    uploadTargetRef.current = { type, name };
    imageUploadRef.current?.click();
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadTargetRef.current) return;

    const target = uploadTargetRef.current;
    const reader = new FileReader();

    reader.onload = (event) => {
      const result = event.target?.result as string;
      // Extract base64 data (remove "data:image/xxx;base64," prefix for consistency with generated images)
      let base64Data = result;
      if (result.includes(',')) {
        base64Data = result.split(',')[1];
      }

      if (target.type === 'cast') {
        setState(prev => ({
          ...prev,
          cast: prev.cast.map(c => c.name === target.name ? { ...c, imageUrl: base64Data } : c)
        }));
      } else if (target.type === 'scene') {
        setState(prev => ({
          ...prev,
          scenes: prev.scenes.map(s => s.name === target.name ? { ...s, imageUrl: base64Data } : s)
        }));
      }

      // Reset
      if (imageUploadRef.current) imageUploadRef.current.value = '';
      uploadTargetRef.current = null;
    };

    reader.readAsDataURL(file);
  };
  // --------------------------

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

      if (state.useElevenLabsForSpeech && state.elevenLabsApiKey) {
        const base64 = await generateElevenLabsSpeech(text, voice, state.elevenLabsApiKey);
        buffer = await decodeAudioFile(base64, ctx);
      } else {
        const base64 = await generateSpeech(text, voice, expression, state.geminiApiKey);
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

  const handleGenerateItemImage = async (id: string, basePrompt: string) => {
    handleUpdateItem(id, { isGeneratingVisual: true });
    try {
      const item = state.items.find(i => i.id === id);
      if (!item) return;

      let refImage = undefined;
      let refType: 'character' | 'scene' | undefined = undefined;
      let finalPrompt = basePrompt;

      // 1. Find the Location (Scene) definition
      const sceneDef = state.scenes.find(s => s.name === item.location);

      // 2. Determine Reference Image & Context Strategy

      const isSpeech = item.type === ItemType.SPEECH;
      const isNarratorLine = item.character && isNarrator(item.character);

      if (isSpeech && !isNarratorLine) {
        // --- CASE 1: Character Dialogue ---
        // Reference: Character Portrait (to keep character consistent)
        const member = state.cast.find(c => c.name === item.character);
        if (member && member.imageUrl) {
          refImage = member.imageUrl;
          refType = 'character';
          console.log(`[Image Gen] Using character reference for: ${item.character}`);
        } else {
          console.log(`[Image Gen] No character image found for: ${item.character}`);
        }

        // Prompt: We MUST include scene details here because the Reference Image (Portrait) 
        // usually has a neutral background. We need to tell the model to put this character 
        // into the specific scene environment.
        if (sceneDef) {
          finalPrompt += `. Location: ${sceneDef.name}. Environment details: ${sceneDef.visualDescription}`;
        }

      } else {
        // --- CASE 2: Narrator or SFX ---
        // Reference: Master Scene Image (to keep environment consistent)
        if (sceneDef && sceneDef.imageUrl) {
          refImage = sceneDef.imageUrl;
          refType = 'scene';
          console.log(`[Image Gen] Using scene reference for location: ${sceneDef.name}`);
        }

        // Prompt Logic:
        // If we represent the scene using the reference image, we suppress the textual environment description
        // to prioritize the "Action/Event" description in basePrompt.
        if (refImage) {
          // We have the visual reference for the environment, so we don't textually describe it again.
          // finalPrompt only contains the Action/Event from basePrompt.
        } else {
          // No reference image (first generation or missing). 
          // We need textual description to generate the background.
          if (sceneDef) {
            finalPrompt += `. Location: ${sceneDef.name}. Environment details: ${sceneDef.visualDescription}`;
          }
        }
      }

      const finalStyle = customStyle || state.imageStyle;
      const b64 = await generateSceneImage(finalPrompt, finalStyle, state.aspectRatio, refImage, refType, state.geminiApiKey);

      handleUpdateItem(id, { imageUrl: b64, isGeneratingVisual: false });
    } catch (e: any) {
      console.error(e);
      handleUpdateItem(id, { isGeneratingVisual: false, generationError: "Image Gen Failed" });
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
      // Small delay to be nice to API
      await new Promise(r => setTimeout(r, 500));
    }
    setIsGeneratingAll(false);
  };

  const handleExportWav = async () => {
    setIsExporting(true);
    try {
      // Filter items that have audio buffers
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
      a.download = 'radio_drama.wav';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("Export failed.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportVideo = async () => {
    setIsVideoExporting(true);
    setVideoExportProgress("Initializing...");
    try {
      const blob = await generateVideoFromScript(
        state.items,
        state.cast,
        state.aspectRatio,
        (msg) => setVideoExportProgress(msg)
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'radio_drama_video.webm';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("Video generation failed. Ensure you have generated images and audio first.");
    } finally {
      setIsVideoExporting(false);
      setVideoExportProgress("");
    }
  };

  // --- Project Save/Load Logic ---

  const handleSaveProject = async () => {
    // We need to convert AudioBuffers to Base64 to save them
    const itemsToSave = await Promise.all(state.items.map(async (item) => {
      let audioBase64 = undefined;
      if (item.audioBuffer) {
        const wav = bufferToWav(item.audioBuffer);
        audioBase64 = await blobToBase64(wav);
      }
      return {
        ...item,
        audioBuffer: undefined, // Don't save circular object
        _audioBase64: audioBase64 // Save encoded
      };
    }));

    const projectData = {
      version: 1.1,
      date: new Date().toISOString(),
      storyText: state.storyText,
      cast: state.cast,
      scenes: state.scenes || [],
      items: itemsToSave,
      config: {
        enableSfx: state.enableSfx,
        enableImages: state.enableImages,
        includeNarrator: state.includeNarrator,
        imageStyle: state.imageStyle,
        aspectRatio: state.aspectRatio,
        useElevenLabsForSpeech: state.useElevenLabsForSpeech
      }
    };

    const blob = new Blob([JSON.stringify(projectData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gemini_drama_project.json';
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

        // Restore items
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
          enableSfx: json.config?.enableSfx ?? false,
          includeNarrator: json.config?.includeNarrator ?? true,
          enableImages: json.config?.enableImages ?? true,
          imageStyle: json.config?.imageStyle || "Cinematic Realistic",
          aspectRatio: json.config?.aspectRatio || "16:9",
          useElevenLabsForSpeech: json.config?.useElevenLabsForSpeech ?? false,
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

      {/* Hidden File Inputs */}
      <input type="file" ref={fileInputRef} onChange={handleLoadProject} accept=".json" className="hidden" />
      <input type="file" ref={imageUploadRef} onChange={handleImageUpload} accept="image/*" className="hidden" />

      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-amber-200 bg-clip-text text-transparent flex items-center gap-2">
            <Sparkles className="text-amber-200" />
            Gemini Radio Drama Studio
          </h1>
          <p className="text-zinc-500 text-sm mt-1">Convert stories into full-cast audio dramas with AI visuals</p>
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
                className="w-full h-40 bg-black/40 border border-zinc-700 rounded-lg p-4 text-sm focus:outline-none focus:border-indigo-500 resize-none"
              />
              <button
                onClick={handleGenerateScript}
                disabled={state.isGeneratingScript || !state.storyText.trim()}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {state.isGeneratingScript ? <Loader2 className="animate-spin" size={18} /> : <Wand2 size={18} />}
                Generate Script & Cast
              </button>
              {error && <p className="text-red-400 text-xs text-center">{error}</p>}
            </div>

            <div className="space-y-6">
              <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                <Settings2 size={16} /> Settings
              </h3>

              <div className="space-y-4">
                {/* Image Enable Toggle */}
                <div className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-zinc-800/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-pink-500/10 text-pink-400 rounded-md">
                      <ImageIcon size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Character & Scene Images</p>
                      <p className="text-xs text-zinc-500">Enable visual generation</p>
                    </div>
                  </div>
                  <button onClick={() => setState(prev => ({ ...prev, enableImages: !prev.enableImages }))}>
                    {state.enableImages ? <ToggleRight size={28} className="text-indigo-400" /> : <ToggleLeft size={28} className="text-zinc-600" />}
                  </button>
                </div>

                {/* Image Configuration (Conditional) */}
                {state.enableImages && (
                  <div className="p-3 bg-black/20 rounded-lg border border-zinc-800/50 space-y-4 animate-in fade-in">
                    {/* Aspect Ratio */}
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-500 font-semibold uppercase flex items-center gap-1">
                        <Monitor size={12} /> Aspect Ratio
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setState(prev => ({ ...prev, aspectRatio: "16:9" }))}
                          className={`flex-1 py-1.5 px-3 rounded text-xs border ${state.aspectRatio === "16:9" ? "bg-indigo-600 border-indigo-500 text-white" : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:bg-zinc-800"}`}
                        >
                          <Monitor size={14} className="inline mr-1" /> General (16:9)
                        </button>
                        <button
                          onClick={() => setState(prev => ({ ...prev, aspectRatio: "9:16" }))}
                          className={`flex-1 py-1.5 px-3 rounded text-xs border ${state.aspectRatio === "9:16" ? "bg-indigo-600 border-indigo-500 text-white" : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:bg-zinc-800"}`}
                        >
                          <Smartphone size={14} className="inline mr-1" /> Mobile (9:16)
                        </button>
                      </div>
                    </div>

                    {/* Image Style */}
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-500 font-semibold uppercase flex items-center gap-1">
                        <Palette size={12} /> Visual Style
                      </label>
                      <select
                        value={state.imageStyle}
                        onChange={(e) => {
                          setState(prev => ({ ...prev, imageStyle: e.target.value }));
                          if (e.target.value !== "Custom") setCustomStyle("");
                        }}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-2 text-xs focus:outline-none"
                      >
                        {PRESET_STYLES.map(s => <option key={s} value={s}>{s}</option>)}
                        <option value="Custom">Custom...</option>
                      </select>

                      {(state.imageStyle === "Custom" || customStyle) && (
                        <input
                          type="text"
                          value={customStyle}
                          onChange={(e) => {
                            setCustomStyle(e.target.value);
                            setState(prev => ({ ...prev, imageStyle: "Custom" }));
                          }}
                          placeholder="Enter custom art style..."
                          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-2 text-xs focus:outline-none focus:border-indigo-500"
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* Narrator Toggle */}
                <div className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-zinc-800/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-500/10 text-purple-400 rounded-md">
                      <Mic2 size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Include Narrator</p>
                      <p className="text-xs text-zinc-500">Enable narrator role</p>
                    </div>
                  </div>
                  <button onClick={() => setState(prev => ({ ...prev, includeNarrator: !prev.includeNarrator }))}>
                    {state.includeNarrator ? <ToggleRight size={28} className="text-indigo-400" /> : <ToggleLeft size={28} className="text-zinc-600" />}
                  </button>
                </div>

                {/* SFX Toggle */}
                <div className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-zinc-800/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-500/10 text-amber-400 rounded-md">
                      <Speaker size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Sound Effects</p>
                      <p className="text-xs text-zinc-500">Include SFX cues</p>
                    </div>
                  </div>
                  <button onClick={() => setState(prev => ({ ...prev, enableSfx: !prev.enableSfx }))}>
                    {state.enableSfx ? <ToggleRight size={28} className="text-indigo-400" /> : <ToggleLeft size={28} className="text-zinc-600" />}
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
                      <p className="text-xs text-zinc-500">Required for AI generation</p>
                    </div>
                  </div>
                  <input
                    type="password"
                    placeholder="Enter your Gemini API Key..."
                    value={state.geminiApiKey}
                    onChange={(e) => setState(prev => ({ ...prev, geminiApiKey: e.target.value }))}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-emerald-500"
                  />
                  <p className="text-xs text-zinc-600">Leave empty to use environment variable (API_KEY)</p>
                </div>

                {/* ElevenLabs Config */}
                <div className="p-3 bg-black/20 rounded-lg border border-zinc-800/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-500/10 text-blue-400 rounded-md">
                        <Key size={18} />
                      </div>
                      <div>
                        <p className="text-sm font-medium">ElevenLabs API (Optional)</p>
                      </div>
                    </div>
                    <button onClick={() => setState(prev => ({ ...prev, useElevenLabsForSpeech: !prev.useElevenLabsForSpeech }))} disabled={!state.elevenLabsApiKey}>
                      {state.useElevenLabsForSpeech ? <ToggleRight size={28} className="text-indigo-400" /> : <ToggleLeft size={28} className="text-zinc-600" />}
                    </button>
                  </div>
                  <input
                    type="password"
                    placeholder="API Key"
                    value={state.elevenLabsApiKey}
                    onChange={(e) => setState(prev => ({ ...prev, elevenLabsApiKey: e.target.value }))}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Main Content Area */}
      {state.cast.length > 0 && (
        <main className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-20">

          {/* Left Column: Cast & Scenes */}
          <section className="lg:col-span-1 space-y-8">

            {/* Scenes List */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <MapPin size={18} className="text-indigo-400" /> Scenes
                </h2>
              </div>
              {state.scenes.length === 0 && (
                <div className="text-xs text-zinc-500 italic p-2 border border-zinc-800 rounded">No specific scenes identified. Script will use general visuals.</div>
              )}
              <div className="space-y-3">
                {state.scenes.map((scene, idx) => (
                  <div key={idx} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-20 h-16 rounded-lg bg-zinc-800 flex-shrink-0 overflow-hidden border border-zinc-700 relative group flex items-center justify-center text-zinc-600">
                        {scene.imageUrl ? (
                          <img src={`data:image/png;base64,${scene.imageUrl}`} className="w-full h-full object-cover" alt={scene.name} />
                        ) : (
                          <ImageIcon size={20} />
                        )}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                          <button
                            onClick={() => handleGenerateMasterSceneImage(scene.name, scene.visualDescription)}
                            disabled={scene.isGeneratingVisual}
                            className="text-white hover:text-indigo-400"
                            title="Generate"
                          >
                            {scene.isGeneratingVisual ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                          </button>
                          <button
                            onClick={() => triggerImageUpload('scene', scene.name)}
                            className="text-white hover:text-indigo-400"
                            title="Upload"
                          >
                            <Upload size={16} />
                          </button>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-sm text-white truncate">{scene.name}</h4>
                        <p className="text-[10px] text-zinc-500 line-clamp-3">{scene.visualDescription}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cast List */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Users size={18} className="text-indigo-400" /> Cast
                </h2>
                {state.enableImages && (
                  <button
                    onClick={handleGenerateAllCastImages}
                    disabled={isGeneratingImages}
                    className="flex items-center gap-2 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-[10px] font-medium transition-colors"
                  >
                    {isGeneratingImages ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
                    Generate All Portraits
                  </button>
                )}
              </div>

              <div className="space-y-4">
                {state.cast.map((member, idx) => {
                  const isNarratorMember = isNarrator(member.name);
                  return (
                    <div key={idx} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex flex-col gap-3">
                      <div className="flex items-start gap-3">
                        {/* Cast Portrait */}
                        <div className="w-24 h-24 rounded-lg bg-zinc-800 flex-shrink-0 overflow-hidden border border-zinc-700 relative group flex items-center justify-center text-zinc-600">
                          {member.imageUrl ? (
                            <img src={`data:image/png;base64,${member.imageUrl}`} className="w-full h-full object-cover" alt={member.name} />
                          ) : (
                            isNarratorMember ? <Mic size={24} className="text-zinc-500" /> : <User size={24} />
                          )}

                          {!isNarratorMember && (
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                              <button
                                onClick={() => handleGenerateCastImage(member.name, member.visualDescription || '')}
                                disabled={member.isGeneratingVisual}
                                className="text-white hover:text-indigo-400"
                                title="Generate"
                              >
                                {member.isGeneratingVisual ? <Loader2 size={20} className="animate-spin" /> : <RefreshCw size={20} />}
                              </button>
                              <button
                                onClick={() => triggerImageUpload('cast', member.name)}
                                className="text-white hover:text-indigo-400"
                                title="Upload"
                              >
                                <Upload size={20} />
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0 space-y-2">
                          <div>
                            <h4 className="font-bold text-sm truncate text-white">{member.name}</h4>
                            <p className="text-xs text-zinc-500 truncate">{member.description}</p>
                          </div>

                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <select
                                value={member.voice}
                                onChange={(e) => handleUpdateCast(member.name, { voice: e.target.value })}
                                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[10px] focus:outline-none"
                              >
                                {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Visual Description Edit */}
                      {!isNarratorMember && (
                        <div className="bg-zinc-950/50 rounded p-2 border border-zinc-800/50 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-zinc-500 font-semibold uppercase flex items-center gap-1">
                              <ImageIcon size={10} /> Visual Prompt
                            </span>
                            <button
                              onClick={() => handleGenerateCastImage(member.name, member.visualDescription || '')}
                              disabled={member.isGeneratingVisual || !member.visualDescription}
                              className="text-[10px] bg-zinc-800 hover:bg-indigo-600 text-zinc-300 hover:text-white px-2 py-0.5 rounded transition-colors flex items-center gap-1"
                            >
                              {member.isGeneratingVisual ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
                              Generate
                            </button>
                          </div>
                          <textarea
                            value={member.visualDescription || ''}
                            onChange={(e) => handleUpdateCast(member.name, { visualDescription: e.target.value })}
                            className="w-full bg-transparent text-[11px] text-zinc-400 focus:text-zinc-200 focus:outline-none resize-none leading-tight h-12"
                            placeholder="Describe character appearance..."
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Right Column: Script */}
          <section className="lg:col-span-2 space-y-4">
            <div className="sticky top-0 z-10 bg-zinc-950/80 backdrop-blur-sm py-4 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <FileText size={18} className="text-indigo-400" /> Script ({state.items.length} cues)
              </h2>
              <div className="flex gap-2">
                {state.enableImages && (
                  <button
                    onClick={handleGenerateAllSceneImages}
                    disabled={isGeneratingImages || !allCastReady}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-2 ${allCastReady
                      ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                      : 'bg-zinc-900 text-zinc-600 cursor-not-allowed border border-zinc-800'
                      }`}
                    title={!allCastReady ? "Generate all character portraits first" : ""}
                  >
                    {isGeneratingImages ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                    Generate All Scenes
                  </button>
                )}
                <button
                  onClick={handleGenerateAllAudio}
                  disabled={isGeneratingAll}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-md text-xs font-medium transition-colors flex items-center gap-2"
                >
                  {isGeneratingAll ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
                  Generate All Audio
                </button>
              </div>
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
                    characterImageUrl={castMember?.imageUrl}
                    allCastReady={allCastReady} // Pass global readiness
                    elevenLabsApiKey={state.elevenLabsApiKey}
                    enableImages={state.enableImages}
                    aspectRatio={state.aspectRatio}
                    onUpdate={handleUpdateItem}
                    onRemove={handleRemoveItem}
                    onMove={handleMoveItem}
                    onGenerateAudio={handleGenerateAudio}
                    onGenerateSfx={handleGenerateSfx}
                    onGenerateImage={handleGenerateItemImage}
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
                  : 'bg-emerald-500 text-black hover:bg-emerald-400 hover:scale-105'
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

            <div className="flex items-center gap-3">
              <button
                onClick={handleExportWav}
                disabled={isExporting}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors border border-zinc-700"
              >
                {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                WAV
              </button>

              <button
                onClick={handleExportVideo}
                disabled={isVideoExporting}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg text-sm font-bold transition-all shadow-lg hover:shadow-indigo-500/25"
              >
                {isVideoExporting ? <Loader2 size={16} className="animate-spin" /> : <Video size={16} />}
                {isVideoExporting ? (videoExportProgress || 'Exporting...') : `Video (${state.aspectRatio})`}
              </button>
            </div>

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
