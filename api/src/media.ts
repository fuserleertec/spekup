import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const Busboy = require("busboy") as typeof import("busboy");
import { HttpError } from "./errors.js";
import { assertSafePayload, scanBytes } from "./safety.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function mediaDir() {
  return path.resolve(process.env.MEDIA_DIR || "/data/media");
}

type Kind = "jpeg" | "png" | "webp" | "gif" | "video" | null;

const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "mif1", "mif2", "msf1"]);

export function ftypBrand(buf: Buffer) {
  if (buf.length < 12 || buf.subarray(4, 8).toString("ascii") !== "ftyp") return null;
  return buf.subarray(8, 12).toString("ascii").toLowerCase();
}

export function isHeic(buf: Buffer) {
  const brand = ftypBrand(buf);
  return brand != null && HEIC_BRANDS.has(brand);
}

export function sniff(buf: Buffer): Kind {
  if (isHeic(buf)) return null;
  if (buf.length >= 12 && buf.subarray(4, 8).toString("ascii") === "ftyp") return "video";
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buf.length >= 6) {
    const head = buf.subarray(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "gif";
  }
  return null;
}

export async function readUpload(request: Request, maxBytes = MAX_IMAGE_BYTES, tooLarge = "Images must be 8 MB or smaller.") {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes + 65_536) {
    throw new HttpError(413, "too_large", tooLarge);
  }
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new HttpError(400, "validation", "Upload the image as a file.", { file: "Choose an image file." });
  }
  const body = request.body;
  if (!body) throw new HttpError(400, "validation", "Choose an image file.", { file: "Choose an image file." });
  const { Readable } = await import("node:stream");
  const nodeStream = Readable.fromWeb(body as import("stream/web").ReadableStream);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return await new Promise<Buffer>((resolve, reject) => {
    const bb = Busboy({ headers, limits: { files: 1, fileSize: maxBytes, fields: 5, parts: 6 } });
    const chunks: Buffer[] = [];
    let sawFile = false;
    let tooBig = false;
    bb.on("file", (_name, file) => {
      sawFile = true;
      file.on("data", (d: Buffer) => chunks.push(d));
      file.on("limit", () => {
        tooBig = true;
      });
    });
    bb.on("error", reject);
    bb.on("finish", () => {
      if (tooBig) reject(new HttpError(413, "too_large", tooLarge));
      else if (!sawFile) reject(new HttpError(400, "validation", "Choose an image file.", { file: "Choose an image file." }));
      else resolve(Buffer.concat(chunks));
    });
    nodeStream.on("error", reject);
    nodeStream.pipe(bb);
  });
}

function runConverter(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: "ignore" });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("timeout")); }, 20_000);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(command)); });
  });
}

async function heicToJpeg(input: Buffer) {
  const dir = await mkdtemp(path.join(tmpdir(), "spekup-heic-"));
  const source = path.join(dir, "in.heic");
  const out = path.join(dir, "out.jpg");
  try {
    await writeFile(source, input);
    try {
      await runConverter("heif-convert", [source, out]);
    } catch {
      await runConverter("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", source, "-frames:v", "1", out]);
    }
    return await readFile(out);
  } catch {
    throw new HttpError(400, "heic_unsupported", "This HEIC photo could not be converted. Export a JPEG, PNG, WebP, or GIF, up to 8 MB.", { file: "Export a JPEG and try again." });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function reencode(input: Buffer) {
  assertSafePayload(input);
  await scanBytes(input);
  const kind = sniff(input);
  if (kind === "jpeg" && (input.length < 4 || input[input.length - 2] !== 0xff || input[input.length - 1] !== 0xd9)) {
    throw new HttpError(400, "corrupt_image", "That JPEG is truncated or corrupt. Export it again. Photos can be up to 8 MB.", { file: "Choose a complete photo." });
  }
  if (kind === "video") {
    throw new HttpError(400, "not_a_photo", "That file is a video. Use Clip for MP4, WebM, or MOV, up to 40 MB and 30 seconds. Photos can be JPEG, PNG, WebP, GIF, or HEIC, up to 8 MB.", { file: "Use Clip for a video." });
  }
  const prepared = isHeic(input) ? await heicToJpeg(input) : input;
  const preparedKind = sniff(prepared);
  if (preparedKind !== "jpeg" && preparedKind !== "png" && preparedKind !== "webp" && preparedKind !== "gif") {
    throw new HttpError(400, "validation", "That file isn't a supported image. JPEG, PNG, WebP, GIF, and HEIC stills are accepted, up to 8 MB.", { file: "Unsupported file." });
  }
  try {
    const { data, info } = await sharp(prepared, {
      failOn: "error",
      limitInputPixels: 20_000_000,
      animated: false,
      pages: 1,
    })
      .rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: false })
      .toBuffer({ resolveWithObject: true });
    if (!info.width || !info.height || data.length < 100) {
      throw new HttpError(400, "validation", "Couldn't read that image.", { file: "Try a different photo." });
    }
    return { data, width: info.width, height: info.height };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "validation", "Couldn't read that image.", { file: "Try a different photo." });
  }
}

export async function writeMediaFile(id: string, data: Buffer) {
  const dir = mediaDir();
  await mkdir(dir, { recursive: true });
  const storageKey = `${id}.jpg`;
  const full = path.resolve(dir, storageKey);
  if (!full.startsWith(dir + path.sep)) throw new HttpError(400, "validation", "Couldn't store that image.");
  await writeFile(full, data, { mode: 0o640 });
  return { storageKey, full };
}

export function mediaPath(storageKey: string) {
  const dir = mediaDir();
  const full = path.resolve(dir, storageKey);
  if (!full.startsWith(dir + path.sep)) return null;
  return full;
}

export function openMedia(storageKey: string) {
  const full = mediaPath(storageKey);
  if (!full) return null;
  return createReadStream(full);
}

export async function removeMediaFile(storageKey: string) {
  const full = mediaPath(storageKey);
  if (!full) return;
  await unlink(full).catch(() => undefined);
}
