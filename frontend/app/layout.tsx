import type { Metadata } from 'next';
import { Space_Grotesk, IBM_Plex_Mono, Inter } from 'next/font/google';
import { Providers } from '../components/providers';
import './globals.css';

/** Display font, exposed as `--font-display`. */
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
});
/** Monospace font, exposed as `--font-mono`. */
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});
/** Body font, exposed as `--font-body`. */
const inter = Inter({ subsets: ['latin'], variable: '--font-body' });

/** Default page title and description. */
export const metadata: Metadata = {
  title: 'Job Tracker',
  description: 'Track your job applications in one place',
};

/**
 * Root HTML shell: fonts, app providers, and an inline script that applies the
 * saved or system theme before first paint to avoid a flash.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${plexMono.variable} ${inter.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        {process.env.NEXT_PUBLIC_API_URL && (
          <link rel="preconnect" href={process.env.NEXT_PUBLIC_API_URL} />
        )}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className="h-full bg-surface font-sans text-ink antialiased"
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
