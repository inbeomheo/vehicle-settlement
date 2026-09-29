import type { Metadata, Viewport } from 'next';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './globals.css';
export const metadata: Metadata = {
  title: '차량 사용·정산',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: '차량 사용·정산', statusBarStyle: 'default' },
  icons: { apple: '/icons/icon-192.png' },
  description: '화물차 사용 내역과 청구·정산 관리',
};
export const viewport: Viewport = { themeColor: '#1f2328' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
