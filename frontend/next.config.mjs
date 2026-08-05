/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // Docker：产出自包含 .next/standalone（含精简 node_modules），运行时零 npm install
};

export default nextConfig;
