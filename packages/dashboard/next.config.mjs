/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @adref/core 를 서버 번들에서 그대로 트랜스파일 (workspace 패키지)
  transpilePackages: ['@adref/core'],
  // pg 등 서버 전용 모듈은 서버 컴포넌트에서만 사용
  serverExternalPackages: ['pg'],
  images: {
    // 광고 썸네일(외부 도메인) 표시 허용 — 로컬 개발용 원격 패턴
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
};

export default nextConfig;
