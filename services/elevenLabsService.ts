// Service for interacting with ElevenLabs API

// Mapping of some Gemini archetype vibes to ElevenLabs Pre-made Voice IDs
// This ensures that if the user selects "Puck" (Upbeat), we get a somewhat compatible EL voice.
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

function getVoiceId(geminiVoiceName: string): string {
  return VOICE_MAPPING[geminiVoiceName] || VOICE_MAPPING['default'];
}

export const generateElevenLabsSfx = async (
  text: string, 
  durationSeconds: number = 4, 
  apiKey: string
): Promise<string> => {
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

export const generateElevenLabsSpeech = async (
  text: string, 
  geminiVoiceName: string, 
  apiKey: string
): Promise<string> => {
  const voiceId = getVoiceId(geminiVoiceName);
  
  // POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text: text,
      model_id: "eleven_multilingual_v2", // Updated to multilingual model to support Chinese
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