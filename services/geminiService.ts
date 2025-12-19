
import { GoogleGenAI, Type } from "@google/genai";
import { ItemType, ScriptItem, CastMember, AspectRatio } from "../types";

// Initialize Gemini Client
// NOTE: In a real app, ensure API_KEY is set in environment
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

interface GeneratedScriptResponse {
  cast: CastMember[];
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

export const generateScriptFromStory = async (story: string, includeSfx: boolean = true): Promise<{ cast: CastMember[], items: ScriptItem[] }> => {
  if (!story.trim()) return { cast: [], items: [] };

  let sfxInstructions = "";
  if (includeSfx) {
    sfxInstructions = `
       - For 'sfx' (Sound Effects):
         - 'sfxDescription': A short, descriptive prompt for a sound effect generator.
         - 'sfxSearchQuery': A keyword string for finding this sound on YouTube.
    `;
  } else {
    sfxInstructions = `
       - **IMPORTANT**: DO NOT generate any items with type 'sfx'. The user has disabled sound effects.
    `;
  }

  const prompt = `
    You are an expert radio drama scriptwriter and director. 
    Convert the following story into a detailed radio drama script with a cast list and a sequence of cues.
    
    **LANGUAGE INSTRUCTION**: 
    - The 'text' (dialogue) field MUST be in the SAME LANGUAGE as the input story. 
    - The 'expression' field MUST ALWAYS be in ENGLISH.
    - The 'visualDescription' for characters MUST be in ENGLISH (detailed physical appearance for image generation).

    1. **Cast**: Identify all characters. 
       - Assign a voice.
       - Provide a 'visualDescription': A concise but evocative physical description (e.g., "A grizzled cyber-noir detective with a neon-lit trench coat").
       
    2. **Script**: A list of cues.
       - For 'speech':
         - 'character': Name from the cast list.
         - 'text': The dialogue (IN THE STORY'S LANGUAGE).
         - 'expression': A direction for HOW it should be spoken (IN ENGLISH).
       ${sfxInstructions}

    Return a JSON object with keys "cast" and "script".

    Story:
    "${story}"
  `;

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
                  visualDescription: { type: Type.STRING, description: "Physical description for AI image generator" }
                },
                required: ["name", "voice", "visualDescription"]
              }
            },
            script: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, enum: [ItemType.SPEECH, ItemType.SFX] },
                  character: { type: Type.STRING },
                  text: { type: Type.STRING },
                  expression: { type: Type.STRING },
                  sfxDescription: { type: Type.STRING },
                  sfxSearchQuery: { type: Type.STRING },
                },
                required: ["type"],
              },
            }
          },
          required: ["cast", "script"]
        },
      },
    });

    const jsonText = response.text;
    if (!jsonText) throw new Error("No response text from Gemini");

    const data = JSON.parse(jsonText) as GeneratedScriptResponse;
    
    const items = data.script.map((item: any) => ({
      ...item,
      id: crypto.randomUUID(),
      youtubeDuration: 5,
      youtubeStartTime: 0,
    }));

    return { cast: data.cast, items };

  } catch (error) {
    console.error("Error generating script:", error);
    throw error;
  }
};

export const generateSpeech = async (text: string, voiceName: string = 'Puck', expression: string = ''): Promise<string> => {
  const textPrompt = expression ? `Say ${expression}: ${text}` : text;
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

/**
 * Base function for generating images
 */
const generateRawImage = async (prompt: string, aspectRatio: AspectRatio, referenceImageBase64?: string): Promise<string> => {
  try {
    const parts: any[] = [];
    
    // If we have a reference image, add it first
    if (referenceImageBase64) {
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: referenceImageBase64
        }
      });
    }

    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: { parts },
      config: {
        imageConfig: {
          aspectRatio: aspectRatio,
          imageSize: "1K"
        }
      }
    });

    let base64Image = "";
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        base64Image = part.inlineData.data;
        break;
      }
    }

    if (!base64Image) throw new Error("No image generated.");
    return base64Image;

  } catch (error) {
    console.error("Error generating image:", error);
    throw error;
  }
};

/**
 * Generates a "Character Sheet" (Front, Side, Full Body)
 * This is always generated in 16:9 to fit all views horizontally, 
 * regardless of the main app aspect ratio setting, usually.
 * But to support the "Mobile" request, we might stick to the requested ratio 
 * or default to 16:9 for sheets as they need horizontal space.
 * Let's force 16:9 for Character Sheets as they are reference materials.
 */
export const generateCharacterSheet = async (description: string, style: string): Promise<string> => {
  const prompt = `
    Character sheet design, ${style} style.
    Character description: ${description}.
    
    REQUIRED FORMAT:
    - Display strictly three views: Front view, Side view, and Full body pose.
    - Neutral background.
    - No text, no labels, no watermark.
    - Clean lines, high detail.
  `;
  // Force 16:9 for character sheets to fit the 3 views comfortably
  return generateRawImage(prompt, "16:9"); 
};

/**
 * Generates a Scene/Dialogue Image
 */
export const generateSceneImage = async (
  description: string, 
  style: string, 
  aspectRatio: AspectRatio, 
  referenceImageBase64?: string
): Promise<string> => {
  let prompt = `
    ${style} style.
    Cinematic scene: ${description}.
    
    REQUIREMENTS:
    - No text, no speech bubbles, no captions.
    - Strong atmosphere and lighting.
    - Focus on the scene composition.
  `;
  
  if (referenceImageBase64) {
    prompt += `
    - IMPORTANT: Use the provided image as the exact character reference. Maintain facial features, hair, and costume details.
    `;
  }

  return generateRawImage(prompt, aspectRatio, referenceImageBase64);
};
