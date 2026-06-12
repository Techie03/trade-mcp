import axios from 'axios';

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export async function searchTavily(query: string, maxResults: number = 5): Promise<TavilySearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('Tavily API key is not configured. Please set TAVILY_API_KEY in your environment/.env file.');
  }

  try {
    const response = await axios.post(
      'https://api.tavily.com/search',
      {
        api_key: apiKey,
        query: query,
        search_depth: 'basic',
        max_results: maxResults,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    return response.data.results || [];
  } catch (err: any) {
    const errorMsg = err.response?.data?.detail || err.message;
    throw new Error(`Tavily API search failed: ${errorMsg}`);
  }
}
