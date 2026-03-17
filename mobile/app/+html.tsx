import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Custom HTML root for Expo Web.
 * Injects a branded splash screen with progress indicator that shows instantly.
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
                        margin-bottom: 28px;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    }
                    #savoriq-splash .progress-container {
                        width: 200px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 10px;
                    }
                    #savoriq-splash .progress-track {
                        width: 100%;
                        height: 3px;
                        background: #1C2333;
                        border-radius: 3px;
                        overflow: hidden;
                    }
                    #savoriq-splash .progress-fill {
                        height: 100%;
                        width: 0%;
                        background: linear-gradient(90deg, #D4A84B, #E8C66A);
                        border-radius: 3px;
                        transition: width 0.3s ease;
                    }
                    #savoriq-splash .progress-text {
                        font-size: 12px;
                        font-weight: 500;
                        color: #4B5563;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        font-variant-numeric: tabular-nums;
                    }
                    #savoriq-splash .skip-btn {
                        margin-top: 24px;
                        padding: 8px 20px;
                        border: 1px solid rgba(212, 168, 75, 0.3);
                        border-radius: 50px;
                        background: rgba(212, 168, 75, 0.08);
                        color: #D4A84B;
                        font-size: 13px;
                        font-weight: 600;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        cursor: pointer;
                        opacity: 0;
                        transition: opacity 0.4s ease;
                        pointer-events: none;
                    }
                    #savoriq-splash .skip-btn.visible {
                        opacity: 1;
                        pointer-events: auto;
                    }
                    #savoriq-splash .skip-btn:active {
                        background: rgba(212, 168, 75, 0.15);
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
                    <div className="progress-container">
                        <div className="progress-track">
                            <div className="progress-fill" id="splash-progress-fill" />
                        </div>
                        <div className="progress-text" id="splash-progress-text">0%</div>
                    </div>
                    <button className="skip-btn" id="splash-skip-btn">Skip →</button>
                </div>

                {children}

                {/* Progress tracking and splash removal */}
                <script dangerouslySetInnerHTML={{ __html: `
                    (function() {
                        var fill = document.getElementById('splash-progress-fill');
                        var text = document.getElementById('splash-progress-text');
                        var skipBtn = document.getElementById('splash-skip-btn');
                        var progress = 0;
                        var resourceCount = 0;
                        var startTime = Date.now();

                        function setProgress(p) {
                            p = Math.min(Math.round(p), 100);
                            if (p <= progress) return;
                            progress = p;
                            if (fill) fill.style.width = p + '%';
                            if (text) text.textContent = p + '%';
                        }

                        function dismissSplash() {
                            clearInterval(interval);
                            var splash = document.getElementById('savoriq-splash');
                            if (splash) {
                                splash.classList.add('hide');
                                setTimeout(function() { splash.remove(); }, 400);
                            }
                        }

                        // Phase 1: HTML parsed (instant → 10%)
                        setProgress(10);

                        // Phase 2: Track resource loading with PerformanceObserver
                        if (window.PerformanceObserver) {
                            try {
                                var observer = new PerformanceObserver(function(list) {
                                    resourceCount += list.getEntries().length;
                                    var resourceProgress = Math.min(10 + resourceCount * 4, 80);
                                    setProgress(resourceProgress);
                                });
                                observer.observe({ type: 'resource', buffered: true });
                            } catch(e) {}
                        }

                        // Phase 3: Smooth time-based progression (no hard cap — keeps creeping)
                        var interval = setInterval(function() {
                            var elapsed = Date.now() - startTime;
                            var timeBased = 10 + Math.log(1 + elapsed / 100) * 12;
                            // Asymptotic: slows dramatically but never fully stops
                            if (timeBased > 95) timeBased = 95 + (timeBased - 95) * 0.1;
                            if (timeBased > progress) setProgress(Math.round(Math.min(timeBased, 99)));
                        }, 100);

                        // Show skip button after 2 seconds
                        setTimeout(function() {
                            if (skipBtn) skipBtn.classList.add('visible');
                        }, 2000);

                        // Skip button handler
                        if (skipBtn) {
                            skipBtn.addEventListener('click', function() {
                                dismissSplash();
                            });
                        }

                        // Phase 4: App ready → 100% and hide
                        window.addEventListener('savoriq-ready', function() {
                            setProgress(100);
                            setTimeout(dismissSplash, 300);
                        });
                    })();
                `}} />
            </body>
        </html>
    );
}

