"use client";

// The little things that stand between the books, drawn after ui/components/Ornaments.kt
// of the app: the same shapes at the same sizes, as SVG instead of canvas calls. Some of
// them are alive when movement is switched on: the candle flickers, the tea steams,
// leaves stir, the cat breathes, and the clock tells the time.

import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import type { OrnamentKind } from "@/lib/model";
import { ornamentSize } from "@/lib/shelf";
import { useI18n } from "./i18n";

const Terracotta = "#B5623C";
const TerracottaDark = "#8E4A2B";
const Leaf = "#4F8A4B";
const LeafDark = "#37683A";
const Gold = "#D9A93B";
const GoldDark = "#A9781C";
const Cream = "#F1E7D2";
const Metal = "#6F7682";
const MetalDark = "#4A505A";
const Sea = "#3F7FB5";
const Wood = "#7A5230";
const Ginger = "#CB8A4C";
const GingerDark = "#A5672F";
const Ink = "#2B2520";

/** The name of the text that says what an ornament is. */
export function ornamentLabelKey(kind: OrnamentKind | string): string {
  return `ornament_${String(kind).toLowerCase()}`;
}

/** An ellipse given by the box it fills, the way the app's drawing code names it. */
function Oval({ x, y, w, h, fill, ...rest }: { x: number; y: number; w: number; h: number; fill: string } & React.SVGProps<SVGEllipseElement>) {
  return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={fill} {...rest} />;
}

/**
 * Part of the outline of an ellipse. Angles are in degrees, clockwise from three
 * o'clock, and the ellipse is given by the box it fills.
 */
function arc(x: number, y: number, w: number, h: number, start: number, sweep: number): string {
  const point = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    return [x + w / 2 + (w / 2) * Math.cos(radians), y + h / 2 + (h / 2) * Math.sin(radians)];
  };
  const [x1, y1] = point(start);
  const [x2, y2] = point(start + sweep);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${(w / 2).toFixed(2)} ${(h / 2).toFixed(2)} 0 ${Math.abs(sweep) > 180 ? 1 : 0} ${sweep > 0 ? 1 : 0} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function Pot({ w, h, top }: { w: number; h: number; top: number }) {
  return (
    <>
      <path d={`M${w * 0.16} ${top}L${w * 0.84} ${top}L${w * 0.72} ${h}L${w * 0.28} ${h}Z`} fill={Terracotta} />
      <rect x={w * 0.12} y={top - h * 0.04} width={w * 0.76} height={h * 0.07} fill={TerracottaDark} />
    </>
  );
}

function Plant({ w, h }: { w: number; h: number }) {
  const leaves: [number, string][] = [
    [-38, LeafDark],
    [34, LeafDark],
    [-14, Leaf],
    [16, Leaf],
    [0, Leaf],
  ];
  return (
    <>
      {leaves.map(([angle, color], index) => (
        <g key={index} transform={`rotate(${angle} ${w / 2} ${h * 0.66})`}>
          {/* A draught nobody else notices: every leaf moves a little, each in its own time. */}
          <Oval className="leaf" style={{ "--i": index } as React.CSSProperties} x={w * 0.36} y={h * 0.06} w={w * 0.28} h={h * 0.62} fill={color} />
        </g>
      ))}
      <Pot w={w} h={h} top={h * 0.68} />
    </>
  );
}

function Cactus({ w, h }: { w: number; h: number }) {
  const r = w * 0.2;
  return (
    <>
      <rect x={w * 0.34} y={h * 0.08} width={w * 0.32} height={h * 0.62} rx={Math.min(r, w * 0.16)} fill={Leaf} />
      <rect x={w * 0.08} y={h * 0.3} width={w * 0.18} height={h * 0.24} rx={w * 0.09} fill={LeafDark} />
      <rect x={w * 0.16} y={h * 0.46} width={w * 0.22} height={h * 0.08} fill={LeafDark} />
      <rect x={w * 0.74} y={h * 0.2} width={w * 0.18} height={h * 0.26} rx={w * 0.09} fill={LeafDark} />
      <rect x={w * 0.62} y={h * 0.38} width={w * 0.22} height={h * 0.08} fill={LeafDark} />
      <Pot w={w} h={h} top={h * 0.68} />
    </>
  );
}

