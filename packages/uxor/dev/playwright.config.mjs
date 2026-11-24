import { defineConfig } from '@playwright/test';

const browserEndpoint = process.env.PW_BROWSER_WS_ENDPOINT;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

// The consumer's own browser check, independent of the kit's suite at the repository root: run it from this directory
// (packages/uxor/dev) after `python3 install-uxor.py`. Paths are relative to this file.
export default defineConfig({
    testDir: './e2e',
    forbidOnly: Boolean(process.env.CI),
    workers: 1,
    retries: 0,
    use: {
        baseURL: process.env.UXOR_DEV_BASE_URL ?? 'http://127.0.0.1:8765',
        trace: 'retain-on-failure',
        ...(browserEndpoint ? { connectOptions: { wsEndpoint: browserEndpoint } } : { launchOptions: { executablePath } }),
    },
    webServer: process.env.UXOR_DEV_BASE_URL ? undefined : {
        command: 'exec "$PHP_BIN" -S 127.0.0.1:8765 -t app/public app/public/index.php',
        env: { PHP_BIN: process.env.PHP_BIN ?? 'php' },
        cwd: import.meta.dirname,
        url: 'http://127.0.0.1:8765/health',
        reuseExistingServer: false,
        timeout: 30000,
    },
});
