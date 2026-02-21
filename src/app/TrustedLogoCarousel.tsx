"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import styles from "./page.module.css";

type LogoSize = "default" | "dialog" | "maxis" | "meta" | "pickters" | "tac";

export type TrustedLogo = {
  name: string;
  src: string;
  width: number;
  height: number;
  size?: LogoSize;
};

type TrustedLogoCarouselProps = {
  logos: TrustedLogo[];
};

export default function TrustedLogoCarousel({ logos }: TrustedLogoCarouselProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const setRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const track = trackRef.current;
    const firstSet = setRef.current;
    if (!track || !firstSet) return;

    let frameId = 0;
    let lastTs = performance.now();
    let offset = 0;
    let setWidth = firstSet.getBoundingClientRect().width;
    const speed = 48;

    const updateWidth = () => {
      setWidth = firstSet.getBoundingClientRect().width;
      if (setWidth > 0) {
        offset = -(((-offset % setWidth) + setWidth) % setWidth);
      }
    };

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(firstSet);
    updateWidth();

    const tick = (ts: number) => {
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;

      if (setWidth > 0) {
        offset -= speed * dt;
        if (-offset >= setWidth) {
          offset += setWidth;
        }
        track.style.transform = `translate3d(${offset}px, 0, 0)`;
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, []);

  const logoClass = (size: LogoSize = "default") => {
    if (size === "dialog") return styles.logoImageDialog;
    if (size === "maxis") return styles.logoImageMaxis;
    if (size === "meta") return styles.logoImageMeta;
    if (size === "pickters") return styles.logoImagePickters;
    if (size === "tac") return styles.logoImageTac;
    return "";
  };

  const logoItemClass = (size: LogoSize = "default") => {
    if (size === "dialog") return styles.logoItemDialog;
    if (size === "maxis") return styles.logoItemMaxis;
    if (size === "meta") return styles.logoItemMeta;
    if (size === "pickters") return styles.logoItemPickters;
    if (size === "tac") return styles.logoItemTac;
    return "";
  };

  return (
    <div className={styles.logoCarousel} aria-label="Trusted by companies">
      <div ref={trackRef} className={styles.logoTrack}>
        <ul ref={setRef} className={styles.logoList}>
          {logos.map((logo) => (
            <li key={`logo-a-${logo.name}`} className={`${styles.logoItem} ${logoItemClass(logo.size)}`}>
              <Image
                src={logo.src}
                alt={logo.name}
                width={logo.width}
                height={logo.height}
                className={`${styles.logoImage} ${logoClass(logo.size)}`}
              />
            </li>
          ))}
        </ul>
        <ul className={styles.logoList} aria-hidden>
          {logos.map((logo) => (
            <li key={`logo-b-${logo.name}`} className={`${styles.logoItem} ${logoItemClass(logo.size)}`}>
              <Image
                src={logo.src}
                alt=""
                width={logo.width}
                height={logo.height}
                className={`${styles.logoImage} ${logoClass(logo.size)}`}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