function Candle({ w, h, id }: { w: number; h: number; id: string }) {
  const flame = h * 0.24;
  return (
    <>
      <defs>
        <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={w / 2} cy={h * 0.12} r={w * 1.5}>
          <stop offset="0" stopColor="#FFC766" stopOpacity="0.33" />
          <stop offset="1" stopColor="#FFC766" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* The light a burning candle throws. A candle that stands still is not lit. */}
      <circle className="flame-glow lit-only" cx={w / 2} cy={h * 0.12} r={w * 1.5} fill={`url(#${id})`} />
      <g className="flame">
        <Oval x={w * 0.28} y={h * 0.24 - flame} w={w * 0.44} h={flame} fill="#F2A33A" />
        <Oval x={w * 0.38} y={h * 0.23 - h * 0.15} w={w * 0.24} h={h * 0.15} fill="#FFE08A" />
      </g>
      <line x1={w / 2} y1={h * 0.2} x2={w / 2} y2={h * 0.3} stroke="#3A2A1A" strokeWidth={w * 0.08} />
      <rect x={w * 0.18} y={h * 0.28} width={w * 0.64} height={h * 0.66} rx={w * 0.1} fill={Cream} />
      <rect x={w * 0.06} y={h * 0.93} width={w * 0.88} height={h * 0.07} fill={GoldDark} />
    </>
  );
}

function Mug({ w, h }: { w: number; h: number }) {
  return (
    <>
      {/* Three wisps that rise, sway and thin out, one after the other. */}
      {[0, 1, 2].map((i) => {
        const x = w * (0.26 + 0.14 * i);
        const y = h * 0.02;
        return (
          <path
            key={i}
            className="wisp lit-only"
            style={{ "--i": i } as React.CSSProperties}
            d={`M${x} ${y}Q${x + w * 0.07} ${y - h * 0.12} ${x} ${y - h * 0.24}`}
            fill="none"
            stroke="#FFFFFF"
            strokeOpacity="0.42"
            strokeWidth={w * 0.045}
            strokeLinecap="round"
          />
        );
      })}
      <path d={arc(w * 0.56, h * 0.24, w * 0.36, h * 0.46, -90, 180)} fill="none" stroke="#9FB8C8" strokeWidth={w * 0.09} />
      <rect x={w * 0.08} y={h * 0.1} width={w * 0.66} height={h * 0.9} rx={w * 0.1} fill="#C9DCE6" />
      <rect x={w * 0.08} y={h * 0.34} width={w * 0.66} height={h * 0.12} fill="#9FB8C8" />
    </>
  );
}

function Vase({ w, h }: { w: number; h: number }) {
  const flowers: [number, string][] = [
    [0.3, "#D95D6A"],
    [0.52, "#E8B84A"],
    [0.72, "#B36AC4"],
  ];
  return (
    <>
      {flowers.map(([x, color], index) => {
        const top = h * (0.06 + 0.07 * (index % 2));
        return (
          <g key={index}>
            <line x1={w * x} y1={top} x2={w * 0.5} y2={h * 0.5} stroke={LeafDark} strokeWidth={w * 0.05} />
            <circle cx={w * x} cy={top} r={w * 0.15} fill={color} />
          </g>
        );
      })}
      <path
        d={
          `M${w * 0.36} ${h * 0.44}L${w * 0.64} ${h * 0.44}` +
          `C${w * 0.64} ${h * 0.58} ${w * 0.96} ${h * 0.62} ${w * 0.86} ${h * 0.84}` +
          `C${w * 0.8} ${h * 0.98} ${w * 0.7} ${h} ${w * 0.5} ${h}` +
          `C${w * 0.3} ${h} ${w * 0.2} ${h * 0.98} ${w * 0.14} ${h * 0.84}` +
          `C${w * 0.04} ${h * 0.62} ${w * 0.36} ${h * 0.58} ${w * 0.36} ${h * 0.44}Z`
        }
        fill={Sea}
      />
      <rect x={w * 0.2} y={h * 0.72} width={w * 0.6} height={h * 0.05} fill="#FFFFFF" fillOpacity="0.35" />
    </>
  );
}

