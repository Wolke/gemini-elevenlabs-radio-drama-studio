
// Service for interacting with OpenAI API

import { ItemType, ScriptItem, CastMember, SceneDefinition, ElevenLabsVoice, GeneratedPodcastInfo } from '../types';
import {
    getSfxInstructions,
    getNarratorInstructions,
    getLanguageInstructions,
    getScenesInstructions,
    buildCastInstructions,
    buildScriptInstructionsOpenAI,
    getSystemPromptIntro,
    getPodcastMetadataInstructions,
} from './promptTemplates';

// OpenAI TTS available voices
export const OPENAI_VOICES = [
    'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'
] as const;

export type OpenAIVoice = typeof OPENAI_VOICES[number];

interface GeneratedScriptResponse {
    cast: CastMember[];
    scenes: { name: string; visualDescription: string }[];
    script: any[];
    podcastInfo?: {
        podcastName: string;
        author: string;
        episodeTitle: string;
        description: string;
        coverPrompt: string;
        tags?: string[];
    };
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
): Promise<{ cast: CastMember[], scenes: SceneDefinition[], items: ScriptItem[], podcastInfo: GeneratedPodcastInfo | null }> => {
    if (!story.trim()) return { cast: [], scenes: [], items: [], podcastInfo: null };

    const key = apiKey || '';
    if (!key) {
        throw new Error("OpenAI API Key is required. Please enter it in Settings.");
    }

    const sfxInstructions = getSfxInstructions(includeSfx);
    const narratorInstructions = getNarratorInstructions(includeNarrator, includeSfx);

    const systemPrompt = `${getSystemPromptIntro()}

${getLanguageInstructions()}

**INSTRUCTIONS**:
${buildCastInstructions(OPENAI_VOICES.join(', '), elevenLabsVoices, narratorInstructions)}

${getScenesInstructions()}

${buildScriptInstructionsOpenAI(sfxInstructions)}

${getPodcastMetadataInstructions()}`;

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

        // Process Podcast Info
        const podcastInfo: GeneratedPodcastInfo | null = data.podcastInfo ? {
            podcastName: data.podcastInfo.podcastName,
            author: data.podcastInfo.author,
            episodeTitle: data.podcastInfo.episodeTitle,
            description: data.podcastInfo.description,
            coverPrompt: data.podcastInfo.coverPrompt,
            tags: data.podcastInfo.tags,
        } : null;

        return { cast, scenes, items, podcastInfo };

    } catch (error) {
        console.error("Error generating script with OpenAI:", error);
        throw error;
    }
};

/**
 * Generate cover art using OpenAI DALL-E 3
 * @param prompt - Description of the desired cover art
 * @param apiKey - OpenAI API key
 * @returns base64 encoded image data
 */
export const generateOpenAICoverArt = async (
    prompt: string,
    apiKey: string
): Promise<string> => {
    console.log("--- [OpenAI] Generate Cover Art ---");
    console.log(`Prompt: ${prompt}`);
    console.log("-----------------------------------");

    const enhancedPrompt = `Create a professional podcast cover art image (square format, suitable for podcast platforms like Spotify, Apple Podcasts, YouTube Music).

Style requirements:
- Modern, clean design with bold visual impact
- Professional radio drama / audio storytelling aesthetic
- High contrast, eye-catching colors
- Suitable for small thumbnail display

Context: ${prompt}`;

    try {
        const response = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'dall-e-3',
                prompt: enhancedPrompt,
                n: 1,
                size: '1024x1024',
                quality: 'standard',
                response_format: 'b64_json',
            }),
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(`OpenAI DALL-E Error: ${err.error?.message || response.statusText}`);
        }

        const result = await response.json();
        const base64Image = result.data?.[0]?.b64_json;
        if (!base64Image) throw new Error("No image data returned from DALL-E");

        return base64Image;
    } catch (error) {
        console.error("Error generating cover art with OpenAI:", error);
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
