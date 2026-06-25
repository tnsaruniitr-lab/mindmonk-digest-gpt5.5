/**
 * Extract a YouTube video ID from various URL formats.
 */
export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Extract a YouTube channel identifier from URL.
 * Returns { type: 'id', value } for /channel/UC... URLs
 * Returns { type: 'handle', value } for /@handle URLs
 */
export function extractChannelInfo(
  url: string
): { type: "id"; value: string } | { type: "handle"; value: string } | null {
  // /channel/UCxxxxx
  const channelMatch = url.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/);
  if (channelMatch) return { type: "id", value: channelMatch[1] };

  // /@handle
  const handleMatch = url.match(/youtube\.com\/@([a-zA-Z0-9_.-]+)/);
  if (handleMatch) return { type: "handle", value: handleMatch[1] };

  return null;
}

/**
 * Check if a string contains a YouTube URL.
 */
export function isYoutubeUrl(text: string): boolean {
  return /(?:youtube\.com|youtu\.be)/.test(text);
}

/**
 * Determine the type of YouTube URL.
 */
export function getYoutubeUrlType(url: string): "video" | "channel" | "unknown" {
  if (extractVideoId(url)) return "video";
  if (extractChannelInfo(url)) return "channel";
  return "unknown";
}
