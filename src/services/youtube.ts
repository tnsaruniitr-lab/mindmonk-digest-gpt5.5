import RssParser from "rss-parser";
import { log } from "../utils/logger.js";

const rssParser = new RssParser();

interface ChannelInfo {
  channelId: string;
  name: string;
  thumbnailUrl: string | null;
}

interface VideoMeta {
  title: string;
  author: string;
  thumbnailUrl: string | null;
}

/**
 * Resolve a YouTube channel from a @handle by fetching the RSS feed via the handle page.
 * Falls back to scraping the channel page for the channel ID.
 */
export async function resolveChannel(url: string): Promise<ChannelInfo | null> {
  try {
    // Direct channel ID URL
    const channelIdMatch = url.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/);
    if (channelIdMatch) {
      const channelId = channelIdMatch[1];
      return await fetchChannelFromRss(channelId);
    }

    // @handle URL — need to resolve to channel ID
    const handleMatch = url.match(/youtube\.com\/@([a-zA-Z0-9_.-]+)/);
    if (handleMatch) {
      const handle = handleMatch[1];
      // Fetch the channel page and extract channel ID from the page source
      const res = await fetch(`https://www.youtube.com/@${handle}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const html = await res.text();
      const cidMatch = html.match(/\"channelId\":\"(UC[a-zA-Z0-9_-]+)\"/);
      if (cidMatch) {
        return await fetchChannelFromRss(cidMatch[1]);
      }
      log.error("youtube", `Could not resolve channel ID for @${handle}`);
      return null;
    }

    // Video URL — resolve channel from oEmbed
    const videoIdMatch = url.match(
      /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
    );
    if (videoIdMatch) {
      const meta = await getVideoMetadata(videoIdMatch[1]);
      if (!meta) return null;
      // We can't easily get channel ID from oEmbed alone, so fetch the video page
      const res = await fetch(`https://www.youtube.com/watch?v=${videoIdMatch[1]}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const html = await res.text();
      const cidMatch = html.match(/\"channelId\":\"(UC[a-zA-Z0-9_-]+)\"/);
      if (cidMatch) {
        return {
          channelId: cidMatch[1],
          name: meta.author,
          thumbnailUrl: meta.thumbnailUrl,
        };
      }
    }

    return null;
  } catch (err) {
    log.error("youtube", "Failed to resolve channel", err);
    return null;
  }
}

async function fetchChannelFromRss(channelId: string): Promise<ChannelInfo | null> {
  try {
    const feed = await rssParser.parseURL(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
    );
    return {
      channelId,
      name: feed.title ?? channelId,
      thumbnailUrl: null,
    };
  } catch {
    return { channelId, name: channelId, thumbnailUrl: null };
  }
}

export interface SearchResult {
  channelId: string;
  name: string;
  handle: string | null;
  subscribers: string | null;
  description: string;
  thumbnailUrl: string | null;
}

/**
 * Search YouTube for channels by name/query. No API key needed.
 * Scrapes the YouTube search results page.
 */
export async function searchChannels(query: string): Promise<SearchResult[]> {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAg%3D%3D&hl=en&gl=US`;
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const html = await res.text();

    // Extract ytInitialData JSON from the page
    const dataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s);
    if (!dataMatch) return [];

    const data = JSON.parse(dataMatch[1]);
    const contents =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents ?? [];

    const results: SearchResult[] = [];

    for (const item of contents) {
      const channel = item?.channelRenderer;
      if (!channel) continue;

      const channelId = channel.channelId;
      const name = channel.title?.simpleText ?? "";

      // Handle can be in subscriberCountText (YouTube puts it there, not in a dedicated field)
      const subText = channel.subscriberCountText?.simpleText ?? "";
      const handle = subText.startsWith("@") ? subText : null;

      // Subscriber count is in videoCountText or its accessibility label
      const videoCountAccessibility = channel.videoCountText?.accessibility?.accessibilityData?.label ?? "";
      const videoCountSimple = channel.videoCountText?.simpleText ?? "";
      // Extract numbers from the accessibility text (works across locales)
      const subsMatch = videoCountAccessibility.match(/([\d.,]+\s*[KMBkmbล้านพัน]*)/i) ??
        videoCountSimple.match(/([\d.,]+\s*[KMBkmbล้านพัน]*\s*(?:subscribers?|sub)?)/i);
      const subscribers = subsMatch ? subsMatch[0].trim() : null;

      const description =
        channel.descriptionSnippet?.runs?.map((r: { text: string }) => r.text).join("") ?? "";
      const thumbnailUrl = channel.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ?? null;

      if (channelId && name) {
        results.push({ channelId, name, handle, subscribers, description, thumbnailUrl });
      }

      if (results.length >= 5) break;
    }

    return results;
  } catch (err) {
    log.error("youtube", "Channel search failed", err);
    return [];
  }
}

/**
 * Get video metadata via YouTube oEmbed (no API key needed).
 */
export async function getVideoMetadata(videoId: string): Promise<VideoMeta | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title: string;
      author_name: string;
      thumbnail_url: string;
    };
    return {
      title: data.title,
      author: data.author_name,
      thumbnailUrl: data.thumbnail_url,
    };
  } catch {
    return null;
  }
}
