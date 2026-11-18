import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'LThai Factory · พนักงานและสิทธิ์',
  description: 'ระบบทะเบียนพนักงานและสิทธิ์การใช้งานภายในโรงงาน',
};

const restoreDisplayMode = `
  try {
    const savedMode = localStorage.getItem("lthai-display-mode");
    document.documentElement.dataset.theme = savedMode === "dark" ? "dark" : "light";
  } catch {
    document.documentElement.dataset.theme = "light";
  }
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: restoreDisplayMode }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
