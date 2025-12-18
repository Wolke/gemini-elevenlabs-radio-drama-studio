import React, { useState } from 'react';
import { DramaState, ItemType, ScriptItem, CastMember } from './types';
import { generateScriptFromStory, generateSpeech } from './services/geminiService';
import { generateElevenLabsSfx, generateElevenLabsSpeech } from './services/elevenLabsService';
import { decodeRawPCM, decodeAudioFile, getAudioContext, mergeAudioBuffers, bufferToWav } from './utils/audioUtils';
import { ScriptItemCard } from './components/ScriptItemCard';
import { Player } from './components/Player';
import { Wand2, Play, Square, Settings2, Sparkles, AlertCircle, FileText, Users, User, Volume2, Loader2, Speaker, ToggleLeft, ToggleRight, Key, ChevronDown, ChevronUp, Download } from 'lucide-react';

const VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", 
  "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe", 
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", 
  "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar", 
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", 
  "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"
].sort();

export default function App() {
  const [state, setState] = useState<DramaState>({
    storyText: '',
    cast: [],
    items: [],
    isGeneratingScript: false,
    isPlaying: false,
    currentPlayingId: null,
    enableSfx: false,
    elevenLabsApiKey: '',
    useElevenLabsForSpeech: false,
  });

  const [isConfigExpanded, setIsConfigExpanded] = useState(true);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateScript = async () => {
    if (!state.storyText.trim()) return;
    
    setError(null);
    setState(prev => ({ ...prev, isGeneratingScript: true }));
    
    try {
      const { cast, items } = await generateScriptFromStory(state.storyText, state.enableSfx);
      setState(prev => ({ ...prev, cast, items, isGeneratingScript: false }));
      setIsConfigExpanded(false); // Collapse config after successful generation
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

  const handleUpdateCastVoice = (characterName: string, voice: string) => {
    setState(prev => ({
      ...prev,
      cast: prev.cast.map(c => c.name === characterName ? { ...c, voice } : c)
    }));
  };

  const handleGenerateAudio = async (id: string, text: string, voice: string, expression: string) => {
    // Reset error state and set loading
    handleUpdateItem(id, { isLoadingAudio: true, generationError: undefined });
    
    try {
      const ctx = getAudioContext();
      let buffer: AudioBuffer;

      if (state.useElevenLabsForSpeech && state.elevenLabsApiKey) {
        // Use ElevenLabs
        const base64 = await generateElevenLabsSpeech(text, voice, state.elevenLabsApiKey);
        buffer = await decodeAudioFile(base64, ctx);
      } else {
        // Use Gemini
        // We explicitly pass the parameters here, which come from the component's current props
        const base64 = await generateSpeech(text, voice, expression);
        buffer = await decodeRawPCM(base64, ctx);
      }
      
      handleUpdateItem(id, { 
        audioBuffer: buffer, 
        isLoadingAudio: false,
        generationError: undefined
      });
    } catch (e: any) {
      console.error(e);
      // Store the specific error message on the item so the user can see it
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
        // Clear Youtube settings if we successfully generated an audio file
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
      // Generate speech if missing
      (item.type === ItemType.SPEECH && !item.audioBuffer) ||
      // Generate SFX if missing and EL is enabled (optional, but good for "one click")
      (item.type === ItemType.SFX && !item.audioBuffer && state.elevenLabsApiKey && item.sfxDescription)
    );

    for (const item of itemsToProcess) {
      if (item.type === ItemType.SPEECH) {
        const castMember = state.cast.find(c => c.name === item.character);
        const voice = castMember?.voice || 'Puck';
        await handleGenerateAudio(item.id, item.text || '', voice, item.expression || '');
      } else if (item.type === ItemType.SFX && state.elevenLabsApiKey) {
        await handleGenerateSfx(item.id, item.sfxDescription || 'sound');
      }
      
      // Delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    setIsGeneratingAll(false);
  };

  const handleExportAudio = async () => {
    const buffersToMerge = state.items
      .map(item => item.audioBuffer)
      .filter((b): b is AudioBuffer => !!b);

    if (buffersToMerge.length === 0) {
      alert("No generated audio found to export.");
      return;
    }

    setIsExporting(true);
    try {
      const mergedBuffer = await mergeAudioBuffers(buffersToMerge);
      const wavBlob = bufferToWav(mergedBuffer);
      
      // Trigger download
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gemini-drama-${Date.now()}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
      alert("Failed to export audio.");
    } finally {
      setIsExporting(false);
    }
  };

  const handlePreviewAudio = (buffer: AudioBuffer) => {
    const ctx = getAudioContext();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
  };

  const handlePlayToggle = () => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    setState(prev => ({ ...prev, isPlaying: !prev.isPlaying }));
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-indigo-500/30">
      
      {/* Navbar */}
      <header className="fixed top-0 w-full bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Sparkles size={18} className="text-white" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">Gemini Studio</h1>
          </div>
          
          <div className="flex items-center gap-4">
             {state.items.length > 0 && (
                <>
                  <button
                    onClick={handleExportAudio}
                    disabled={isExporting}
                    className="flex items-center gap-2 px-4 py-2 rounded-full font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors text-sm border border-zinc-700"
                    title="Export merged audio"
                  >
                    {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                    <span className="hidden sm:inline">Export WAV</span>
                  </button>

                  <button
                    onClick={handlePlayToggle}
                    className={`flex items-center gap-2 px-6 py-2 rounded-full font-medium transition-all ${
                      state.isPlaying 
                        ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/50' 
                        : 'bg-zinc-100 text-zinc-950 hover:bg-white border border-transparent'
                    }`}
                  >
                    {state.isPlaying ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                    {state.isPlaying ? 'Stop Broadcast' : 'Play Drama'}
                  </button>
                </>
             )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 pt-24 pb-20 space-y-12">

        {/* Configuration Section */}
        <section className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden transition-all">
           <div 
             className="flex items-center justify-between p-5 cursor-pointer bg-zinc-900/50 hover:bg-zinc-900 transition-colors"
             onClick={() => setIsConfigExpanded(!isConfigExpanded)}
           >
             <div className="flex items-center gap-2 text-zinc-400">
                <Settings2 size={18} />
                <h3 className="font-semibold text-sm uppercase tracking-wider">Configuration</h3>
             </div>
             {isConfigExpanded ? <ChevronUp size={16} className="text-zinc-500" /> : <ChevronDown size={16} className="text-zinc-500" />}
           </div>
           
           {isConfigExpanded && (
             <div className="p-5 pt-0 grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-zinc-800/50 mt-2">
                {/* SFX Toggle */}
                <div className="flex flex-col gap-2 pt-4">
                   <div className="flex items-center justify-between">
                      <span className="text-zinc-300 text-sm">Include Sound Effects (SFX)</span>
                      <button 
                        onClick={() => setState(prev => ({...prev, enableSfx: !prev.enableSfx}))}
                        className={`text-2xl transition-colors ${state.enableSfx ? 'text-indigo-400' : 'text-zinc-600'}`}
                      >
                        {state.enableSfx ? <ToggleRight /> : <ToggleLeft />}
                      </button>
                   </div>
                   <p className="text-xs text-zinc-500">If enabled, the AI will add sound effect cues to the script.</p>
                </div>

                {/* ElevenLabs Settings */}
                {state.enableSfx && (
                   <div className="flex flex-col gap-3 border-l border-zinc-800 pl-6 pt-4">
                      <div className="space-y-1">
                         <label className="text-xs font-bold text-zinc-500 uppercase flex items-center gap-1">
                            <Key size={12} />
                            ElevenLabs API Key
                         </label>
                         <input 
                           type="password" 
                           value={state.elevenLabsApiKey}
                           onChange={(e) => setState(prev => ({...prev, elevenLabsApiKey: e.target.value}))}
                           placeholder="sk_..."
                           className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 focus:border-indigo-500/50 focus:outline-none"
                         />
                      </div>

                      {state.elevenLabsApiKey && (
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-zinc-300 text-sm">Use ElevenLabs for Voice?</span>
                          <button 
                            onClick={() => setState(prev => ({...prev, useElevenLabsForSpeech: !prev.useElevenLabsForSpeech}))}
                            className={`text-2xl transition-colors ${state.useElevenLabsForSpeech ? 'text-indigo-400' : 'text-zinc-600'}`}
                          >
                            {state.useElevenLabsForSpeech ? <ToggleRight /> : <ToggleLeft />}
                          </button>
                        </div>
                      )}
                   </div>
                )}
             </div>
           )}
        </section>

        {/* Story Input Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
             <FileText className="text-zinc-500" size={20}/>
             <h2 className="text-xl font-semibold text-zinc-200">The Script</h2>
          </div>
          
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl opacity-20 group-focus-within:opacity-50 transition duration-500 blur"></div>
            <div className="relative">
              <textarea 
                value={state.storyText}
                onChange={(e) => setState(prev => ({ ...prev, storyText: e.target.value }))}
                placeholder="Enter your story here... (e.g., 'Once upon a time in a futuristic city, Detective John found a mysterious glowing orb...')"
                className="w-full h-48 bg-zinc-900 rounded-xl p-6 text-zinc-300 placeholder:text-zinc-600 focus:outline-none resize-none text-lg leading-relaxed shadow-xl"
              />
              <div className="absolute bottom-4 right-4">
                 <button 
                  onClick={handleGenerateScript}
                  disabled={state.isGeneratingScript || !state.storyText.trim()}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-900/20"
                 >
                   {state.isGeneratingScript ? <Settings2 className="animate-spin" size={18} /> : <Wand2 size={18} />}
                   {state.isGeneratingScript ? 'Writing Script...' : 'Convert to Script'}
                 </button>
              </div>
            </div>
          </div>
          
          {error && (
            <div className="bg-red-900/20 border border-red-800 text-red-200 p-4 rounded-lg flex items-center gap-3">
              <AlertCircle size={20} />
              <p>{error}</p>
            </div>
          )}
        </section>

        {/* Cast Section */}
        {state.cast.length > 0 && (
          <section className="space-y-4">
             <div className="flex items-center gap-2 mb-2">
                <Users className="text-zinc-500" size={20}/>
                <h2 className="text-xl font-semibold text-zinc-200">Cast & Voices</h2>
             </div>
             
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {state.cast.map((member, idx) => (
                  <div key={idx} className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 p-3 rounded-lg">
                     <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500">
                        <User size={20} />
                     </div>
                     <div className="flex-1 min-w-0">
                       <h3 className="font-medium text-zinc-200 truncate">{member.name}</h3>
                       {member.description && <p className="text-xs text-zinc-500 truncate">{member.description}</p>}
                     </div>
                     {/* If using ElevenLabs, the dropdown technically maps to a hidden ID, but we keep the visual metaphor of the 'Gemini' personality type */}
                     <select 
                        value={member.voice}
                        onChange={(e) => handleUpdateCastVoice(member.name, e.target.value)}
                        className="bg-zinc-950 border border-zinc-700 text-xs text-zinc-300 rounded px-2 py-1 focus:outline-none"
                     >
                       {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                     </select>
                  </div>
                ))}
             </div>
          </section>
        )}

        {/* Timeline Editor Section */}
        {state.items.length > 0 && (
          <section className="space-y-6">
             <div className="flex items-center justify-between">
               <div className="flex items-center gap-4">
                 <h2 className="text-xl font-semibold text-zinc-200">Production Timeline</h2>
                 <span className="text-sm text-zinc-500">{state.items.length} cues</span>
               </div>
               
               <button 
                onClick={handleGenerateAllAudio}
                disabled={isGeneratingAll}
                className="flex items-center gap-2 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
               >
                 {isGeneratingAll ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
                 {isGeneratingAll ? 'Generating...' : 'Generate All Missing Audio'}
               </button>
             </div>

             <div className="space-y-4 relative">
                {/* Connector Line */}
                <div className="absolute left-8 top-0 bottom-0 w-px bg-zinc-800 -z-10" />

                {state.items.map((item, index) => {
                  const member = state.cast.find(c => c.name === item.character);
                  return (
                    <div key={item.id} className="relative pl-0"> 
                      <ScriptItemCard 
                        item={item}
                        index={index}
                        totalItems={state.items.length}
                        assignedVoice={member?.voice}
                        elevenLabsApiKey={state.elevenLabsApiKey}
                        onUpdate={handleUpdateItem}
                        onRemove={handleRemoveItem}
                        onMove={handleMoveItem}
                        onGenerateAudio={handleGenerateAudio}
                        onGenerateSfx={handleGenerateSfx}
                        onPreviewAudio={handlePreviewAudio}
                        isPlaying={state.currentPlayingId === item.id}
                      />
                    </div>
                  );
                })}
             </div>
          </section>
        )}

      </main>

      {/* Hidden Player orchestrator */}
      <Player 
        items={state.items}
        isPlaying={state.isPlaying}
        onPlayStateChange={(isPlaying, currentId) => setState(prev => ({ ...prev, isPlaying, currentPlayingId: currentId }))}
      />
    </div>
  );
}