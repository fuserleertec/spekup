import { spawn } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "./errors.js";
import { isHeic, mediaDir, sniff } from "./media.js";
import { assertSafePayload, scanBytes } from "./safety.js";

export const VIDEO_MAX_BYTES = 40 * 1024 * 1024;
export const VIDEO_MAX_DURATION_MS = 30_000;
export const VIDEO_MIN_DURATION_MS = 200;
export const VIDEO_CODECS = ["h264", "vp8", "vp9"] as const;
export const AUDIO_CODECS = ["aac", "opus", "vorbis"] as const;

export function videoLimits() {
  return {
    maxBytes: VIDEO_MAX_BYTES,
    maxDurationMs: VIDEO_MAX_DURATION_MS,
    minDurationMs: VIDEO_MIN_DURATION_MS,
    videoCodecs: VIDEO_CODECS,
    audioCodecs: AUDIO_CODECS,
    maxAttempts: Number(process.env.VIDEO_MAX_ATTEMPTS || 3),
    ffmpegTimeoutMs: Number(process.env.FFMPEG_TIMEOUT_MS || 60_000),
    probeTimeoutMs: Number(process.env.FFPROBE_TIMEOUT_MS || 15_000),
  };
}

export function privateKey(id: string) {
  return path.posix.join("private", `${id}.bin`);
}

export function outputKey(id: string) {
  return path.posix.join("ready", `${id}.mp4`);
}

export function posterKey(id: string) {
  return path.posix.join("ready", `${id}.jpg`);
}

export function tempKey(id: string) {
  return path.posix.join("tmp", `${id}.mp4`);
}

export async function ensureMediaDirs() {
  const root = mediaDir();
  await mkdir(path.join(root, "private"), { recursive: true });
  await mkdir(path.join(root, "ready"), { recursive: true });
  await mkdir(path.join(root, "tmp"), { recursive: true });
  return root;
}

export function safeMediaFile(storageKey: string) {
  const root = mediaDir();
  const full = path.resolve(root, storageKey);
  if (!full.startsWith(root + path.sep)) return null;
  return full;
}

function bin(name: "ffmpeg" | "ffprobe") {
  const override = name === "ffmpeg" ? process.env.FFMPEG_BIN : process.env.FFPROBE_BIN;
  if (override && !path.isAbsolute(override)) throw new Error("Media tools must be absolute paths.");
  return override || name;
}

export function runTool(command: string, args: string[], timeoutMs: number) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("The media tool took too long."));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 200_000) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 20_000) stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim().slice(0, 400) || `Media tool exited ${code}`));
    });
  });
}

export function publicError(err: unknown) {
  const text = err instanceof Error ? err.message : "The clip could not be prepared.";
  return text.replace(/\/[\w./-]+/g, "[path]").replace(/\s+/g, " ").trim().slice(0, 240) || "The clip could not be prepared.";
}

export type Probe = {
  container: "mp4" | "webm";
  videoCodec: string;
  audioCodec: string | null;
  durationMs: number;
  width: number;
  height: number;
};

export async function probeFile(file: string): Promise<Probe> {
  const limits = videoLimits();
  const { stdout } = await runTool(bin("ffprobe"), [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    file,
  ], limits.probeTimeoutMs);
  let parsed: { format?: { format_name?: string; duration?: string }; streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }> };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new HttpError(400, "validation", "That video could not be read.", { file: "Try an MP4 or WebM clip." });
  }
  const formatName = parsed.format?.format_name || "";
  const container = formatName.includes("webm") || formatName.includes("matroska") ? "webm" : formatName.includes("mp4") || formatName.includes("mov") ? "mp4" : null;
  if (!container) throw new HttpError(400, "validation", "Use an MP4 or WebM clip.", { file: "Use an MP4 or WebM clip." });
  const videos = (parsed.streams || []).filter((stream) => stream.codec_type === "video");
  const audios = (parsed.streams || []).filter((stream) => stream.codec_type === "audio");
  if (videos.length !== 1) throw new HttpError(400, "validation", "The clip needs exactly one video track.", { file: "Use one video track." });
  const videoCodec = videos[0].codec_name || "";
  if (!VIDEO_CODECS.includes(videoCodec as typeof VIDEO_CODECS[number])) {
    throw new HttpError(400, "validation", "Use H.264, VP8, or VP9 video.", { file: "Unsupported video codec." });
  }
  let audioCodec: string | null = null;
  if (audios.length > 1) throw new HttpError(400, "validation", "Use at most one audio track.", { file: "Too many audio tracks." });
  if (audios.length === 1) {
    audioCodec = audios[0].codec_name || "";
    if (!AUDIO_CODECS.includes(audioCodec as typeof AUDIO_CODECS[number])) {
      throw new HttpError(400, "validation", "Use AAC, Opus, or Vorbis audio, or no audio.", { file: "Unsupported audio codec." });
    }
  }
  const duration = Number(parsed.format?.duration);
  if (!Number.isFinite(duration)) throw new HttpError(400, "validation", "The clip duration could not be measured.", { file: "Duration could not be measured." });
  const durationMs = Math.round(duration * 1000);
  if (durationMs < VIDEO_MIN_DURATION_MS || durationMs > VIDEO_MAX_DURATION_MS) {
    throw new HttpError(400, "validation", `Clips must be between 0.2 and ${VIDEO_MAX_DURATION_MS / 1000} seconds.`, { file: `Keep the clip under ${VIDEO_MAX_DURATION_MS / 1000} seconds.` });
  }
  const width = videos[0].width || 0;
  const height = videos[0].height || 0;
  if (width < 16 || height < 16 || width > 1920 || height > 1920) {
    throw new HttpError(400, "validation", "Video dimensions must be between 16 and 1920 pixels.", { file: "Resize the clip and try again." });
  }
  return { container, videoCodec, audioCodec, durationMs, width, height };
}

