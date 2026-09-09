import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) for a slim Docker
  // image — that is what frontend/Dockerfile.prod copies out.
  //
  // Not on Vercel, though. Vercel runs its own `onBuildComplete` step that
  // reads `.next/next-server.js.nft.json`, and as of next 16.3.x a standalone
  // build no longer writes that file, so the deploy dies with:
  //   Error: ENOENT: no such file or directory, open
  //   '/vercel/path0/frontend/.next/next-server.js.nft.json'
  // Vercel does its own tracing and packaging, so standalone buys nothing
  // there anyway. `VERCEL` is set on every Vercel build.
  output: process.env.VERCEL ? undefined : 'standalone',
};

export default nextConfig;
