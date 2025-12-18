import { GoogleGenAI, Type } from "@google/genai";
import { ItemType, ScriptItem, CastMember } from "../types";

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
         - 'sfxDescription': A short, descriptive prompt for a sound effect generator (e.g. "footsteps on gravel", "laser blast", "wind howling").
         - 'sfxSearchQuery': A keyword string for finding this sound on YouTube.
    `;
  } else {
    sfxInstructions = `
       - **IMPORTANT**: DO NOT generate any items with type 'sfx'. The user has disabled sound effects.
       - Instead, use the Narrator character to describe the scene or action if necessary.
       - Ensure the script relies entirely on dialogue and narration.
    `;
  }

  const prompt = `
    You are an expert radio drama scriptwriter and director. 
    Convert the following story into a detailed radio drama script with a cast list and a sequence of cues.
    
    **LANGUAGE INSTRUCTION**: 
    - The 'text' (dialogue) field MUST be in the SAME LANGUAGE as the input story. 
    - If the story is in Traditional Chinese, the dialogue and character names must be in Traditional Chinese.
    - If the story is in English, the dialogue must be in English.
    
    1. **Cast**: Identify all characters. Assign one of the following voices to each character based on their personality and the voice description:
       - 'Zephyr' (Bright)
       - 'Puck' (Upbeat)
       - 'Charon' (Informative)
       - 'Kore' (Firm)
       - 'Fenrir' (Excitable)
       - 'Leda' (Youthful)
       - 'Orus' (Firm)
       - 'Aoede' (Breezy)
       - 'Callirrhoe' (Easy-going)
       - 'Autonoe' (Bright)
       - 'Enceladus' (Breathy)
       - 'Iapetus' (Clear)
       - 'Umbriel' (Easy-going)
       - 'Algieba' (Smooth)
       - 'Despina' (Smooth)
       - 'Erinome' (Clear)
       - 'Algenib' (Gravelly)
       - 'Rasalgethi' (Informative)
       - 'Laomedeia' (Upbeat)
       - 'Achernar' (Soft)
       - 'Alnilam' (Firm)
       - 'Schedar' (Even)
       - 'Gacrux' (Mature)
       - 'Pulcherrima' (Forward)
       - 'Achird' (Friendly)
       - 'Zubenelgenubi' (Casual)
       - 'Vindemiatrix' (Gentle)
       - 'Sadachbia' (Lively)
       - 'Sadaltager' (Knowledgeable)
       - 'Sulafat' (Warm)
       
    2. **Script**: A list of cues.
       - For 'speech':
         - 'character': Name from the cast list.
         - 'text': The dialogue (IN THE STORY'S LANGUAGE).
         - 'expression': A direction for HOW it should be spoken. Be specific and varied (e.g., "whispering", "shouting angrily", "laughing", "sobbing", "sarcastic", "robotic", "gaspless", "terrified", "warmly", "coldly"). USE A WIDE VARIETY of at least 30 different emotional styles throughout the script if appropriate.
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
                  description: { type: Type.STRING }
                },
                required: ["name", "voice"]
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
  // Returns Base64 string of PCM audio
  // We use the "Say [expression]: [text]" prompting technique for Gemini TTS to control style.
  
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
    if (!base64Audio) {
      throw new Error("No audio data returned");
    }
    return base64Audio;
  } catch (error) {
    console.error("Error generating speech:", error);
    throw error;
  }
};