export async function writePrivateOriginal(id: string, data: Buffer) {
  assertSafePayload(data);
  await scanBytes(data);
  if (isHeic(data)) {
    throw new HttpError(400, "not_a_clip", "That file is a HEIC photo. Use Photo. Photos can be JPEG, PNG, WebP, GIF, or HEIC, up to 8 MB.", { file: "Choose a photo instead." });
  }
  if (sniff(data) !== "video") {
    throw new HttpError(400, "validation", "Use an MP4, WebM, or MOV clip, up to 40 MB and 30 seconds.", { file: "Choose an MP4, WebM, or MOV." });
  }
  if (data.length > VIDEO_MAX_BYTES) {
    throw new HttpError(413, "too_large", "Clips must be 40 MB or smaller.");
  }
  await ensureMediaDirs();
  const key = privateKey(id);
  const full = safeMediaFile(key);
  if (!full) throw new HttpError(400, "validation", "Couldn't store that clip.");
  await writeFile(full, data, { mode: 0o600 });
  return { key, full };
}

export async function normalizeClip(id: string, data: Buffer) {
  const stored = await writePrivateOriginal(id, data);
  try {
    const probe = await probeFile(stored.full);
    return { ...stored, probe };
  } catch (err) {
    if (!(err instanceof HttpError) || !/H\.264|codec|MP4 or WebM|could not be read|Unsupported/i.test(err.message)) throw err;
    const limits = videoLimits();
    const converted = safeMediaFile(tempKey(`${id}-src`));
    if (!converted) throw err;
    try {
      await runTool(bin("ffmpeg"), [
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", stored.full,
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "28",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "96k",
        "-t", "30",
        "-movflags", "+faststart",
        converted,
      ], limits.ffmpegTimeoutMs);
      const { rename } = await import("node:fs/promises");
      await rename(converted, stored.full);
      const probe = await probeFile(stored.full);
      return { ...stored, probe };
    } catch {
      throw new HttpError(400, "conversion_failed", "This clip could not be converted to H.264. Use an MP4, WebM, or MOV, up to 40 MB and 30 seconds.", { file: "Try an H.264 MP4." });
    }
  }
}

export async function transcodeToReady(id: string, source: string, hasAudio: boolean, opts?: { mute?: boolean; maxSeconds?: number }) {
  const limits = videoLimits();
  const mute = Boolean(opts?.mute);
  const maxSeconds = opts?.maxSeconds ?? 30;
  await ensureMediaDirs();
  const tmp = safeMediaFile(tempKey(id));
  const ready = safeMediaFile(outputKey(id));
  const poster = safeMediaFile(posterKey(id));
  if (!tmp || !ready || !poster) throw new Error("Refusing to write outside media storage.");
  const args = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", source,
    "-map", "0:v:0",
    ...(hasAudio && !mute ? ["-map", "0:a:0", "-c:a", "aac", "-b:a", "96k"] : ["-an"]),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "28",
    "-threads", "1",
    "-vf", "scale=min(720\\,iw):-2",
    "-pix_fmt", "yuv420p",
    "-t", String(maxSeconds),
    "-movflags", "+faststart",
    tmp,
  ];
  await runTool(bin("ffmpeg"), args, limits.ffmpegTimeoutMs);
  await runTool(bin("ffmpeg"), [
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", "0",
    "-i", tmp,
    "-frames:v", "1",
    "-q:v", "3",
    poster,
  ], limits.probeTimeoutMs);
  const checked = await probeFile(tmp);
  if (checked.videoCodec !== "h264" || checked.durationMs > maxSeconds * 1000 + 500) {
    throw new Error("Prepared clip failed the duration or codec check.");
  }
  await rename(tmp, ready);
  return { output: outputKey(id), poster: posterKey(id), durationMs: checked.durationMs, width: checked.width, height: checked.height };
}
