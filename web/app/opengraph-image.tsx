import { readFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Spekup — neighbors in civic life. Not a government agency.";

const logo = readFileSync(path.join(process.cwd(), "public/icon-512.png")).toString("base64");

export default function OG() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#F7F5EF,#E8EFE7)", color: "#17372D" }}>
        <img src={`data:image/png;base64,${logo}`} width={160} height={160} alt="" />
        <div style={{ fontSize: 72, letterSpacing: 0, fontWeight: 700, marginTop: 24 }}>Spekup</div>
        <div style={{ fontSize: 28, color: "#8a7440", letterSpacing: 4, marginTop: 8 }}>NEIGHBORS · CIVIC LIFE</div>
        <div style={{ fontSize: 22, marginTop: 16 }}>Not a government agency</div>
      </div>
    ),
    size,
  );
}
