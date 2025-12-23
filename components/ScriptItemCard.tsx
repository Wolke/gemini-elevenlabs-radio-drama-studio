
import React from 'react';
import { ItemType, ScriptItem } from '../types';
import { Play, Mic, Music, Trash2, ArrowUp, ArrowDown, Loader2, Volume2, MessageSquare, RotateCw, Wand2, AlertCircle, MapPin } from 'lucide-react';

interface ScriptItemCardProps {
  item: ScriptItem;
  index: number;
  totalItems: number;
  assignedVoice?: string;
  voiceType?: 'gemini' | 'elevenlabs';
  elevenLabsApiKey?: string;
  onUpdate: (id: string, updates: Partial<ScriptItem>) => void;
  onRemove: (id: string) => void;
  onMove: (index: number, direction: 'up' | 'down') => void;
  onGenerateAudio: (id: string, text: string, voice: string, expression: string) => void;
  onGenerateSfx: (id: string, description: string) => void;
  onPreviewAudio: (buffer: AudioBuffer) => void;
  isPlaying: boolean;
}

export const ScriptItemCard: React.FC<ScriptItemCardProps> = ({
  item,
  index,
  totalItems,
  assignedVoice,
  voiceType,
  elevenLabsApiKey,
  onUpdate,
  onRemove,
  onMove,
  onGenerateAudio,
  onGenerateSfx,
  onPreviewAudio,
  isPlaying,
}) => {

  const currentVoice = assignedVoice || 'Puck';

  // Voice badge color based on type
  const voiceBadgeClass = voiceType === 'elevenlabs'
    ? 'text-blue-400 bg-blue-500/10 border-blue-500/30'
    : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';

  return (
    <div className={`relative flex flex-col gap-3 p-4 rounded-xl border transition-all duration-300 ${isPlaying
      ? 'bg-indigo-900/30 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.3)]'
      : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
      }`}>

      {/* Header / Type Indicator */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${item.type === ItemType.SPEECH ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
            {item.type === ItemType.SPEECH ? <Mic size={16} /> : <Music size={16} />}
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {item.type === ItemType.SPEECH ? 'Dialogue' : 'Sound Effect'}
          </span>
          {item.location && (
            <div className="flex items-center gap-1 bg-zinc-950 px-2 py-0.5 rounded text-[10px] text-zinc-400 border border-zinc-800">
              <MapPin size={10} />
              <span>{item.location}</span>
            </div>
          )}
          {item.type === ItemType.SPEECH && (
            <div className="flex items-center gap-2 ml-2 bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700">
              <span className="text-sm font-bold text-zinc-200">
                {item.character}
              </span>
              <span className={`text-[10px] uppercase border-l border-zinc-600 pl-2 px-1 py-0.5 rounded ${voiceBadgeClass}`}>
                {voiceType === 'elevenlabs' ? '🔊 ' : ''}{currentVoice}
              </span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onMove(index, 'up')}
            disabled={index === 0}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 disabled:opacity-30 hover:bg-zinc-800 rounded transition-colors"
          >
            <ArrowUp size={16} />
          </button>
          <button
            onClick={() => onMove(index, 'down')}
            disabled={index === totalItems - 1}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 disabled:opacity-30 hover:bg-zinc-800 rounded transition-colors"
          >
            <ArrowDown size={16} />
          </button>
          <button
            onClick={() => onRemove(item.id)}
            className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors ml-2"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Content Row */}
      <div className="flex flex-col gap-3">

        {/* Text & Audio Controls */}
        <div className="flex-1 space-y-3">
          {item.type === ItemType.SPEECH ? (
            <>
              {/* Expression Input */}
              <div className="flex items-center gap-2 bg-zinc-950/30 p-2 rounded border border-zinc-800/50">
                <MessageSquare size={14} className="text-zinc-500" />
                <span className="text-xs text-zinc-500 whitespace-nowrap">Expression:</span>
                <input
                  type="text"
                  value={item.expression || ''}
                  onChange={(e) => onUpdate(item.id, { expression: e.target.value })}
                  placeholder="e.g. whispering, shouting, cheerful"
                  className="w-full bg-transparent text-xs text-amber-200 placeholder:text-zinc-700 focus:outline-none"
                />
              </div>

              <textarea
                value={item.text || ''}
                onChange={(e) => onUpdate(item.id, { text: e.target.value })}
                className="w-full bg-zinc-950/50 border border-zinc-700 rounded-lg p-3 text-zinc-200 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50 resize-none leading-relaxed"
                rows={2}
              />
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 bg-zinc-950/30 p-2 rounded border border-zinc-800/50">
                <span className="text-xs text-zinc-500 whitespace-nowrap font-bold">SFX Prompt:</span>
                <input
                  type="text"
                  value={item.sfxDescription || ''}
                  onChange={(e) => onUpdate(item.id, { sfxDescription: e.target.value })}
                  className="w-full bg-transparent text-xs text-amber-200 placeholder:text-zinc-700 focus:outline-none"
                />
              </div>
            </>
          )}

          {/* Audio Action Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {item.audioBuffer && (
              <button
                onClick={() => onPreviewAudio(item.audioBuffer!)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/30 transition-colors"
              >
                <Play size={14} fill="currentColor" />
                Play
              </button>
            )}

            {item.type === ItemType.SPEECH ? (
              <button
                onClick={() => onGenerateAudio(item.id, item.text || '', currentVoice, item.expression || '')}
                disabled={item.isLoadingAudio || !item.text}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${item.audioBuffer
                  ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                  : 'bg-zinc-100 text-zinc-900 hover:bg-white'
                  }`}
              >
                {item.isLoadingAudio ? <Loader2 size={14} className="animate-spin" /> : (item.audioBuffer ? <RotateCw size={14} /> : <Volume2 size={14} />)}
                {item.audioBuffer ? 'Regenerate' : 'Generate Voice'}
              </button>
            ) : elevenLabsApiKey ? (
              <button
                onClick={() => onGenerateSfx(item.id, item.sfxDescription || 'sound')}
                disabled={item.isLoadingAudio || !item.sfxDescription}
                className="flex items-center gap-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-md text-xs font-medium transition-colors disabled:opacity-50"
              >
                {item.isLoadingAudio ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                {item.audioBuffer ? 'Regenerate SFX' : 'Generate SFX'}
              </button>
            ) : null}
          </div>

          {item.generationError && (
            <div className="flex items-start gap-2 p-2 bg-red-900/30 border border-red-800/50 rounded-lg text-xs text-red-200 w-full">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{item.generationError}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