function Lamp({ w, h, id }: { w: number; h: number; id: string }) {
  return (
    <>
      <defs>
        <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={w / 2} cy={h * 0.46} r={w * 0.75}>
          <stop offset="0" stopColor="#FFE9A8" stopOpacity="0.32" />
          <stop offset="1" stopColor="#FFE9A8" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* The light under the shade. It is always on, a lamp that is off is no comfort. */}
      <Oval className="lamp-glow" x={-w * 0.25} y={h * 0.36} w={w * 1.5} h={h * 0.5} fill={`url(#${id})`} />
      <path d={`M${w * 0.26} ${h * 0.04}L${w * 0.74} ${h * 0.04}L${w * 0.96} ${h * 0.42}L${w * 0.04} ${h * 0.42}Z`} fill="#E9C86A" />
      <rect x={w * 0.1} y={h * 0.36} width={w * 0.8} height={h * 0.06} fill="#FFF0B8" />
      <rect x={w * 0.46} y={h * 0.42} width={w * 0.08} height={h * 0.48} fill={MetalDark} />
      <rect x={w * 0.22} y={h * 0.9} width={w * 0.56} height={h * 0.1} rx={w * 0.06} fill={Metal} />
    </>
  );
}

function Globe({ w, h }: { w: number; h: number }) {
  const radius = w * 0.4;
  const cx = w * 0.5;
  const cy = h * 0.38;
  return (
    <>
      <path d={arc(cx - radius * 1.12, cy - radius * 1.12, radius * 2.24, radius * 2.24, 60, 240)} fill="none" stroke={GoldDark} strokeWidth={w * 0.05} />
      <circle cx={cx} cy={cy} r={radius} fill={Sea} />
      <Oval x={w * 0.22} y={h * 0.2} w={w * 0.26} h={h * 0.22} fill={Leaf} />
      <Oval x={w * 0.52} y={h * 0.36} w={w * 0.24} h={h * 0.16} fill={Leaf} />
      <rect x={w * 0.46} y={h * 0.72} width={w * 0.08} height={h * 0.2} fill={GoldDark} />
      <rect x={w * 0.18} y={h * 0.9} width={w * 0.64} height={h * 0.1} rx={w * 0.05} fill={Wood} />
    </>
  );
}

/** The time on the reader's clock, refreshed while a clock is on screen. Null until then. */
function useClock(live: boolean): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    if (!live) {
      setNow(null);
      return;
    }
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(timer);
  }, [live]);
  return now;
}

function Clock({ w, h, live }: { w: number; h: number; live: boolean }) {
  const now = useClock(live);
  const radius = w * 0.44;
  const cx = w * 0.5;
  const cy = h * 0.46;
  // A clock on a shelf should tell the time. Standing still it shows ten past ten, as clocks in shops do.
  const hours = now ? now.getHours() : 10;
  const minutes = now ? now.getMinutes() + now.getSeconds() / 60 : 10;
  const hourAngle = (((hours % 12) + minutes / 60) * 30 * Math.PI) / 180;
  const minuteAngle = (minutes * 6 * Math.PI) / 180;
  const hand = (angle: number, length: number) => [cx + Math.sin(angle) * radius * length, cy - Math.cos(angle) * radius * length];
  const [mx, my] = hand(minuteAngle, 0.58);
  const [hx, hy] = hand(hourAngle, 0.4);
  return (
    <>
      <rect x={w * 0.14} y={h * 0.9} width={w * 0.72} height={h * 0.1} rx={w * 0.04} fill={Wood} />
      <circle cx={cx} cy={cy} r={radius} fill={Wood} />
      <circle cx={cx} cy={cy} r={radius * 0.8} fill={Cream} />
      <line x1={cx} y1={cy} x2={mx} y2={my} stroke={Ink} strokeWidth={w * 0.045} strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={hx} y2={hy} stroke={Ink} strokeWidth={w * 0.06} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={w * 0.04} fill={Ink} />
    </>
  );
}

