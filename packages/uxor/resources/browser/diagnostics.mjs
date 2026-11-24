import { writeFile } from 'node:fs/promises';

import { startBrowserDiagnostics } from './capture.mjs';

// Playwright resolves fixture dependencies before invoking the function. Select the implementation
// at registration time so disabled captures in existing consumer fixtures never request a browser context.
export const recordBrowserDiagnostics = process.env.PROFILER_COLLECT === '1'
    ? collectBrowserDiagnostics
    : async ({}, use) => { await use(); };

/** Opt-in Playwright fixture for correlating browser failures with Symfony Profiler responses. */
async function collectBrowserDiagnostics({ context, baseURL }, use, testInfo) {
    if (!baseURL) {
        await use();
        return;
    }

    const finish = startBrowserDiagnostics(context, baseURL);
    try {
        await use();
    } finally {
        const evidence = finish();
        const path = testInfo.outputPath('browser-diagnostics.json');
        await writeFile(path, `${JSON.stringify(evidence)}\n`);
        await testInfo.attach('Browser diagnostics', { path, contentType: 'application/json' });
    }
}
