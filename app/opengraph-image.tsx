import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

import { siteConfig } from "@/lib/site-config";

export const alt = "Watplux solar power equipment, planning and installation";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const logoData = await readFile(
    join(process.cwd(), "public/web-app-manifest-512x512.png"),
    "base64",
  );
  const logoSource = `data:image/png;base64,${logoData}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        background: "#f7f3e8",
        color: "#1d1a14",
        padding: "72px 80px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 540,
          height: 540,
          right: -120,
          top: -210,
          borderRadius: 999,
          background: "#ffbe00",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 300,
          height: 300,
          right: 90,
          bottom: -190,
          borderRadius: 999,
          border: "2px solid #d2c7af",
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <img
            src={logoSource}
            alt=""
            width="72"
            height="72"
            style={{
              width: 72,
              height: 72,
              borderRadius: 14,
            }}
          />
          <div
            style={{
              display: "flex",
              marginLeft: 22,
              fontSize: 34,
              fontWeight: 800,
              letterSpacing: -1,
            }}
          >
            {siteConfig.name}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              maxWidth: 850,
              fontSize: 70,
              lineHeight: 1.02,
              fontWeight: 900,
              letterSpacing: -3.5,
            }}
          >
            Reliable energy starts with the right system.
          </div>
          <div
            style={{
              display: "flex",
              maxWidth: 760,
              marginTop: 24,
              fontSize: 25,
              lineHeight: 1.4,
              color: "#6f6758",
            }}
          >
            Solar equipment, system planning and professional installation for
            homes and businesses.
          </div>
        </div>
      </div>
    </div>,
    size,
  );
}
