interface LLMResponse {
  choices: { message: { content: string } }[];
}

let globalMistralApiKey = '';

export function setMistralApiKey(key: string) {
  globalMistralApiKey = key;
}

export function getMistralApiKey() {
  return globalMistralApiKey;
}

async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  try {
    console.log('--- LLM REQUEST ---');
    console.log('System Prompt:', systemPrompt);
    console.log('User Prompt:', userPrompt);
    console.log('-------------------');

    let response;
    if (globalMistralApiKey) {
      response = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${globalMistralApiKey}`
        },
        body: JSON.stringify({
          model: 'mistral-large-latest',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 1024
        })
      });
    } else {
      response = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt, userPrompt }),
      });
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(data.error || `Server error: ${response.status}`);
    }

    const data: LLMResponse = await response.json();
    return data.choices[0].message.content.trim();
  } catch (err) {
    console.error('LLM Client Error:', err);
    throw err;
  }
}

/**
 * Merge two text segments into one coherent, naturally written thought.
 */
export async function mergeTexts(text1: string, text2: string, language: string): Promise<string> {
  const langName = language === 'fr' ? 'French' : 'English';

  const systemPrompt = `You are a text editing assistant. Your job is to merge two adjacent text segments into one single, coherent sentence. Write in ${langName}. Return ONLY the merged text, nothing else.`;

  const userPrompt = `Combine the ideas from these two segments into a single, cohesive sentence:
Segment 1: "${text1}"
Segment 2: "${text2}"

Return ONLY the merged text, nothing else.`;

  return callLLM(systemPrompt, userPrompt);
}

/**
 * Split a text segment into two logical sentences, using a marker as a guide.
 */
export async function splitText(textWithMarker: string, language: string, originalText?: string): Promise<[string, string]> {
  const langName = language === 'fr' ? 'French' : 'English';

  const systemPrompt = `You are a text editing assistant. Your job is to split a given text into exactly two separate, logical sentences. Write in ${langName}. The user has provided a "[CUT HERE]" marker in the text to indicate roughly where they want the split to occur. Use this marker as a strong guide for finding the logical breaking point. Ensure both resulting sentences are independent and start with a capital letter. Return ONLY the two separated sentences, divided by '|||', nothing else. Do not include the marker in your output.`;

  const userPrompt = `Split this text into exactly two logical sentences, using the [CUT HERE] marker as a guide for roughly where to break the logical thought:
"${textWithMarker}"

Return ONLY the result in the format: "First sentence part.|||Second sentence part."`;

  try {
    const response = await callLLM(systemPrompt, userPrompt);
    const parts = response.split('|||').map(p => p.trim());

    if (parts.length >= 2 && parts[0] && parts[1]) {
      return [parts[0], parts.slice(1).join(' ')]; // Combine any extra parts into the second one just in case
    }
  } catch (err) {
    console.error("LLM Split Failed, falling back", err);
  }

  // Fallback if LLM fails or returns bad format
  const fallbackText = originalText || textWithMarker.replace('[CUT HERE]', '');

  // Try to use the marker index as a fallback split point if available
  let fallbackSplitIdx = fallbackText.length / 2;
  const markerIdx = textWithMarker.indexOf('[CUT HERE]');
  if (markerIdx !== -1) {
    fallbackSplitIdx = markerIdx;
  }

  // Find nearest space to the fallback index
  let bestSpaceIdx = fallbackText.lastIndexOf(' ', fallbackSplitIdx);
  if (bestSpaceIdx === -1) bestSpaceIdx = Math.floor(fallbackText.length / 2);

  return [
    fallbackText.slice(0, bestSpaceIdx).trim(),
    fallbackText.slice(bestSpaceIdx).trim()
  ];
}

/**
 * Rewrite a text segment to fit a target length (density adjustment).
 */
export async function timeStretchText(
  text: string,
  targetChars: number,
  language: string,
  contextBefore = "",
  contextAfter = ""
): Promise<string> {
  const langName = language === 'fr' ? 'French' : 'English';
  const currentChars = text.length;
  const isExpansion = targetChars > currentChars;

  const systemPrompt = `You are a professional editor and rhythmic writer. Your goal is to rewrite a text segment to fit a specific "time slot" (length in characters) while maintaining its core meaning and natural flow in ${langName}.`;

  const userPrompt = `
Current Text: "${text}"
Target length: approximately ${targetChars} characters (Current is ${currentChars}).
Context Before: "${contextBefore}"
Context After: "${contextAfter}"

Instructions:
1. ${isExpansion ? 'EXPAND' : 'COMPRESS'} the text so its spoken duration matches the new target length.
2. Ensure it makes perfect sense and flows naturally with the surrounding context.
3. If expanding: add descriptive adjectives or clarify the thought.
4. If compressing: remove fluff and find more concise synonyms.
5. Return ONLY the rewritten text, no quotes or explanations.
`;

  return callLLM(systemPrompt, userPrompt);
}
