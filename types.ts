
export enum ItemType {
  SPEECH = 'speech',
  SFX = 'sfx',
}

export interface CastMember {
  name: string;
  voice: string; // One of the 30 Gemini voices
  description?: string;
  visualDescription?: string; // Physical appearance for image gen
  imageUrl?: string; // Base64 character portrait
  isGeneratingVisual?: boolean; // UI loading state
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
  
  // Image state
  imageUrl?: string; // Base64 scene image
  isGeneratingVisual?: boolean;

  // YouTube SFX state
  youtubeId?: string;
  youtubeStartTime?: number; // seconds
  youtubeDuration?: number; // seconds
}

export interface CharacterVoice {
  name: string;
  voiceName: string;
}

export type AspectRatio = '16:9' | '9:16';

export interface DramaState {
  storyText: string;
  cast: CastMember[];
  items: ScriptItem[];
  isGeneratingScript: boolean;
  isPlaying: boolean;
  currentPlayingId: string | null;
  
  // Configuration
  enableSfx: boolean;
  enableImages: boolean; // New config
  imageStyle: string; // e.g. "Watercolor", "Cyberpunk"
  aspectRatio: AspectRatio; 
  elevenLabsApiKey: string;
  useElevenLabsForSpeech: boolean;
}
