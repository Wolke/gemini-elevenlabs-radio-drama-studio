/**
 * Shared prompt templates for script generation
 * Used by both Gemini and OpenAI services
 */

import { ElevenLabsVoice } from '../types';

/**
 * Get SFX instructions based on whether sound effects are enabled
 */
export const getSfxInstructions = (includeSfx: boolean): string => {
    if (includeSfx) {
        return `
       - For 'sfx' (Sound Effects):
         - 'sfxDescription': A short, descriptive prompt for a sound effect generator.
    `;
    }
    return `
       - **IMPORTANT**: DO NOT generate any items with type 'sfx'. The user has disabled sound effects.
    `;
};

/**
 * Get narrator instructions based on settings
 */
export const getNarratorInstructions = (includeNarrator: boolean, includeSfx: boolean): string => {
    if (includeNarrator) {
        return `
       - **Narrator**: You MUST include a character named 'Narrator' (or '旁白' if the story is in Chinese) in the cast and script. 
         - Use the Narrator to describe the setting, actions, transitions, and atmosphere that cannot be conveyed by dialogue alone.
         - Ensure the Narrator appears frequently to guide the listener.
    `;
    }
    return `
       - **Narrator**: DO NOT include a Narrator or System character. 
         - The story must be conveyed ENTIRELY through character dialogue${includeSfx ? ' and sound effects' : ''}.
         - Adapt the dialogue so characters describe actions if necessary.
    `;
};

/**
 * Get voice prompt examples for TTS accent/style guidance
 */
export const getVoicePromptExamples = (): string => {
    return `
     - "Native Taiwanese Mandarin speaker, soft and friendly"
     - "Native Beijing Mandarin speaker, formal and authoritative"
     - "Shandong accent Mandarin speaker, earnest and straightforward"
     - "Sichuan accent Mandarin speaker, lively and humorous"
     - "Hong Kong Cantonese accent speaking Mandarin, businesslike"
     - "American English speaker, energetic and youthful"
     
     **IMPORTANT for Chinese stories**: 
     - **Character-specific accent takes priority**: If the story explicitly mentions a character's regional origin or accent (e.g., 山東伯伯, 四川人, 外省籍), use that specific regional accent (e.g., "Shandong accent Mandarin speaker", NOT "Taiwanese Mandarin with Shandong accent").
     - **Do NOT mix accents illogically**: A person is either a Shandong accent speaker OR a Taiwanese Mandarin speaker, not both at the same time.
     - **Default accent**: For characters without specified regional origin:
       - Traditional Chinese (繁體字) stories → "Native Taiwanese Mandarin speaker"
       - Simplified Chinese (简体字) stories → "Native Beijing Mandarin speaker"`;
};

/**
 * Get language instructions for multilingual support
 */
export const getLanguageInstructions = (): string => {
    return `**LANGUAGE INSTRUCTION**: 
- The 'text' (dialogue) field MUST be in the SAME LANGUAGE as the input story. 
- The 'expression' and 'visualDescription' (for scenes) fields MUST ALWAYS be in ENGLISH.`;
};

/**
 * Get scenes instructions
 */
export const getScenesInstructions = (): string => {
    return `2. **Scenes**: Identify the key locations/environments in the story.
   - Provide a 'name' (e.g., "Living Room", "Forest at Night").
   - Provide a 'visualDescription' (ENGLISH): Detailed atmospheric description.`;
};

/**
 * Get ElevenLabs voices instructions if available
 */
export const getElevenLabsVoicesInstructions = (voices: ElevenLabsVoice[]): string => {
    if (voices.length === 0) return '';

    return `
   - **IMPORTANT**: You have access to the following ElevenLabs voices. Pick the most suitable voice for each character based on the voice characteristics:
${voices.slice(0, 20).map(v => `     - "${v.name}" (ID: ${v.voice_id})${v.labels ? ` - ${Object.entries(v.labels).map(([k, val]) => `${k}: ${val}`).join(', ')}` : ''}`).join('\n')}
   - Set 'elevenLabsVoiceId' to the voice ID that best matches the character.
   `;
};

/**
 * Get the complete system prompt intro
 */
export const getSystemPromptIntro = (): string => {
    return `You are an expert radio drama scriptwriter and director. 
Convert stories into detailed radio drama scripts with a cast list, a list of scenes (locations), and a sequence of cues.`;
};

/**
 * Build cast instructions with voice list
 */
export const buildCastInstructions = (
    voiceListStr: string,
    elevenLabsVoices: ElevenLabsVoice[],
    narratorInstructions: string
): string => {
    return `1. **Cast**: Identify all characters. 
   - Assign a voice from the voice list: ${voiceListStr}.
   - Provide a brief 'description' of the character's role.
   - Provide a 'voicePrompt' (ENGLISH): A TTS prompt describing the character's accent, speech style, and tone. Examples:${getVoicePromptExamples()}
   ${getElevenLabsVoicesInstructions(elevenLabsVoices)}
   ${narratorInstructions}`;
};

/**
 * Build script instructions for OpenAI (needs explicit type field)
 */
export const buildScriptInstructionsOpenAI = (sfxInstructions: string): string => {
    return `3. **Script**: A list of cues. Each cue MUST have a 'type' field with value either 'speech' or 'sfx'.
   - 'type': REQUIRED - Either 'speech' (for dialogue) or 'sfx' (for sound effects).
   - 'location': The name of the scene where this cue takes place (MUST match a name from the Scenes list).
   - For type 'speech':
     - 'character': Name from the cast list.
     - 'text': The dialogue (IN THE STORY'S LANGUAGE).
     - 'expression': A direction for HOW it should be spoken (IN ENGLISH).
   ${sfxInstructions}

Return a JSON object with keys "cast", "scenes", and "script". Example script item format:
- Speech: {"type": "speech", "location": "Living Room", "character": "Alice", "text": "Hello!", "expression": "cheerful"}
- SFX: {"type": "sfx", "location": "Forest", "sfxDescription": "Birds chirping"}`;
};

/**
 * Build script instructions for Gemini (schema enforces type)
 */
export const buildScriptInstructionsGemini = (sfxInstructions: string): string => {
    return `3. **Script**: A list of cues.
   - 'location': The name of the scene where this cue takes place (MUST match a name from the Scenes list).
   - For 'speech':
     - 'character': Name from the cast list.
     - 'text': The dialogue (IN THE STORY'S LANGUAGE).
     - 'expression': A direction for HOW it should be spoken (IN ENGLISH).
   ${sfxInstructions}

Return a JSON object with keys "cast", "scenes", and "script".`;
};
