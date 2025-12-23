
// Service for interacting with ElevenLabs API

import { ElevenLabsVoice } from '../types';

// Mapping of some Gemini archetype vibes to ElevenLabs Pre-made Voice IDs
// Used as fallback when no specific ElevenLabs voice is selected
const VOICE_MAPPING: Record<string, string> = {
  // Default fallback (Antoni - Balanced)
  'default': 'ErXwobaYiN019PkySvjV',

  // Masculine / Deep
  'Charon': 'TxGEqnHWrfWFTfGW9XjX', // Josh
  'Fenrir': 'TxGEqnHWrfWFTfGW9XjX', // Josh
  'Alnilam': 'TxGEqnHWrfWFTfGW9XjX', // Josh

  // Feminine / Soft
  'Kore': 'EXAVITQu4vr4xnSDxMaL', // Bella
  'Achernar': 'EXAVITQu4vr4xnSDxMaL', // Bella
  'Leda': '21m00Tcm4TlvDq8ikWAM', // Rachel

  // Energetic / Bright
  'Zephyr': 'pFZP5JQG7iQjIQuC4Bku', // Lily
  'Puck': 'pFZP5JQG7iQjIQuC4Bku', // Lily

  // Mature / Narrative
  'Gacrux': 'ODq5zmih8GrVes37Dizj', // Patrick
  'Rasalgethi': 'ODq5zmih8GrVes37Dizj', // Patrick
};

function getVoiceIdFromGeminiName(geminiVoiceName: string): string {
  return VOICE_MAPPING[geminiVoiceName] || VOICE_MAPPING['default'];
}

/**
 * Fetch all available voices from ElevenLabs account
 * Includes pre-made voices and user's custom trained voices
 */
export async function fetchElevenLabsVoices(apiKey: string): Promise<ElevenLabsVoice[]> {
  console.log("--- [ElevenLabs] Fetching Voices ---");

  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    method: 'GET',
    headers: {
      'xi-api-key': apiKey,
    },
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`ElevenLabs Voices Error: ${err.detail?.message || response.statusText}`);
  }

  const data = await response.json();
  const voices: ElevenLabsVoice[] = (data.voices || []).map((v: any) => ({
    voice_id: v.voice_id,
    name: v.name,
    category: v.category,
    labels: v.labels,
    preview_url: v.preview_url,
  }));

  console.log(`[ElevenLabs] Found ${voices.length} voices`);
  return voices;
}

export const generateElevenLabsSfx = async (
  text: string,
  durationSeconds: number = 4,
  apiKey: string
): Promise<string> => {

  console.log("--- [ElevenLabs] Generate SFX Prompt ---");
  console.log(text);
  console.log("----------------------------------------");

  // POST https://api.elevenlabs.io/v1/sound-generation
  const response = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text: text,
      duration_seconds: Math.min(Math.max(durationSeconds, 0.5), 22), // API limits
      prompt_influence: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`ElevenLabs SFX Error: ${err.detail?.message || response.statusText}`);
  }

  // Returns audio/mpeg binary
  const arrayBuffer = await response.arrayBuffer();
  // Convert to base64 for consistency with our app flow
  return arrayBufferToBase64(arrayBuffer);
};

/**
 * Generate speech using ElevenLabs TTS
 * @param text - Text to speak
 * @param voiceId - Direct ElevenLabs voice ID (when user selected specific voice)
 * @param geminiVoiceName - Fallback Gemini voice name (for mapping when no specific ID)
 * @param voicePrompt - Optional accent/style prompt (will be converted to Audio Tag)
 * @param apiKey - ElevenLabs API key
 */
export const generateElevenLabsSpeech = async (
  text: string,
  voiceId: string | undefined,
  geminiVoiceName: string,
  voicePrompt: string | undefined,
  apiKey: string
): Promise<string> => {
  // Use provided voiceId, or fall back to mapping from Gemini voice name
  const finalVoiceId = voiceId || getVoiceIdFromGeminiName(geminiVoiceName);

  // Prepend Audio Tag for accent/style control if voicePrompt is provided
  const finalText = voicePrompt
    ? `[${voicePrompt}] ${text}`
    : text;

  console.log("--- [ElevenLabs] Generate Speech ---");
  console.log(`Text: ${finalText}`);
  console.log(`Voice ID: ${finalVoiceId}`);
  console.log("------------------------------------");

  // POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${finalVoiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text: finalText,
      model_id: "eleven_multilingual_v2", // Multilingual model for Chinese support
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      }
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`ElevenLabs TTS Error: ${err.detail?.message || response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return arrayBufferToBase64(arrayBuffer);
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
