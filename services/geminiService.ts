
import { GoogleGenAI, Type } from "@google/genai";
import { ItemType, ScriptItem, CastMember, SceneDefinition, AspectRatio } from "../types";

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
  apiKey?: string
): Promise<{ cast: CastMember[], scenes: SceneDefinition[], items: ScriptItem[] }> => {
  if (!story.trim()) return { cast: [], scenes: [], items: [] };
  const ai = getAI(apiKey);

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

  const prompt = `
    You are an expert radio drama scriptwriter and director. 
    Convert the following story into a detailed radio drama script with a cast list, a list of scenes (locations), and a sequence of cues.
    
    **LANGUAGE INSTRUCTION**: 
    - The 'text' (dialogue) field MUST be in the SAME LANGUAGE as the input story. 
    - The 'expression', 'visualDescription' (for cast), and 'visualDescription' (for scenes) fields MUST ALWAYS be in ENGLISH.

    **INSTRUCTIONS**:
    1. **Cast**: Identify all characters. 
       - Assign a voice.
       - Provide a 'visualDescription': A concise but evocative physical description.
       ${narratorInstructions}

    2. **Scenes**: Identify the key locations/environments in the story.
       - Provide a 'name' (e.g., "Living Room", "Forest at Night").
       - Provide a 'visualDescription' (ENGLISH): Detailed atmospheric description for an image generator (lighting, colors, mood).

    3. **Script**: A list of cues.
       - 'location': The name of the scene where this cue takes place (MUST match a name from the Scenes list).
       - For 'speech':
         - 'character': Name from the cast list.
         - 'text': The dialogue (IN THE STORY'S LANGUAGE).
         - 'expression': A direction for HOW it should be spoken (IN ENGLISH).
       ${sfxInstructions}

    Return a JSON object with keys "cast", "scenes", and "script".

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
                  visualDescription: { type: Type.STRING, description: "Physical description for AI image generator" }
                },
                required: ["name", "voice", "visualDescription"]
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
                  sfxSearchQuery: { type: Type.STRING },
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
      youtubeDuration: 5,
      youtubeStartTime: 0,
    }));

    return { cast: data.cast, scenes, items };

  } catch (error) {
    console.error("Error generating script:", error);
    throw error;
  }
};

export const generateSpeech = async (text: string, voiceName: string = 'Puck', expression: string = '', apiKey?: string): Promise<string> => {
  const ai = getAI(apiKey);
  const textPrompt = expression ? `Say ${expression}: ${text}` : text;

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

/**
 * Reference image with a label for identification in the prompt
 */
interface ReferenceImage {
  base64: string;
  label: string; // e.g., "CHARACTER_REFERENCE", "SCENE_REFERENCE"
}

/**
 * Base function for generating images with multiple reference support
 */
const generateRawImage = async (
  prompt: string,
  aspectRatio: AspectRatio,
  referenceImages?: ReferenceImage[],
  apiKey?: string
): Promise<string> => {
  const ai = getAI(apiKey);
  console.log("--- [Gemini] Generate Image Prompt ---");
  console.log(prompt);
  if (referenceImages && referenceImages.length > 0) {
    console.log(`[Attached ${referenceImages.length} Reference Image(s): ${referenceImages.map(r => r.label).join(', ')}]`);
  }
  console.log("--------------------------------------");

  try {
    const parts: any[] = [];

    // Add all reference images with concise labels
    if (referenceImages && referenceImages.length > 0) {
      for (const refImg of referenceImages) {
        // Add brief label BEFORE the image
        parts.push({ text: `[${refImg.label}]:` });
        parts.push({
          inlineData: {
            mimeType: 'image/png',
            data: refImg.base64
          }
        });
      }
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
 */
export const generateCharacterSheet = async (description: string, style: string, apiKey?: string): Promise<string> => {
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
  return generateRawImage(prompt, "16:9", undefined, apiKey);
};

/**
 * Character reference with name for identification
 */
export interface CharacterReference {
  name: string;
  base64: string;
}

/**
 * Generates a Scene/Dialogue Image with support for multiple character references and scene reference
 * 
 * STRATEGY:
 * 1. Scene background reference goes FIRST (less important, further from main prompt)
 * 2. Character references go AFTER scene (more important, closer to main prompt)
 * 3. Main prompt comes LAST (most important)
 * 4. Shorter, more direct instructions
 */
export const generateSceneImage = async (
  description: string,
  style: string,
  aspectRatio: AspectRatio,
  characterRefs?: CharacterReference[],
  sceneRefBase64?: string,
  apiKey?: string
): Promise<string> => {

  // Build reference images array - ORDER MATTERS!
  // Scene first (background), then characters (important, close to prompt)
  const refImages: ReferenceImage[] = [];

  // 1. Scene background FIRST (less priority)
  if (sceneRefBase64) {
    refImages.push({
      base64: sceneRefBase64,
      label: "BACKGROUND"
    });
  }

  // 2. Character references AFTER scene (higher priority, closer to prompt)
  if (characterRefs && characterRefs.length > 0) {
    for (const charRef of characterRefs) {
      refImages.push({
        base64: charRef.base64,
        label: charRef.name  // Just the name, cleaner
      });
    }
  }

  // Build a CONCISE and DIRECT prompt
  const charNames = characterRefs?.map(c => c.name).join('、') || '';

  let prompt = `Generate a ${style} illustration.

SCENE: ${description}

OUTPUT REQUIREMENTS:
- No text, speech bubbles, or watermarks
- Cinematic composition with strong lighting
`;

  // Character instructions - VERY direct
  if (characterRefs && characterRefs.length > 0) {
    prompt += `
CHARACTER INSTRUCTIONS (CRITICAL):
The attached images show the character design for: ${charNames}.
You MUST copy the EXACT appearance from these reference images:
- SAME face structure and facial features
- SAME hairstyle and hair color
- SAME clothing and accessories
- SAME body proportions
The characters in your output MUST be visually identical to the reference images.
`;
  }

  // Scene instructions
  if (sceneRefBase64) {
    prompt += `
BACKGROUND: Use the attached background image as reference for the environment.
`;
  }

  return generateRawImage(prompt, aspectRatio, refImages.length > 0 ? refImages : undefined, apiKey);
};
