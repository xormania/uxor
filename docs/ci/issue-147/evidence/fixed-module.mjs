/**
 * @param {import('@playwright/test').Browser} browser
 * @returns {Promise<boolean>}
 *
 * Whether this browser runs Chromium's leak detector. Playwright 1.58.2's Chromium 145.0.7632.6 is known to answer
 * "Failed to run leak detection" and crash its renderer; the optional probe can spend most of the session's budget
 * doing so. Use its existing memory-pressure fallback directly. Other builds are probed once in a separate context,
 * never the page under test. Both modes drop caches before the same forced collection; the report says which ran.
 */
export async function leakDetectorRuns(browser) {
    if ('145.0.7632.6' === browser.version()) {
        return false;
    }
    const context = await browser.newContext();
    try {
        const probe = await context.newPage();
        const cdp = await context.newCDPSession(probe);
        await cdp.send('Memory.prepareForLeakDetection');
        await probe.evaluate(() => 1); // the renderer survived it
        return true;
    } catch {
        return false;
    } finally {
        await context.close().catch(() => undefined);
    }
}
