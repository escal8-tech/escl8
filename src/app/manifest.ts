import type { MetadataRoute } from "next";
import { conciergeSeo } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Escalate Tech Concierge - AI Customer Operations",
    short_name: "Concierge",
    description: conciergeSeo.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#070b15",
    theme_color: "#2f7bff",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/favikon.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    shortcuts: [
      {
        name: "Concierge Login",
        short_name: "Login",
        description: "Open the Escalate Tech Concierge app login.",
        url: "/",
        icons: [{ src: "/favikon.png", sizes: "512x512", type: "image/png" }],
      },
      {
        name: "Concierge Pricing",
        short_name: "Pricing",
        description: "View Escalate Tech Concierge pricing.",
        url: "/pricing",
        icons: [{ src: "/favikon.png", sizes: "512x512", type: "image/png" }],
      },
    ],
  };
}
