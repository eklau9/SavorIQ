import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Custom HTML root for Expo Web.
 * Injects a branded splash screen that shows instantly (before React hydrates).
 * Once React renders, the splash is removed by dispatching 'savoriq-ready'.
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

                {/* Splash screen styles — inline so they load with HTML, before any JS */}
                <style dangerouslySetInnerHTML={{ __html: `
                    #savoriq-splash {
                        position: fixed;
                        inset: 0;
                        z-index: 99999;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        padding-top: 60px;
                        background: #05070A;
                        transition: opacity 0.4s ease;
                    }
                    #savoriq-splash.hide {
                        opacity: 0;
                        pointer-events: none;
                    }
                    #savoriq-splash .logo {
                        font-size: 36px;
                        font-weight: 800;
                        color: #FFFFFF;
                        letter-spacing: -1px;
                        margin-bottom: 8px;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    }
                    #savoriq-splash .logo span {
                        color: #D4A84B;
                    }
                    #savoriq-splash .tagline {
                        font-size: 13px;
                        color: #6B7280;
                        margin-bottom: 32px;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    }
                    #savoriq-splash .spinner {
                        width: 28px;
                        height: 28px;
                        border: 3px solid #1C2333;
                        border-top-color: #D4A84B;
                        border-radius: 50%;
                        animation: spin 0.8s linear infinite;
                    }
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                    /* Prevent body scroll while splash is visible */
                    body { background: #05070A; }
                `}} />
            </head>
            <body>
                {/* Branded splash — visible instantly */}
                <div id="savoriq-splash">
                    <div className="logo">Savor<span>IQ</span></div>
                    <div className="tagline">Loading intelligence...</div>
                    <div className="spinner" />
                </div>

                {children}

                {/* Remove splash once app signals readiness */}
                <script dangerouslySetInnerHTML={{ __html: `
                    window.addEventListener('savoriq-ready', function() {
                        var splash = document.getElementById('savoriq-splash');
                        if (splash) {
                            splash.classList.add('hide');
                            setTimeout(function() { splash.remove(); }, 400);
                        }
                    });
                `}} />
            </body>
        </html>
    );
}
