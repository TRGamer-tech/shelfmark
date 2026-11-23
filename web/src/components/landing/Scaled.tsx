"use client";

// Draws what is inside larger or smaller than life without it noticing: the content is
// laid out at its own measure and then scaled as a picture. A shelf keeps packing its
// books by the pixels the app uses, and still fills a wide page or fits a narrow one.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  /**
   * The least width the content is laid out for. With more room it simply uses the
   * room. With less it is laid out at this width and shrunk to fit, as a picture of
   * itself. Without it the scale comes from the stylesheet (--shelf-scale), which can
   * change it with the width of the window.
   */
  designWidth?: number;
}

export function Scaled({ children, className, designWidth }: Props) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [room, setRoom] = useState<number | null>(null);

  useEffect(() => {
    const frame = outer.current;
    const content = inner.current;
    if (!frame || !content) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === content) setHeight(entry.contentRect.height);
        else setRoom(entry.contentRect.width);
      }
    });
    observer.observe(content);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  if (designWidth) {
    const scale = room === null ? 1 : Math.min(1, room / designWidth);
    const frame: CSSProperties = { height: height === null ? undefined : height * scale };
    const content: CSSProperties = { width: room === null ? "100%" : Math.max(room, designWidth), transform: `scale(${scale})`, transformOrigin: "0 0" };
    return (
      <div ref={outer} className={className} style={frame}>
        <div ref={inner} style={content}>
          {children}
        </div>
      </div>
    );
  }
  return (
    <div ref={outer} className={`scaled ${className ?? ""}`} style={{ height: height === null ? undefined : `calc(${height}px * var(--shelf-scale))` }}>
      <div ref={inner} className="scaled-inner">
        {children}
      </div>
    </div>
  );
}
