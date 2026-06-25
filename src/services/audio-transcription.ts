import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { config } from "../config.js";
import { log } from "../utils/logger.js";

const execFileAsync = promisify(execFile);
const MAX_YTDLP_DOWNLOAD_MS = 8 * 60 * 1000;
const MAX_FFMPEG_MS = 10 * 60 * 1000;
const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const YTDLP_LATEST_RELEASE_URL = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

interface AudioFile {
  path: string;
  sizeBytes: number;
}

function redactSecrets(text: string): string {
  return text
    .replace(/https?:\/\/[^:@\s]+:[^@\s]+@/g, "http://[redacted]@")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
}

function maxUploadBytes(): number {
  return Math.floor(config.GROQ_MAX_UPLOAD_MB * 1024 * 1024);
}

function mimeTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".mpeg": "audio/mpeg",
    ".mpga": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
  };
  return types[ext] ?? "application/octet-stream";
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureYtDlpBinary(): Promise<string> {
  if (config.YTDLP_BINARY_PATH) return config.YTDLP_BINARY_PATH;

  const assetName = ytDlpAssetName();
  const binaryPath = path.join(tmpdir(), `mindmonk-${assetName}`);
  if (await pathExists(binaryPath)) return binaryPath;

  log.info("transcript", `Downloading yt-dlp runtime binary (${assetName})`);

  const release = await fetch(YTDLP_LATEST_RELEASE_URL, {
    headers: { "User-Agent": "mindmonk-digest" },
  });
  if (!release.ok) {
    throw new Error(`Failed to inspect yt-dlp releases (${release.status})`);
  }

  const releaseJson = (await release.json()) as {
    assets?: Array<{ name: string; browser_download_url: string }>;
  };
  const asset = releaseJson.assets?.find((item) => item.name === assetName);
  if (!asset) throw new Error(`Could not find yt-dlp release asset ${assetName}`);

  const binary = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "mindmonk-digest" },
  });
  if (!binary.ok) throw new Error(`Failed to download yt-dlp (${binary.status})`);

  const bytes = new Uint8Array(await binary.arrayBuffer());
  await writeFile(binaryPath, bytes);
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

function ytDlpAssetName(): string {
  const currentPlatform = platform();
  const currentArch = arch();

  if (currentPlatform === "darwin") return "yt-dlp_macos";
  if (currentPlatform === "win32") {
    return currentArch === "x64" ? "yt-dlp.exe" : "yt-dlp_arm64.exe";
  }
  if (currentPlatform === "linux") {
    if (currentArch === "arm64") return "yt-dlp_linux_aarch64";
    return "yt-dlp_linux";
  }

  return "yt-dlp";
}

async function filesIn(dir: string): Promise<AudioFile[]> {
  const entries = await readdir(dir);
  const files: AudioFile[] = [];

  for (const entry of entries) {
    if (entry.endsWith(".part") || entry.endsWith(".ytdl")) continue;
    const filePath = path.join(dir, entry);
    const info = await stat(filePath);
    if (info.isFile() && info.size > 0) files.push({ path: filePath, sizeBytes: info.size });
  }

  return files.sort((a, b) => b.sizeBytes - a.sizeBytes);
}

async function downloadAudio(videoId: string, workDir: string): Promise<AudioFile> {
  if (!config.YTDLP_PROXY_URL) {
    throw new Error("YTDLP_PROXY_URL is required for audio fallback");
  }

  const binaryPath = await ensureYtDlpBinary();
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const outputTemplate = path.join(workDir, `${videoId}.%(ext)s`);
  const args = [
    url,
    "--no-playlist",
    "--no-progress",
    "--no-warnings",
    "--restrict-filenames",
    "--force-overwrites",
    "--socket-timeout",
    "30",
    "--retries",
    "2",
    "--fragment-retries",
    "2",
    "--proxy",
    config.YTDLP_PROXY_URL,
    "-f",
    "139/worstaudio[ext=m4a]/worstaudio/bestaudio[filesize<24M]/bestaudio[filesize_approx<24M]/bestaudio",
    "-o",
    outputTemplate,
  ];

  try {
    await execFileAsync(binaryPath, args, {
      timeout: MAX_YTDLP_DOWNLOAD_MS,
      maxBuffer: 1024 * 1024 * 4,
    });
  } catch (err) {
    throw new Error(`yt-dlp audio download failed: ${redactSecrets(String(err))}`);
  }

  const files = await filesIn(workDir);
  if (!files.length) throw new Error("yt-dlp completed without producing an audio file");

  log.info(
    "transcript",
    `Downloaded fallback audio for ${videoId} (${Math.round(files[0].sizeBytes / 1024 / 1024)} MB)`
  );
  return files[0];
}