function Trophy({ w, h }: { w: number; h: number }) {
  return (
    <>
      <path d={arc(w * 0.02, h * 0.08, w * 0.34, h * 0.3, 90, 180)} fill="none" stroke={GoldDark} strokeWidth={w * 0.07} />
      <path d={arc(w * 0.64, h * 0.08, w * 0.34, h * 0.3, -90, 180)} fill="none" stroke={GoldDark} strokeWidth={w * 0.07} />
      <path
        d={
          `M${w * 0.2} ${h * 0.02}L${w * 0.8} ${h * 0.02}` +
          `C${w * 0.8} ${h * 0.4} ${w * 0.66} ${h * 0.52} ${w * 0.5} ${h * 0.54}` +
          `C${w * 0.34} ${h * 0.52} ${w * 0.2} ${h * 0.4} ${w * 0.2} ${h * 0.02}Z`
        }
        fill={Gold}
      />
      <rect x={w * 0.44} y={h * 0.52} width={w * 0.12} height={h * 0.22} fill={GoldDark} />
      <rect x={w * 0.28} y={h * 0.72} width={w * 0.44} height={h * 0.1} rx={w * 0.03} fill={Gold} />
      <rect x={w * 0.18} y={h * 0.82} width={w * 0.64} height={h * 0.18} rx={w * 0.03} fill={Wood} />
    </>
  );
}

function Frame({ w, h }: { w: number; h: number }) {
  return (
    <>
      <rect x={0} y={0} width={w} height={h} rx={w * 0.05} fill={Wood} />
      <rect x={w * 0.12} y={h * 0.1} width={w * 0.76} height={h * 0.8} fill="#BFD9EA" />
      <circle cx={w * 0.68} cy={h * 0.3} r={w * 0.09} fill="#F4D56A" />
      <path
        d={
          `M${w * 0.12} ${h * 0.9}L${w * 0.12} ${h * 0.7}` +
          `C${w * 0.3} ${h * 0.5} ${w * 0.46} ${h * 0.62} ${w * 0.6} ${h * 0.72}` +
          `C${w * 0.72} ${h * 0.62} ${w * 0.8} ${h * 0.66} ${w * 0.88} ${h * 0.74}` +
          `L${w * 0.88} ${h * 0.9}Z`
        }
        fill={Leaf}
      />
    </>
  );
}

function Pumpkin({ w, h }: { w: number; h: number }) {
  return (
    <>
      <rect x={w * 0.45} y={0} width={w * 0.1} height={h * 0.24} rx={w * 0.03} fill={LeafDark} />
      <Oval x={0} y={h * 0.18} w={w * 0.5} h={h * 0.82} fill="#D9772B" />
      <Oval x={w * 0.5} y={h * 0.18} w={w * 0.5} h={h * 0.82} fill="#D9772B" />
      <Oval x={w * 0.22} y={h * 0.14} w={w * 0.56} h={h * 0.86} fill="#EA8C3A" />
    </>
  );
}

function Bookend({ w, h }: { w: number; h: number }) {
  return (
    <>
      <rect x={w * 0.1} y={0} width={w * 0.24} height={h} rx={w * 0.06} fill={Metal} />
      <rect x={w * 0.1} y={h * 0.9} width={w * 0.86} height={h * 0.1} rx={w * 0.04} fill={MetalDark} />
      <path d={`M${w * 0.34} ${h * 0.5}L${w * 0.9} ${h * 0.9}L${w * 0.34} ${h * 0.9}Z`} fill={MetalDark} fillOpacity="0.55" />
    </>
  );
}

/** A cat asleep on the shelf, curled up with its tail around itself. It breathes. */
function Cat({ w, h }: { w: number; h: number }) {
  const bodyTop = h * 0.26;
  return (
    <>
      {/* The body rises and falls from the shelf upwards. */}
      <g className="breath">
        <Oval x={w * 0.2} y={bodyTop} w={w * 0.78} h={h - bodyTop} fill={Ginger} />
        {[0.5, 0.62, 0.74].map((x) => (
          <path key={x} d={arc(w * (x - 0.07), bodyTop + h * 0.04, w * 0.14, h * 0.34, 200, 140)} fill="none" stroke={GingerDark} strokeWidth={w * 0.03} strokeLinecap="round" />
        ))}
      </g>
      {/* The head rests on the front paws. */}
      <path
        d={
          `M${w * 0.07} ${h * 0.5}L${w * 0.1} ${h * 0.22}L${w * 0.21} ${h * 0.4}Z` +
          `M${w * 0.23} ${h * 0.4}L${w * 0.33} ${h * 0.22}L${w * 0.37} ${h * 0.5}Z`
        }
        fill={GingerDark}
      />
      <circle cx={w * 0.22} cy={h * 0.6} r={w * 0.17} fill={Ginger} />
      {/* Eyes closed, content. */}
      <path d={arc(w * 0.11, h * 0.52, w * 0.08, h * 0.1, 20, 140)} fill="none" stroke="#3A2A1A" strokeWidth={w * 0.018} strokeLinecap="round" />
      <path d={arc(w * 0.24, h * 0.52, w * 0.08, h * 0.1, 20, 140)} fill="none" stroke="#3A2A1A" strokeWidth={w * 0.018} strokeLinecap="round" />
      <circle cx={w * 0.215} cy={h * 0.7} r={w * 0.015} fill="#E9A0A0" />
      {/* The tail, laid around the body. */}
      <path d={arc(w * 0.3, h * 0.52, w * 0.66, h * 0.44, 0, 150)} fill="none" stroke={GingerDark} strokeWidth={w * 0.07} strokeLinecap="round" />
    </>
  );
}

