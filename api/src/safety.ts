import { connect } from "node:net";
import { HttpError } from "./errors.js";

const RISKY_EXT = /\.(exe|dll|bat|cmd|com|scr|ps1|sh|bash|js|mjs|cjs|html|htm|svg|php|py|rb|pl|jar|apk|dmg|app)$/i;

export function assertSafePayload(data: Buffer, name = "") {
  if (RISKY_EXT.test(name)) {
    throw new HttpError(400, "unsafe_file", "Programs and scripts are not accepted.", { file: "Choose a photo, clip, or document." });
  }
  if (data.length >= 2 && data[0] === 0x4d && data[1] === 0x5a) throw blocked();
  if (data.length >= 4 && data[0] === 0x7f && data[1] === 0x45 && data[2] === 0x4c && data[3] === 0x46) throw blocked();
  if (data.length >= 4 && (data.readUInt32BE(0) === 0xfeedface || data.readUInt32BE(0) === 0xfeedfacf || data.readUInt32BE(0) === 0xcafebabe || data.readUInt32LE(0) === 0xfeedface || data.readUInt32LE(0) === 0xfeedfacf)) throw blocked();
  if (data.length >= 2 && data[0] === 0x23 && data[1] === 0x21) throw blocked();
}

function blocked() {
  return new HttpError(400, "unsafe_file", "Programs and scripts are not accepted.", { file: "Choose a photo, clip, or document." });
}

export function scanLabel() {
  if (!process.env.CLAMAV_HOST) return { performed: false as const, label: "Files are not scanned for malware." };
  return { performed: true as const, label: "New uploads are sent to ClamAV. A clean result is not a guarantee." };
}

export async function scanBytes(data: Buffer) {
  const host = process.env.CLAMAV_HOST;
  if (!host) return;
  const port = Number(process.env.CLAMAV_PORT || 3310);
  const reply = await new Promise<string>((resolve, reject) => {
    const socket = connect({ host, port });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("timeout")); }, 20_000);
    socket.on("error", (err) => { clearTimeout(timer); reject(err); });
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const size = Buffer.alloc(4);
      size.writeUInt32BE(data.length);
      socket.write(size);
      socket.write(data);
      socket.write(Buffer.alloc(4));
    });
    socket.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString("utf8")); });
  }).catch(() => {
    throw new HttpError(503, "scan_unavailable", "Malware scanning is turned on, but the scanner did not answer. The file was not stored.", { file: "Try again when the scanner is up." });
  });
  if (!reply.includes("OK") || reply.includes("FOUND")) {
    throw new HttpError(400, "malware", "The scanner rejected that file. It was not stored.", { file: "Choose a different file." });
  }
}
