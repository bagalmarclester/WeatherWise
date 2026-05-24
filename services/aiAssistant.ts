import axios from 'axios';
import { getProxyBaseUrl } from '../utils/proxyUrl';

/**
 * Sends base64 audio and navigation metadata to the local proxy server,
 * which forwards the request to Google Gemini to prevent direct connection blocks
 * and native runtime stream issues on restrictive devices.
 */
export async function fetchAiResponse(
  base64Audio: string,
  origin: string,
  destination: string,
  overallRisk: string,
  firstHazardLabel: string | null,
  firstHazardMinutes: number | null
): Promise<string> {
  const proxyUrl = `${getProxyBaseUrl()}/api/ai`;
  console.log(
    `[AI Assistant] Requesting proxy AI assistant at ${proxyUrl} (${Math.round(base64Audio.length / 1024)} KB base64)...`
  );

  try {
    const { data } = await axios.post(proxyUrl, {
      audio: base64Audio,
      origin,
      destination,
      overallRisk,
      firstHazardLabel,
      firstHazardMinutes,
    }, { timeout: 35000 });

    if (!data || !data.response) {
      throw new Error('Received an empty response from the AI assistant.');
    }

    console.log(`[AI Assistant] Response received: "${data.response.substring(0, 100)}..."`);
    return data.response;
  } catch (error: any) {
    console.error('[AI Assistant] Proxy AI error:', error.message);

    if (error.response) {
      const serverMsg = error.response.data?.error || error.response.data;
      if (typeof serverMsg === 'string') {
        if (serverMsg.includes('API_KEY_INVALID') || serverMsg.includes('quota') || serverMsg.includes('429')) {
          throw new Error('Gemini API quota exceeded or key invalid. Check your laptop terminal logs.');
        }
        throw new Error(serverMsg);
      }
    }
    
    throw new Error('Failed to get AI response. Please ensure the proxy server is running.');
  }
}

