import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(
  process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? ''
);

export async function fetchAiResponse(
  base64Audio: string,
  origin: string,
  destination: string,
  overallRisk: string,
  firstHazardLabel: string | null,
  firstHazardMinutes: number | null
): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: `You are WeatherWise, a voice driving
      assistant inside a mobile navigation app. Always give
      SHORT answers in plain sentences — no bullet points,
      no markdown, no lists. Maximum 2-3 sentences. The driver
      is behind the wheel so keep it simple and clear.
      
      Current route context:
      - From: ${origin}
      - To: ${destination}
      - Overall risk: ${overallRisk}
      - First hazard: ${firstHazardLabel ?? 'none'} in
        ${firstHazardMinutes ?? 'N/A'} minutes`,
  });

  const audioPart = {
    inlineData: {
      data: base64Audio,
      mimeType: "audio/mp4" // expo-av HIGH_QUALITY preset uses .m4a/.mp4
    }
  };

  const result = await model.generateContent([
    audioPart,
    { text: "Listen to the driver's voice command and reply with driving advice. Keep it short." }
  ]);
  
  return result.response.text();
}
