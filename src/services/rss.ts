import RssParser from "rss-parser";
import { supabase } from "../db/supabase.js";
import { log } from "../utils/logger.js";
import type { Channel } from "../types/index.js";

const parser = new RssParser({
  customFields: {
    item: [["yt:videoId", "ytVideoId"]],
  },
});

interface RssVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string | null;
}

/**
 * Poll a single channel's RSS feed for videos.
 */
export async function pollChannel(channel: Channel): Promise<RssVideo[]> {
  const feedUrl =
    channel.rss_feed_url ??
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.youtube_channel_id}`;

  try {
    const feed = await parser.parseURL(feedUrl);
    return (feed.items ?? []).map((item) => ({
      videoId: (item as unknown as { ytVideoId: string }).ytVideoId ?? "",
      title: item.title ?? "Untitled",
      publishedAt: item.pubDate ?? item.isoDate ?? new Date().toISOString(),
      thumbnailUrl: null,
    })).filter((v) => v.videoId);
  } catch (err) {
    log.error("rss", `Failed to poll ${channel.name}`, err);
    return [];
  }
}

/**
 * Poll all active channels and insert new videos.
 * Returns count of new videos found.
 */
export async function pollAllChannels(): Promise<number> {
  const { data: channels, error } = await supabase
    .from("channels")
    .select("*")
    .eq("active", true);

  if (error || !channels?.length) {
    if (error) log.error("rss", "Failed to fetch channels", error);
    return 0;
  }

  let newCount = 0;

  for (const channel of channels as Channel[]) {
    // Get the most recent video we already have for this channel
    const { data: latestKnown } = await supabase
      .from("videos")
      .select("published_at")
      .eq("channel_id", channel.id)
      .order("published_at", { ascending: false })
      .limit(1)
      .single();

    const cutoff = latestKnown?.published_at
      ? new Date(latestKnown.published_at)
      : null;

    const videos = await pollChannel(channel);

    for (const video of videos) {
      // Only consider videos newer than our latest known
      if (cutoff && new Date(video.publishedAt) <= cutoff) continue;

      // Double-check it doesn't already exist
      const { data: existing } = await supabase
        .from("videos")
        .select("id")
        .eq("youtube_video_id", video.videoId)
        .single();

      if (existing) continue;

      const { error: insertErr } = await supabase.from("videos").insert({
        channel_id: channel.id,
        youtube_video_id: video.videoId,
        title: video.title,
        published_at: video.publishedAt,
        thumbnail_url: video.thumbnailUrl,
        processed: false,
        transcript_status: "pending",
      });

      if (!insertErr) {
        newCount++;
        log.info("rss", `New video: "${video.title}" from ${channel.name}`);
      }
    }
  }

  if (newCount > 0) {
    log.info("rss", `Found ${newCount} new video(s)`);
  }

  return newCount;
}
