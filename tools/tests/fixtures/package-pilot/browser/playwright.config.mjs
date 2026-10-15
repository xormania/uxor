import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: '.', workers: 1, retries: 0, forbidOnly: true,
    timeout: 20_000, expect: { timeout: 8_000 },
    reporter: [['list'], ['json', { outputFile: `/reports/browser-${process.env.PILOT_PHASE}.json` }]],
    outputDir: `/reports/traces-${process.env.PILOT_PHASE}`,
    use: {
        browserName: 'chromium',
        baseURL: `http://127.0.0.1:${process.env.PILOT_PORT || 8187}`,
        connectOptions: { wsEndpoint: process.env.PILOT_BROWSER_WS || 'ws://127.0.0.1:3000/', exposeNetwork: '<loopback>' },
        trace: 'retain-on-failure',
    },
});
