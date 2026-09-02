import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "天扬课表",
    short_name: "课表",
    description: "无广告、可离线使用的个人课表",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f7fb",
    theme_color: "#175cd3",
    orientation: "portrait",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
  }
}
