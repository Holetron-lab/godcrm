import { getSearxngFallbackUrl, getSearxngUrl } from '../../../services/agent-tools/web-tools.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function httpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function searchSearxng(query, category) {
  const bases = [...new Set([await getSearxngUrl(), await getSearxngFallbackUrl()].filter(Boolean))];
  for (const base of bases) {
    try {
      const params = new URLSearchParams({ q: query, format: 'json', categories: category });
      const response = await fetchWithTimeout(`${base}/search?${params}`, {
        headers: { Accept: 'application/json' },
      });
      if (response.status !== 200) continue;
      const data = await response.json();
      if (Array.isArray(data?.results) && data.results.length) return data.results;
    } catch {
      continue;
    }
  }
  return [];
}

function accessibleImageResponse(response, ranged = false) {
  if (response.status !== 200 && !(ranged && response.status === 206)) return false;
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!IMAGE_TYPES.has(contentType)) return false;
  const rangeTotal = String(response.headers.get('content-range') || '').match(/\/(\d+)$/)?.[1];
  const contentLength = Number(rangeTotal || response.headers.get('content-length'));
  return !Number.isFinite(contentLength) || contentLength <= MAX_IMAGE_BYTES;
}

async function isAccessibleImage(url) {
  let response;
  try {
    response = await fetchWithTimeout(url, { method: 'HEAD' });
    if (response.status === 405) {
      response = await fetchWithTimeout(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
      try {
        return accessibleImageResponse(response, true);
      } finally {
        await response.body?.cancel?.();
      }
    }
    return accessibleImageResponse(response);
  } catch {
    return false;
  }
}

export function extractRecipeDish(text) {
  const dish = String(text || '').match(/^🍽\s*Блюдо:\s*(.+)$/m)?.[1].trim();
  return dish || null;
}

export async function searchRecipeImage(dishName) {
  const results = await searchSearxng(`!ddi !pin ${dishName} рецепт`, 'images');
  const candidates = [...new Set(results.map((result) => httpUrl(result?.img_src)).filter(Boolean))].slice(0, 5);
  for (const candidate of candidates) {
    if (await isAccessibleImage(candidate)) return candidate;
  }
  return null;
}

export async function searchRecipeVideos(dishName) {
  const results = await searchSearxng(`!yt как приготовить ${dishName}`, 'videos');
  const words = new Set(String(dishName).toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((word) => word.length > 2) || []);
  return results
    .map((result, index) => ({
      title: String(result?.title || 'Видео рецепта'),
      url: httpUrl(result?.url),
      index,
    }))
    .filter((result) => result.url)
    .slice(0, 3)
    .map(({ index, ...result }) => ({
      ...result,
      score: [...words].filter((word) => result.title.toLowerCase().includes(word)).length,
      index,
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ title, url }) => ({ title, url }));
}
