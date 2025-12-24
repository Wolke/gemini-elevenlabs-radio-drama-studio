
// Service for interacting with OpenAI API

import { ItemType, ScriptItem, CastMember, SceneDefinition, ElevenLabsVoice } from '../types';

// OpenAI TTS available voices
export const OPENAI_VOICES = [
    'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'
] as const;

export type OpenAIVoice = typeof OPENAI_VOICES[number];

interface GeneratedScriptResponse {
    cast: CastMember[];
    scenes: { name: string; visualDescription: string }[];
    script: any[];
}

/**
 * Generate script from story using OpenAI Chat Completions API
 */
export const generateScriptFromStoryOpenAI = async (
    story: string,
    includeSfx: boolean = true,
    includeNarrator: boolean = true,
    elevenLabsVoices: ElevenLabsVoice[] = [],
    apiKey?: string
): Promise<{ cast: CastMember[], scenes: SceneDefinition[], items: ScriptItem[] }> => {
    if (!story.trim()) return { cast: [], scenes: [], items: [] };

    const key = apiKey || '';
    if (!key) {
        throw new Error("OpenAI API Key is required. Please enter it in Settings.");
    }

    let sfxInstructions = "";
    if (includeSfx) {
        sfxInstructions = `
       - For 'sfx' (Sound Effects):
         - 'sfxDescription': A short, descriptive prompt for a sound effect generator.
    `;
    } else {
        sfxInstructions = `
       - **IMPORTANT**: DO NOT generate any items with type 'sfx'. The user has disabled sound effects.
    `;
    }

    let narratorInstructions = "";
    if (includeNarrator) {
        narratorInstructions = `
       - **Narrator**: You MUST include a character named 'Narrator' (or '旁白' if the story is in Chinese) in the cast and script. 
         - Use the Narrator to describe the setting, actions, transitions, and atmosphere that cannot be conveyed by dialogue alone.
         - Ensure the Narrator appears frequently to guide the listener.
    `;
    } else {
        narratorInstructions = `
       - **Narrator**: DO NOT include a Narrator or System character. 
         - The story must be conveyed ENTIRELY through character dialogue${includeSfx ? ' and sound effects' : ''}.
         - Adapt the dialogue so characters describe actions if necessary.
    `;
    }

    const systemPrompt = `You are an expert radio drama scriptwriter and director. 
Convert stories into detailed radio drama scripts with a cast list, a list of scenes (locations), and a sequence of cues.

**LANGUAGE INSTRUCTION**: 
- The 'text' (dialogue) field MUST be in the SAME LANGUAGE as the input story. 
- The 'expression' and 'visualDescription' (for scenes) fields MUST ALWAYS be in ENGLISH.

**INSTRUCTIONS**:
1. **Cast**: Identify all characters. 
   - Assign a voice from the OpenAI voice list: ${OPENAI_VOICES.join(', ')}.
   - Provide a brief 'description' of the character's role.
   - Provide a 'voicePrompt' (ENGLISH): A TTS prompt describing the character's accent, speech style, and tone.
   ${elevenLabsVoices.length > 0 ? `
   - **IMPORTANT**: You have access to the following ElevenLabs voices. Pick the most suitable voice for each character based on the voice characteristics:
${elevenLabsVoices.slice(0, 20).map(v => `     - "${v.name}" (ID: ${v.voice_id})${v.labels ? ` - ${Object.entries(v.labels).map(([k, val]) => `${k}: ${val}`).join(', ')}` : ''}`).join('\n')}
   - Set 'elevenLabsVoiceId' to the voice ID that best matches the character.
   ` : ''}
   ${narratorInstructions}

2. **Scenes**: Identify the key locations/environments in the story.
   - Provide a 'name' (e.g., "Living Room", "Forest at Night").
   - Provide a 'visualDescription' (ENGLISH): Detailed atmospheric description.

3. **Script**: A list of cues.
   - 'location': The name of the scene where this cue takes place (MUST match a name from the Scenes list).
   - For 'speech':
     - 'character': Name from the cast list.
     - 'text': The dialogue (IN THE STORY'S LANGUAGE).
     - 'expression': A direction for HOW it should be spoken (IN ENGLISH).
   ${sfxInstructions}

Return a JSON object with keys "cast", "scenes", and "script".`;

    const userPrompt = `Convert this story into a radio drama script:\n\n"${story}"`;

    console.log("--- [OpenAI] Generate Script Prompt ---");
    console.log(systemPrompt);
    console.log(userPrompt);
    console.log("---------------------------------------");

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`,
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(`OpenAI API Error: ${err.error?.message || response.statusText}`);
        }

        const result = await response.json();
        const jsonText = result.choices?.[0]?.message?.content;
        if (!jsonText) throw new Error("No response content from OpenAI");

        const data = JSON.parse(jsonText) as GeneratedScriptResponse;

        // Process Cast - add default voiceType
        const cast: CastMember[] = (data.cast || []).map(c => ({
            ...c,
            voiceType: 'openai' as const,
        }));

        // Process Scenes
        const scenes: SceneDefinition[] = (data.scenes || []).map(s => ({
            id: crypto.randomUUID(),
            name: s.name,
            visualDescription: s.visualDescription
        }));

        // Process Script Items
        const items = data.script.map((item: any) => ({
            ...item,
            id: crypto.randomUUID(),
        }));

        return { cast, scenes, items };

    } catch (error) {
        console.error("Error generating script with OpenAI:", error);
        throw error;
    }
};

/**
 * Generate speech using OpenAI TTS API
 * @param text - Text to speak
 * @param voiceName - OpenAI voice name (alloy, echo, fable, onyx, nova, shimmer, ash, ballad, coral, sage)
 * @param voicePrompt - Optional voice instruction (used with gpt-4o-mini-tts model)
 * @param apiKey - OpenAI API key
 */
export const generateOpenAISpeech = async (
    text: string,
    voiceName: string = 'alloy',
    voicePrompt: string = '',
    apiKey?: string
): Promise<string> => {
    const key = apiKey || '';
    if (!key) {
        throw new Error("OpenAI API Key is required for TTS.");
    }

    // Validate voice name
    const voice = OPENAI_VOICES.includes(voiceName as OpenAIVoice) ? voiceName : 'alloy';

    // Use gpt-4o-mini-tts for steerable voices when voicePrompt is provided
    const model = voicePrompt ? 'gpt-4o-mini-tts' : 'tts-1';

    console.log("--- [OpenAI] Generate Speech ---");
    console.log(`Model: ${model}`);
    console.log(`Voice: ${voice}`);
    console.log(`Text: ${text}`);
    if (voicePrompt) console.log(`Voice Prompt: ${voicePrompt}`);
    console.log("--------------------------------");

    try {
        const requestBody: any = {
            model,
            voice,
            input: text,
        };

        // Add instructions for gpt-4o-mini-tts model
        if (voicePrompt && model === 'gpt-4o-mini-tts') {
            requestBody.instructions = voicePrompt;
        }

        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(`OpenAI TTS Error: ${err.error?.message || response.statusText}`);
        }

        // Returns audio/mpeg binary
        const arrayBuffer = await response.arrayBuffer();
        return arrayBufferToBase64(arrayBuffer);
    } catch (error) {
        console.error("Error generating speech with OpenAI:", error);
        throw error;
    }
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
