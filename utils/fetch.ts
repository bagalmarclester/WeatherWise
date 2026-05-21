/**
 * Fetches with a timeout using AbortController.
 * React Native's native fetch does not support a timeout option,
 * so we implement it manually.
 * 
 * @param url - The URL to fetch
 * @param timeoutMs - Timeout in milliseconds (default 15s)
 * @param options - Standard fetch options
 */
export const fetchWithTimeout = async (
  url: string, 
  timeoutMs: number = 15000, 
  options: RequestInit = {}
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};
