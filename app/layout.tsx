import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Employee Time Tracker',
  description: 'Track who worked on what, and for how long.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
