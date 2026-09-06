import { assetUrl } from '@/lib/base';
import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/space-grotesk';
import './globals.css';
export const metadata: Metadata = {
  title: 'Gaze · Spatial viewer',
  description: 'Explore PLY and USDZ models with touch, camera tracking, and immersive VR.',
  applicationName: 'Gaze',
  manifest: assetUrl('/manifest.webmanifest'),
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Gaze' },
  icons: { icon: assetUrl('/favicon.svg') },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0d0a1f' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className="dark"><body>{children}</body></html>;
}
