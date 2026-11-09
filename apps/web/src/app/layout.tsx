import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'LThai Factory · พนักงานและสิทธิ์',
  description: 'ระบบทะเบียนพนักงานและสิทธิ์การใช้งานภายในโรงงาน',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="th"><body>{children}</body></html>;
}
