
export enum ItemType {
  SPEECH = 'speech',
  SFX = 'sfx',
}

export type VoiceType = 'gemini' | 'elevenlabs';

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
}

export interface CastMember {
  name: string;
  voice: string; // Gemini voice name OR display name
  voiceType: VoiceType; // Source of the voice
  elevenLabsVoiceId?: string; // ElevenLabs Voice ID (when voiceType is 'elevenlabs')
  description?: string;
}

export interface SceneDefinition {
  id: string;
  name: string;
  visualDescription: string;
}

export interface ScriptItem {
  id: string;
  type: ItemType;
  character?: string;
  text?: string;
  expression?: string; // e.g., "excited", "whispering"
  location?: string; // Reference to SceneDefinition.name
  sfxDescription?: string;
  sfxSearchQuery?: string;

  // Audio state
  audioBuffer?: AudioBuffer | null;
  isLoadingAudio?: boolean;
  generationError?: string; // Capture API errors here

  // YouTube SFX state
  youtubeId?: string;
  youtubeStartTime?: number; // seconds
  youtubeDuration?: number; // seconds
}

export interface CharacterVoice {
  name: string;
  voiceName: string;
}

export interface DramaState {
  storyText: string;
  cast: CastMember[];
  scenes: SceneDefinition[];
  items: ScriptItem[];
  isGeneratingScript: boolean;
  isPlaying: boolean;
  currentPlayingId: string | null;

  // Configuration
  enableSfx: boolean;
  includeNarrator: boolean;
  geminiApiKey: string;
  elevenLabsApiKey: string;
  useElevenLabsForSpeech: boolean;

  // ElevenLabs voices cache
  elevenLabsVoices: ElevenLabsVoice[];
  isLoadingVoices: boolean;
}
