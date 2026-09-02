import type { NextConfig } from "next";

const androidBuild = process.env.TIANYANG_ANDROID_BUILD === "1";

const nextConfig: NextConfig = {
  ...(androidBuild ? { output: "export" as const, trailingSlash: true } : {}),
};

export default nextConfig;
