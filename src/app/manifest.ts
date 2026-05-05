import type { MetadataRoute } from "next";
import { conciergeSeo } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Escal8 Concierge - AI Customer Operations",
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
        description: "Open the Escal8 Concierge app login.",
        url: "/",
        icons: [{ src: "/favikon.png", sizes: "512x512", type: "image/png" }],
      },
    ],
  };
}
