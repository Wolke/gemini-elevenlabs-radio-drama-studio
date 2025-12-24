
import { GoogleGenAI, Type } from "@google/genai";
import { ItemType, ScriptItem, CastMember, SceneDefinition, ElevenLabsVoice } from "../types";
import {
  getSfxInstructions,
  getNarratorInstructions,
  getLanguageInstructions,
  getScenesInstructions,
  buildCastInstructions,
  buildScriptInstructionsGemini,
  getSystemPromptIntro,
} from "./promptTemplates";

// Helper to get or create Gemini client
// Priority: provided apiKey > environment variable
const getAI = (apiKey?: string): GoogleGenAI => {
  const key = apiKey || process.env.API_KEY || '';
  if (!key) {
    throw new Error("Gemini API Key is required. Please enter it in Settings or set API_KEY environment variable.");
  }
  return new GoogleGenAI({ apiKey: key });
};

interface GeneratedScriptResponse {
  cast: CastMember[];
  scenes: { name: string; visualDescription: string }[];
  script: any[];
}

const ALL_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir",
  "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina",
  "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird",
  "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"
];

export const generateScriptFromStory = async (
  story: string,
  includeSfx: boolean = true,
  includeNarrator: boolean = true,
  elevenLabsVoices: ElevenLabsVoice[] = [],
  apiKey?: string
): Promise<{ cast: CastMember[], scenes: SceneDefinition[], items: ScriptItem[] }> => {
  if (!story.trim()) return { cast: [], scenes: [], items: [] };
  const ai = getAI(apiKey);

  const sfxInstructions = getSfxInstructions(includeSfx);
  const narratorInstructions = getNarratorInstructions(includeNarrator, includeSfx);

  const prompt = `
    ${getSystemPromptIntro()}
    Convert the following story into a detailed radio drama script with a cast list, a list of scenes (locations), and a sequence of cues.
    
    ${getLanguageInstructions()}

    **INSTRUCTIONS**:
    ${buildCastInstructions(ALL_VOICES.join(', '), elevenLabsVoices, narratorInstructions)}

    ${getScenesInstructions()}

    ${buildScriptInstructionsGemini(sfxInstructions)}

    Story:
    "${story}"
  `;

  console.log("--- [Gemini] Generate Script Prompt ---");
  console.log(prompt);
  console.log("---------------------------------------");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            cast: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  voice: { type: Type.STRING, enum: ALL_VOICES },
                  description: { type: Type.STRING },
                  voicePrompt: { type: Type.STRING, description: "TTS accent/style prompt in English" },
                  elevenLabsVoiceId: { type: Type.STRING, description: "ElevenLabs voice ID if available" },
                },
                required: ["name", "voice", "voicePrompt"]
              }
            },
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  visualDescription: { type: Type.STRING, description: "Detailed environment description" }
                },
                required: ["name", "visualDescription"]
              }
            },
            script: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, enum: [ItemType.SPEECH, ItemType.SFX] },
                  location: { type: Type.STRING },
                  character: { type: Type.STRING },
                  text: { type: Type.STRING },
                  expression: { type: Type.STRING },
                  sfxDescription: { type: Type.STRING },
                },
                required: ["type", "location"],
              },
            }
          },
          required: ["cast", "scenes", "script"]
        },
      },
    });

    const jsonText = response.text;
    if (!jsonText) throw new Error("No response text from Gemini");

    const data = JSON.parse(jsonText) as GeneratedScriptResponse;

    // Process Cast - add default voiceType
    const cast: CastMember[] = (data.cast || []).map(c => ({
      ...c,
      voiceType: 'gemini' as const,
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
    console.error("Error generating script:", error);
    throw error;
  }
};

export const generateSpeech = async (
  text: string,
  voiceName: string = 'Puck',
  voicePrompt: string = '',
  expression: string = '',
  apiKey?: string
): Promise<string> => {
  const ai = getAI(apiKey);

  // Build prompt with Director's Notes for accent/style control
  let textPrompt = text;
  if (voicePrompt || expression) {
    const style = [voicePrompt, expression].filter(Boolean).join(', ');
    textPrompt = `### DIRECTOR'S NOTES\nStyle: ${style}\n\n### TRANSCRIPT\n${text}`;
  }

  console.log("--- [Gemini] Generate Speech Prompt ---");
  console.log(`Voice: ${voiceName}`);
  console.log(`Text: ${textPrompt}`);
  console.log("---------------------------------------");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: textPrompt }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("No audio data returned");
    return base64Audio;
  } catch (error) {
    console.error("Error generating speech:", error);
    throw error;
  }
};
