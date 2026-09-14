import type { Metadata } from 'next';
import './globals.css';
import './home-dashboard.css';

export const metadata: Metadata = {
  title: 'BetterFPL',
  description: 'A modern Fantasy Premier League research and planning dashboard.',
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
