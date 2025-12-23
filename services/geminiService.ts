
import { GoogleGenAI, Type } from "@google/genai";
import { ItemType, ScriptItem, CastMember, SceneDefinition } from "../types";

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
    - The 'expression' and 'visualDescription' (for scenes) fields MUST ALWAYS be in ENGLISH.

    **INSTRUCTIONS**:
    1. **Cast**: Identify all characters. 
       - Assign a voice from the Gemini voice list.
       - Provide a brief 'description' of the character's role.
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
                },
                required: ["name", "voice"]
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
      youtubeDuration: 5,
      youtubeStartTime: 0,
    }));

    return { cast, scenes, items };

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
