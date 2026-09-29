import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '차량 사용·정산',
  description: '화물차 사용 내역과 청구·정산 관리',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
