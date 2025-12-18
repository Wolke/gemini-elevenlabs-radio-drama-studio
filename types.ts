export enum ItemType {
  SPEECH = 'speech',
  SFX = 'sfx',
}

export interface CastMember {
  name: string;
  voice: string; // One of the 30 Gemini voices (e.g. 'Puck', 'Charon', 'Kore', 'Zephyr', 'Fenrir', etc.)
  description?: string;
}

export interface ScriptItem {
  id: string;
  type: ItemType;
  character?: string;
  text?: string;
  expression?: string; // e.g., "excited", "whispering"
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
  items: ScriptItem[];
  isGeneratingScript: boolean;
  isPlaying: boolean;
  currentPlayingId: string | null;
  
  // Configuration
  enableSfx: boolean;
  elevenLabsApiKey: string;
  useElevenLabsForSpeech: boolean;
}