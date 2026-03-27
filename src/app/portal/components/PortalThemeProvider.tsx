"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type PortalTheme = "dark" | "light";

type PortalThemeContextValue = {
  theme: PortalTheme;
  setTheme: (theme: PortalTheme) => void;
  toggleTheme: () => void;
};

const PORTAL_THEME_STORAGE_KEY = "escl8-portal-theme";
const PortalThemeContext = createContext<PortalThemeContextValue | undefined>(undefined);

function getInitialTheme(): PortalTheme {
  if (typeof window === "undefined") return "dark";

  const saved = window.localStorage.getItem(PORTAL_THEME_STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function PortalThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<PortalTheme>(() => getInitialTheme());

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("portal-theme-dark", "portal-theme-light");
    root.classList.add(`portal-theme-${theme}`);
    root.dataset.portalTheme = theme;
    window.localStorage.setItem(PORTAL_THEME_STORAGE_KEY, theme);

    return () => {
      root.classList.remove("portal-theme-dark", "portal-theme-light");
      root.removeAttribute("data-portal-theme");
    };
  }, [theme]);

  const value = useMemo<PortalThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    }),
    [theme],
  );

  return <PortalThemeContext.Provider value={value}>{children}</PortalThemeContext.Provider>;
}

export function usePortalTheme() {
  const context = useContext(PortalThemeContext);
  if (!context) {
    throw new Error("usePortalTheme must be used within PortalThemeProvider");
  }
  return context;
}
