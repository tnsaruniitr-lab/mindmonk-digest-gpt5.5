// @ts-ignore - package has broken ESM exports, import the ESM bundle directly
import { fetchTranscript as ytFetch } from "../../node_modules/youtube-transcript/dist/youtube-transcript.esm.js";
import { supabase } from "../db/supabase.js";
import { log } from "../utils/logger.js";

/**
 * Fetch YouTube transcript for a video.
 * Uses youtube-transcript package which handles both manual and auto-generated captions.
 */
export async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    const segments = await ytFetch(videoId, { lang: "en" });

    if (!segments?.length) {
      log.warn("transcript", `No transcript segments for ${videoId}`);
      return null;
    }

    const text = segments
      .map((seg: { text: string }) => seg.text)
      .join(" ")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) return null;

    log.info("transcript", `Got transcript for ${videoId} (${text.length} chars, ${segments.length} segments)`);
    return text;
  } catch (err) {
    log.warn("transcript", `No transcript for ${videoId}: ${err}`);
    return null;
  }
}

/**
 * Fetch transcript for a video and update DB status.
 */
export async function getTranscriptForVideo(
  videoId: string,
  dbVideoId: string
): Promise<string | null> {
  const transcript = await fetchTranscript(videoId);

  if (transcript) {
    await supabase
      .from("videos")
      .update({ transcript_status: "available" })
      .eq("id", dbVideoId);
    return transcript;
  }

  await supabase
    .from("videos")
    .update({ transcript_status: "unavailable" })
    .eq("id", dbVideoId);

  return null;
}
