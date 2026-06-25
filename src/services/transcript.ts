// @ts-ignore - package has broken ESM exports, import the ESM bundle directly
import { fetchTranscript as ytFetch } from "../../node_modules/youtube-transcript/dist/youtube-transcript.esm.js";
import { supabase } from "../db/supabase.js";
import type { Transcript, Video } from "../types/index.js";
import { log } from "../utils/logger.js";
import { fetchAudioTranscript } from "./audio-transcription.js";

interface TranscriptFetchResult {
  text: string;
  provider: string;
  source: Transcript["source"];
  language: string;
  durationSeconds: number | null;
  costUsd: number | null;
}

type VideoForTranscript = Pick<
  Video,
  "id" | "youtube_video_id" | "duration_seconds"
>;

/**
 * Fetch YouTube transcript for a video.
 * Uses youtube-transcript package which handles both manual and auto-generated captions.
 */
export async function fetchTranscript(
  videoId: string,
  durationSeconds?: number | null
): Promise<TranscriptFetchResult | null> {
  try {
    const segments = await ytFetch(videoId, { lang: "en" });

    if (!segments?.length) {
      log.warn("transcript", `No transcript segments for ${videoId}`);
    } else {
      const text = segments
        .map((seg: { text: string }) => seg.text)
        .join(" ")
        .replace(/\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (text) {
        log.info("transcript", `Got transcript for ${videoId} (${text.length} chars, ${segments.length} segments)`);
        return {
          text,
          provider: "youtube",
          source: "captions",
          language: "en",
          durationSeconds: durationSeconds ?? null,
          costUsd: 0,
        };
      }

      log.warn("transcript", `Transcript segments were empty for ${videoId}`);
    }
  } catch (err) {
    log.warn("transcript", `Caption transcript failed for ${videoId}: ${err}`);
  }

  const audioTranscript = await fetchAudioTranscript(videoId, durationSeconds);
  if (!audioTranscript) return null;

  return {
    text: audioTranscript.text,
    provider: audioTranscript.provider,
    source: "audio",
    language: "en",
    durationSeconds: audioTranscript.durationSeconds,
    costUsd: audioTranscript.costUsd,
  };
}

async function updateVideoTranscriptStatus(
  dbVideoId: string,
  status: "available" | "unavailable"
): Promise<void> {
  await supabase
    .from("videos")
    .update({ transcript_status: status })
    .eq("id", dbVideoId);
}

async function loadStoredTranscript(dbVideoId: string): Promise<Transcript | null> {
  const { data, error } = await supabase
    .from("transcripts")
    .select("*")
    .eq("video_id", dbVideoId)
    .eq("language", "en")
    .single();

  if (error || !data) return null;
  return data as Transcript;
}

async function loadLegacyTranscript(dbVideoId: string): Promise<TranscriptFetchResult | null> {
  const { data } = await supabase
    .from("summaries")
    .select("raw_transcript")
    .eq("video_id", dbVideoId)
    .single();

  const text = typeof data?.raw_transcript === "string" ? data.raw_transcript.trim() : "";
  if (!text) return null;

  return {
    text,
    provider: "legacy",
    source: "summary_cache",
    language: "en",
    durationSeconds: null,
    costUsd: 0,
  };
}

async function saveTranscript(
  dbVideoId: string,
  transcript: TranscriptFetchResult
): Promise<Transcript | null> {
  const cleanedText = transcript.text.replace(/\s+/g, " ").trim();
  if (!cleanedText) return null;

  const { data, error } = await supabase
    .from("transcripts")
    .upsert(
      {
        video_id: dbVideoId,
        provider: transcript.provider,
        source: transcript.source,
        language: transcript.language,
        text: cleanedText,
        char_count: cleanedText.length,
        duration_seconds: transcript.durationSeconds,
        cost_usd: transcript.costUsd,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "video_id,language" }
    )
    .select("*")
    .single();

  if (error || !data) {
    log.error("transcript", `Failed to save transcript for DB video ${dbVideoId}`, error);
    return null;
  }

  return data as Transcript;
}

/**
 * Return one canonical transcript row for a video and update DB status.
 */
export async function getOrCreateTranscriptForVideo(
  video: VideoForTranscript
): Promise<Transcript | null> {
  const stored = await loadStoredTranscript(video.id);
  if (stored?.text) {
    await updateVideoTranscriptStatus(video.id, "available");
    log.info("transcript", `Reusing stored transcript for ${video.youtube_video_id} (${stored.char_count} chars)`);
    return stored;
  }

  const legacyTranscript = await loadLegacyTranscript(video.id);
  if (legacyTranscript) {
    const savedLegacy = await saveTranscript(video.id, legacyTranscript);
    if (savedLegacy) {
      await updateVideoTranscriptStatus(video.id, "available");
      log.info("transcript", `Backfilled legacy transcript for ${video.youtube_video_id} (${savedLegacy.char_count} chars)`);
      return savedLegacy;
    }
  }

  const fetched = await fetchTranscript(video.youtube_video_id, video.duration_seconds);
  if (fetched) {
    const saved = await saveTranscript(video.id, fetched);
    if (saved) {
      await updateVideoTranscriptStatus(video.id, "available");
      log.info(
        "transcript",
        `Saved ${saved.source} transcript for ${video.youtube_video_id} (${saved.char_count} chars, provider ${saved.provider})`
      );
      return saved;
    }
  }

  await updateVideoTranscriptStatus(video.id, "unavailable");

  return null;
}
