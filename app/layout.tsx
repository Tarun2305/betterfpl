import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BetterFPL',
  description: 'A private, local-first Fantasy Premier League research dashboard.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