/** Three books lying on top of each other, the way they end up when the shelf is full. */
function Bookstack({ w, h }: { w: number; h: number }) {
  const lying: [number, number, number, number, string][] = [
    [0.02, 0.96, 0.68, 0.32, "#6E3B3B"],
    [0.1, 0.82, 0.38, 0.3, "#2F5D62"],
    [0.06, 0.74, 0.12, 0.26, "#C49A3A"],
  ];
  return (
    <>
      {lying.map(([left, width, top, height, cover]) => {
        const x = w * left;
        const y = h * top;
        const bw = w * width;
        const bh = h * height;
        return (
          <g key={cover}>
            <rect x={x} y={y} width={bw} height={bh} rx={w * 0.02} fill={cover} />
            {/* The pages show at the open end, the spine carries two bands. */}
            <rect x={x + bw * 0.93} y={y + bh * 0.16} width={bw * 0.07} height={bh * 0.68} fill={Cream} />
            <rect x={x + bw * 0.08} y={y} width={bw * 0.02} height={bh} fill="#FFFFFF" fillOpacity="0.3" />
            <rect x={x + bw * 0.14} y={y} width={bw * 0.02} height={bh} fill="#FFFFFF" fillOpacity="0.3" />
            <rect x={x} y={y + bh * 0.86} width={bw} height={bh * 0.14} fill="#000000" fillOpacity="0.18" />
          </g>
        );
      })}
    </>
  );
}

interface Props {
  kind: OrnamentKind | string;
  scale?: number;
  /** Whether the reader left "a lively shelf" switched on. The clock only runs then. */
  lively?: boolean;
  /** Leave the name out where the ornament stands next to its name anyway. */
  decorative?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function OrnamentView({ kind, scale = 1, lively = true, decorative = false, className, style }: Props) {
  const { t } = useI18n();
  const id = useId();
  const [w, h] = ornamentSize(kind);
  let drawing: ReactNode;
  switch (kind) {
    case "PLANT":
      drawing = <Plant w={w} h={h} />;
      break;
    case "CACTUS":
      drawing = <Cactus w={w} h={h} />;
      break;
    case "CANDLE":
      drawing = <Candle w={w} h={h} id={id} />;
      break;
    case "MUG":
      drawing = <Mug w={w} h={h} />;
      break;
    case "VASE":
      drawing = <Vase w={w} h={h} />;
      break;
    case "LAMP":
      drawing = <Lamp w={w} h={h} id={id} />;
      break;
    case "GLOBE":
      drawing = <Globe w={w} h={h} />;
      break;
    case "CLOCK":
      drawing = <Clock w={w} h={h} live={lively} />;
      break;
    case "TROPHY":
      drawing = <Trophy w={w} h={h} />;
      break;
    case "FRAME":
      drawing = <Frame w={w} h={h} />;
      break;
    case "PUMPKIN":
      drawing = <Pumpkin w={w} h={h} />;
      break;
    case "BOOKEND":
      drawing = <Bookend w={w} h={h} />;
      break;
    case "CAT":
      drawing = <Cat w={w} h={h} />;
      break;
    case "BOOKSTACK":
      drawing = <Bookstack w={w} h={h} />;
      break;
    default:
      // An ornament a newer app knows and this website does not. It keeps its place.
      drawing = null;
  }
  const label = decorative || drawing === null ? undefined : t(ornamentLabelKey(kind));
  return (
    <svg
      className={`ornament ${className ?? ""}`}
      style={style}
      width={w * scale}
      height={h * scale}
      viewBox={`0 0 ${w} ${h}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-ornament={kind}
    >
      {drawing}
    </svg>
  );
}
