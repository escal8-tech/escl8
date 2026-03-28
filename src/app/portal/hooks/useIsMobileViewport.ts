"use client";

import { useEffect, useState } from "react";

export function useIsMobileViewport(maxWidth = 768) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth <= maxWidth;
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const query = `(max-width: ${maxWidth}px)`;
    const media = window.matchMedia(query);
    const handleChange = () => setIsMobile(media.matches);

    handleChange();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, [maxWidth]);

  return isMobile;
}