async function splitAudioIfNeeded(audio: AudioFile, workDir: string): Promise<AudioFile[]> {
  const maxBytes = maxUploadBytes();
  if (!ffmpegPath) {
    if (audio.sizeBytes <= maxBytes) return [audio];
    throw new Error(`Audio is above Groq upload limit and ffmpeg is unavailable`);
  }

  const chunkDir = path.join(workDir, "chunks");
  await mkdir(chunkDir, { recursive: true });
  const chunkPattern = path.join(chunkDir, "chunk-%03d.mp3");

  await execFileAsync(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      audio.path,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "32k",
      "-f",
      "segment",
      "-segment_time",
      config.GROQ_AUDIO_CHUNK_SECONDS.toString(),
      "-reset_timestamps",
      "1",
      chunkPattern,
    ],
    { timeout: MAX_FFMPEG_MS, maxBuffer: 1024 * 1024 * 2 }
  );

  const chunks = (await filesIn(chunkDir)).sort((a, b) => a.path.localeCompare(b.path));
  if (!chunks.length) throw new Error("ffmpeg chunking completed without producing chunks");

  const oversized = chunks.find((chunk) => chunk.sizeBytes > maxBytes);
  if (oversized) {
    throw new Error(
      `Audio chunk is ${Math.round(oversized.sizeBytes / 1024 / 1024)} MB, above Groq upload limit`
    );
  }

  log.info(
    "transcript",
    `Split fallback audio into ${chunks.length} chunk(s) for Groq (${config.GROQ_AUDIO_CHUNK_SECONDS}s each)`
  );
  return chunks;
}

function parseRetryDelayMs(response: Response, body: string): number | null {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }

  const text = body.toLowerCase();
  const match = text.match(/try again in\s+(?:(\d+)m)?\s*(?:(\d+)s)?/i);
  if (!match) return null;

  const minutes = Number(match[1] ?? 0);
  const seconds = Number(match[2] ?? 0);
  const delayMs = (minutes * 60 + seconds) * 1000;
  return delayMs > 0 ? delayMs : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function transcribeAudioFile(file: AudioFile, index: number, total: number): Promise<string> {
  if (!config.GROQ_API_KEY) throw new Error("GROQ_API_KEY is required for audio fallback");

  const bytes = await readFile(file.path);
  const makeForm = () => {
    const blob = new Blob([bytes], { type: mimeTypeFor(file.path) });
    const form = new FormData();

    form.append("file", blob, path.basename(file.path));
    form.append("model", config.GROQ_TRANSCRIPTION_MODEL);
    form.append("response_format", "json");
    form.append("temperature", "0");
    form.append("language", "en");
    form.append(
      "prompt",
      "Podcast or YouTube video transcript. Preserve names, financial terms, technical terms, and sentence meaning."
    );

    return form;
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(GROQ_TRANSCRIPTION_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.GROQ_API_KEY}`,
        },
        body: makeForm(),
    });

    if (response.ok) {
      const json = (await response.json()) as { text?: string };
      const text = json.text?.trim() ?? "";
      if (!text) throw new Error("Groq returned an empty transcription");

      log.info("transcript", `Groq transcribed chunk ${index + 1}/${total} (${text.length} chars)`);
      return text;
    }

    const body = await response.text();
    if (response.status === 429 && attempt < 3) {
      const retryDelayMs = parseRetryDelayMs(response, body);
      const cappedDelayMs = Math.min(
        retryDelayMs ?? 60_000,
        config.GROQ_MAX_RATE_LIMIT_WAIT_SECONDS * 1000
      );
      log.warn(
        "transcript",
        `Groq rate limit on chunk ${index + 1}/${total}; retrying in ${Math.round(cappedDelayMs / 1000)}s`
      );
      await delay(cappedDelayMs + 5000);
      continue;
    }

    throw new Error(`Groq transcription failed (${response.status}): ${redactSecrets(body)}`);
  }

  throw new Error("Groq transcription retry loop exhausted");
}

export async function fetchAudioTranscript(videoId: string): Promise<string | null> {
  if (!config.TRANSCRIPT_AUDIO_FALLBACK) return null;
  if (!config.GROQ_API_KEY) {
    log.warn("transcript", "Audio fallback skipped: GROQ_API_KEY is not set");
    return null;
  }
  if (!config.YTDLP_PROXY_URL) {
    log.warn("transcript", "Audio fallback skipped: YTDLP_PROXY_URL is not set");
    return null;
  }

  const workDir = path.join(tmpdir(), `mindmonk-audio-${videoId}-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });

  try {
    const audio = await downloadAudio(videoId, workDir);
    const chunks = await splitAudioIfNeeded(audio, workDir);
    const parts: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      parts.push(await transcribeAudioFile(chunks[i], i, chunks.length));
    }

    const transcript = parts.join("\n\n").replace(/\s+/g, " ").trim();
    if (!transcript) return null;

    log.info("transcript", `Got audio transcript for ${videoId} (${transcript.length} chars)`);
    return transcript;
  } catch (err) {
    log.warn("transcript", `Audio fallback failed for ${videoId}: ${redactSecrets(String(err))}`);
    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
