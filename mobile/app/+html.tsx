import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Custom HTML root for Expo Web.
 * Minimal — just sets the dark background so there's no white flash.
 * React handles all UI (access key gate, splash, dashboard).
 */
export default function Root({ children }: PropsWithChildren) {
    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
                <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
                <title>SavorIQ — Intelligence Dashboard</title>
                <meta name="description" content="AI-powered restaurant intelligence dashboard" />

                <ScrollViewStyleReset />

                <style dangerouslySetInnerHTML={{ __html: `
                    body { background: #05070A; margin: 0; }
                `}} />
            </head>
            <body>
                {children}
            </body>
        </html>
    );
}
