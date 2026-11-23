// The picture that goes with a link to the site, wherever a preview of it is shown: the
// name, and a shelf of books under the lamp. It is drawn once, when the site is built,
// from the colours and the sizes the shelf itself uses.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BOOK_COLORS, darker, lighter } from "@/lib/shelf";

export const alt = "Shelfmark: book spines standing on a wooden shelf under lamplight";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Width and height of each spine, and which cloth it wears. Arranged by eye, like a shelf somebody uses.
const SPINES: [number, number, number][] = [
  [62, 300, 6],
  [84, 330, 4],
  [70, 316, 1],
  [92, 344, 7],
  [58, 292, 3],
  [76, 322, 0],
  [66, 304, 9],
  [88, 338, 2],
  [72, 310, 5],
  [60, 296, 10],
  [80, 326, 8],
];

export default async function Image() {
  const serif = await readFile(join(process.cwd(), "public/fonts/playfair_bold.ttf"));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "#2a1d17", position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, display: "flex", background: "linear-gradient(180deg, rgba(232,186,74,0.22), rgba(232,186,74,0) 70%)" }} />
        <div style={{ position: "absolute", top: 56, left: 72, display: "flex", fontFamily: "Playfair", fontSize: 124, color: "#f6eade", letterSpacing: -3 }}>Shelfmark</div>
        <div style={{ display: "flex", alignItems: "flex-end", paddingLeft: 72, gap: 5 }}>
          {SPINES.map(([width, height, cloth], index) => {
            const base = BOOK_COLORS[cloth];
            return (
              <div
                key={index}
                style={{
                  width,
                  height,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderRadius: "5px 5px 0 0",
                  background: `linear-gradient(90deg, ${darker(base, 0.28)}, ${lighter(base, 0.1)}, ${darker(base, 0.22)})`,
                  // The last book leans on its neighbour, as on the shelf of the site.
                  ...(index === SPINES.length - 1 ? { transform: "rotate(-7deg)", transformOrigin: "0 100%", marginLeft: 36 } : {}),
                }}
              >
                <div style={{ display: "flex", width: "100%", height: 4, marginTop: 18, background: "rgba(248,241,225,0.45)" }} />
                {/* The shelfmark: the paper label at the foot of the spine. */}
                <div style={{ display: "flex", width: width - 14, height: 26, marginBottom: 20, borderRadius: 2, background: "#f1e7d2" }} />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", width: 1200, height: 30, background: "linear-gradient(180deg, #b98862, #9a6a48 42%, #6b4630)" }} />
        <div style={{ display: "flex", width: 1200, height: 34, background: "#201611" }} />
      </div>
    ),
    { ...size, fonts: [{ name: "Playfair", data: serif, weight: 700, style: "normal" }] },
  );
}
