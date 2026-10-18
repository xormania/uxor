export async function leakDetectorRuns(browser) {
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
