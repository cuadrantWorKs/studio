/** @type {import('next').NextConfig} */
const nextConfig = {
    outputFileTracingRoot: '/Users/admin/studio/studio',
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'placehold.co',
                port: '',
                pathname: '/**',
            },
        ],
    },
};

export default nextConfig;
