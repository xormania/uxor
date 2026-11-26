import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.WEBSITE_PORT ?? 8037);
const origin = `http://127.0.0.1:${port}`;
const browserEndpoint = process.env.PW_BROWSER_WS_ENDPOINT;

export default defineConfig({
    testDir: './tests/browser',
    outputDir: fileURLToPath(new URL('../test-results/website', import.meta.url)),
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    workers: 4,
    use: {
        baseURL: `${origin}/uxor/`,
        browserName: 'chromium',
        serviceWorkers: 'block',
        ...(browserEndpoint ? { connectOptions: { wsEndpoint: browserEndpoint } } : {}),
    },
    webServer: {
        command: `python3 website/tests/browser/serve.py ${port}`,
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        url: `${origin}/uxor/`,
        reuseExistingServer: false,
    },
});
