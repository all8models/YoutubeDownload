/* Next.js Geist 폰트 설정 - Google Fonts 기반의 기본 UI 폰트 */
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "YouTube to MP3 / MP4 Downloader",
  description:
    "High-speed YouTube video, playlist, channel, and Shorts MP3/MP4 downloader with Zero-Disk & Zero-Buffer streaming",
};

/**
 * 루트 레이아웃 컴포넌트
 * - YouTube 썸네일 CDN(i.ytimg.com) 사전 연결(preconnect)로 이미지 TLS 핸드셰이크 지연 제거
 */
export default function RootLayout({ children }) {
  return (
    <html
      lang="ko"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
        <link rel="preconnect" href="https://i.ytimg.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://i.ytimg.com" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme') || 'system';
                  if (theme === 'system') {
                    var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
                    if (darkQuery.matches) {
                      document.documentElement.classList.add('dark-theme');
                    } else {
                      document.documentElement.classList.add('light-theme');
                    }
                  } else if (theme === 'dark') {
                    document.documentElement.classList.add('dark-theme');
                  } else {
                    document.documentElement.classList.add('light-theme');
                  }
                } catch (e) {}
              })()
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
