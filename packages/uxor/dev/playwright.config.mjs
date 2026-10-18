import { defineConfig } from '@playwright/test';

// The consumer's own browser check, independent of the kit's suite at the repository root: run it from this directory
// (packages/uxor/dev) after `python3 install-uxor.py`. Paths are relative to this file.
export default defineConfig({
    testDir: './e2e',
    workers: 1,
    retries: 0,
    use: { baseURL: process.env.UXOR_DEV_BASE_URL ?? 'http://127.0.0.1:8765', trace: 'retain-on-failure', launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} },
    webServer: process.env.UXOR_DEV_BASE_URL ? undefined : {
        command: 'php -S 127.0.0.1:8765 -t app/public app/public/index.php',
        cwd: import.meta.dirname,
        url: 'http://127.0.0.1:8765/health',
        reuseExistingServer: false,
        timeout: 30000,
    },
});
