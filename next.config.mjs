/** @type {import('next').NextConfig} */
const nextConfig = {
  // puppeteer is a heavy native dep loaded only at runtime in route handlers;
  // keep it out of the webpack bundle.
  experimental: {
    serverComponentsExternalPackages: ["puppeteer"],
  },
};
export default nextConfig;
