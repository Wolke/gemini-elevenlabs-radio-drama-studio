
export enum ItemType {
  SPEECH = 'speech',
  SFX = 'sfx',
}

export type LlmProvider = 'gemini' | 'openai';
export type TtsProvider = 'gemini' | 'openai' | 'elevenlabs';
export type VoiceType = 'gemini' | 'openai' | 'elevenlabs';
export type ImageProvider = 'gemini' | 'openai';

// Available Gemini models for script generation
export const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
] as const;
export type GeminiModel = typeof GEMINI_MODELS[number];

// Available OpenAI models for script generation
export const OPENAI_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'o1',
  'o1-mini',
  'o3-mini',
] as const;
export type OpenAIModel = typeof OPENAI_MODELS[number];

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
}

export interface CastMember {
  name: string;
  voice: string; // Gemini/OpenAI voice name OR display name
  voiceType: VoiceType; // Source of the voice
  elevenLabsVoiceId?: string; // ElevenLabs Voice ID (when voiceType is 'elevenlabs')
  description?: string;
  voicePrompt?: string; // Accent/style prompt for TTS, e.g. "Native Taiwanese Mandarin, cheerful"
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

  // Audio state
  audioBuffer?: AudioBuffer | null;
  isLoadingAudio?: boolean;
  generationError?: string; // Capture API errors here

}

export interface CharacterVoice {
  name: string;
  voiceName: string;
}

// Auto-generated Podcast metadata from script generation
export interface GeneratedPodcastInfo {
  podcastName: string;        // Podcast 名稱
  author: string;             // 作者
  episodeTitle: string;       // 本集標題
  description: string;        // Podcast 描述
  coverPrompt: string;        // 封面圖生成提示
  tags?: string[];            // 標籤
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

  // OpenAI Configuration
  openaiApiKey: string;
  llmProvider: LlmProvider;
  ttsProvider: TtsProvider;

  // Model selection
  geminiModel: GeminiModel;
  openaiModel: OpenAIModel;

  // ElevenLabs voices cache
  elevenLabsVoices: ElevenLabsVoice[];
  isLoadingVoices: boolean;

  // Auto-generated Podcast info
  podcastInfo: GeneratedPodcastInfo | null;

  // Timestamp when the script was last generated
  scriptGenerationTimestamp?: number;
}
