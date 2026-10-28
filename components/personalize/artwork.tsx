"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { defaultVisual, type SlotConfig } from "@/lib/personalization";
export function Artwork({
  config,
  className = "",
  login = false,
}: {
  config?: SlotConfig;
  className?: string;
  login?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    [index, setIndex] = useState(0),
    [running, setRunning] = useState(false),
    [reduced, setReduced] = useState(false);
  const c = config || { ...defaultVisual, images: [] };
  const count = c.images.length;
  const enabled = running && !reduced && c.animation !== "none";
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReduced(mq.matches);
      setRunning(!document.hidden);
    };
    update();
    mq.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      mq.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  useEffect(() => {
    setIndex(0);
  }, [count, config?.images[0]?.url]);
  useEffect(() => {
    if (!enabled || count < 2 || c.animation !== "crossfade") return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % count),
      c.speed * 1000,
    );
    return () => clearInterval(timer);
  }, [enabled, count, c.speed, c.animation]);
  const current = count ? index % count : 0,
    next = count ? (current + 1) % count : 0;
  useEffect(() => {
    if (enabled && count > 1 && c.animation === "crossfade") {
      const img = new window.Image();
      img.src = c.images[next].url;
    }
  }, [next, enabled, count, c.animation, c.images]);
  useEffect(() => {
    if (!enabled || c.animation !== "parallax") return;
    let frame = 0;
    const el = root.current;
    const move = (e: MouseEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        el?.style.setProperty(
          "--px",
          `${(e.clientX / innerWidth - 0.5) * 30 * c.intensity}px`,
        );
        el?.style.setProperty(
          "--py",
          `${(e.clientY / innerHeight - 0.5) * 30 * c.intensity}px`,
        );
        frame = 0;
      });
    };
    const scroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        const top = el?.getBoundingClientRect().top || 0;
        el?.style.setProperty(
          "--py",
          `${Math.max(-25, Math.min(25, top * 0.04)) * c.intensity}px`,
        );
        frame = 0;
      });
    };
    window.addEventListener("mousemove", move, { passive: true });
    window.addEventListener("scroll", scroll, { passive: true });
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("scroll", scroll);
      cancelAnimationFrame(frame);
      el?.style.setProperty("--px", "0px");
      el?.style.setProperty("--py", "0px");
    };
  }, [enabled, c.animation, c.intensity]);
  if (!count) return null;
  const style = {
    "--duration": c.speed + "s",
    "--power": String(c.intensity),
    "--zoom": String(c.zoom),
    "--drift": `${c.intensity * 8}%`,
    opacity: c.opacity,
  } as CSSProperties;
  return (
    <div
      ref={root}
      aria-hidden="true"
      className={`artwork ${className} ${running ? "" : "paused"} ${reduced ? "reduced" : ""} effect-${c.animation}`}
      style={style}
    >
      <div
        className="art-motion"
        style={{ animationPlayState: enabled ? "running" : "paused" }}
      >
        {[
          ...new Set([
            current,
            ...(c.animation === "crossfade" && !reduced ? [next] : []),
          ]),
        ].map((i) => (
          <img
            key={c.images[i].url}
            alt=""
            loading="lazy"
            decoding="async"
            src={c.images[i].url}
            className={i === current ? "art-current" : "art-next"}
            onError={(e) => {
              e.currentTarget.style.opacity = "0";
            }}
            style={{
              objectPosition: `${c.x}% ${c.y}%`,
              filter: `blur(${Math.max(login ? 2 : 0, c.blur)}px)`,
              transform: `scale(${c.zoom})`,
              animationPlayState: enabled ? "running" : "paused",
            }}
          />
        ))}
      </div>
      {c.animation === "entrance" && !reduced && (
        <div
          className="art-entrance"
          style={{ animationPlayState: enabled ? "running" : "paused" }}
        >
          <img
            alt=""
            loading="lazy"
            src={c.images[current].url}
            style={{
              objectPosition: `${c.x}% ${c.y}%`,
              filter: `blur(${c.blur + 10}px)`,
              transform: `scale(${c.zoom})`,
            }}
          />
        </div>
      )}
      <div
        className="art-overlay"
        style={{
          background: `rgba(0,0,0,${Math.max(login ? 0.6 : 0, c.overlay)})`,
        }}
      />
    </div>
  );
}
