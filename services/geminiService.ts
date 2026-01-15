import { GoogleGenAI, Type } from "@google/genai";

const SYSTEM_INSTRUCTION = `You are a professional technical translator specializing in Japanese software design documents (Excel). 
Your task is to translate an array of text snippets from Japanese to English.
1. Maintain the technical context (e.g., specific IT terminology).
2. Keep the translation concise to fit within similar cell constraints where possible.
3. Return a JSON array where each item contains the original ID and the translated text.
4. If a string is already English or a symbol/number that needs no translation, return it as is.
`;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const translateBatch = async (texts: string[]): Promise<string[]> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Please ensure process.env.API_KEY is available.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Map input to objects with IDs to ensure we can map back correctly
  const itemsToTranslate = texts.map((text, index) => ({
    id: String(index),
    text: text
  }));

  const promptData = JSON.stringify(itemsToTranslate);

  let attempt = 0;
  const maxRetries = 5; // Increased to 5 to handle transient rate limits better
  const baseDelay = 5000; // Increased base delay to 5s to back off more aggressively

  while (attempt <= maxRetries) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: `Translate the 'text' field in the following items to English:\n${promptData}`,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: "The original index/id provided in input" },
                translatedText: { type: Type.STRING, description: "The English translation" },
              },
              required: ["id", "translatedText"],
            },
          }
        }
      });

      const jsonText = response.text;
      if (!jsonText) throw new Error("Empty response from Gemini");

      let parsed: Array<{ id: string; translatedText: string }>;
      try {
        parsed = JSON.parse(jsonText);
        if (!Array.isArray(parsed)) {
          throw new Error("Response is not an array");
        }
      } catch (e) {
        console.error("Failed to parse Gemini JSON response", jsonText);
        // JSON parsing error is likely a model glitch, not a network/quota error.
        return texts; 
      }

      // Map back to array based on IDs
      const translationMap = new Map<string, string>();
      parsed.forEach(item => {
        if (item && item.id !== undefined) {
          translationMap.set(item.id, item.translatedText);
        }
      });

      return texts.map((_, index) => {
        return translationMap.get(String(index)) || texts[index]; // Fallback to original if missing
      });

    } catch (error: any) {
      // Analyze error details
      const errBody = error?.response?.data || error;
      const code = errBody?.error?.code || errBody?.code || errBody?.status;
      const msg = JSON.stringify(errBody);

      // Check specifically for Hard Quota Limit (Daily limit)
      // "RESOURCE_EXHAUSTED" means the daily quota is gone. Retrying won't help.
      const isQuotaExhausted = 
        msg.includes('RESOURCE_EXHAUSTED') || 
        code === 'RESOURCE_EXHAUSTED';

      if (isQuotaExhausted) {
        console.error("Gemini Quota Exhausted (Non-retryable):", error);
        throw new Error("API Daily Quota Exceeded. Please try again tomorrow.");
      }

      // Check for Rate Limit (Transient 429) or Service Overload
      const isRateLimit = msg.includes('429') || code === 429;
      const isOverloaded = code === 503;

      if ((isRateLimit || isOverloaded) && attempt < maxRetries) {
        // Exponential backoff + jitter
        // attempt 0: ~5s
        // attempt 1: ~10s
        // attempt 2: ~20s ...
        const jitter = Math.random() * 1000;
        const waitTime = baseDelay * Math.pow(2, attempt) + jitter;
        
        console.warn(`Gemini API Rate Limit hit. Retrying in ${Math.round(waitTime)}ms (Attempt ${attempt + 1}/${maxRetries})...`);
        
        await delay(waitTime);
        attempt++;
        continue;
      }

      // Final error throwing
      console.error("Gemini Translation Error (Final):", error);
      
      if (isRateLimit) {
         throw new Error("API Rate Limit Exceeded. Please try again later.");
      }
      
      throw error;
    }
  }

  return texts;
};