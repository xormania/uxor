import type { BrowserContext, TestInfo } from '@playwright/test';

export function recordBrowserDiagnostics(
    fixtures: { context: BrowserContext; baseURL?: string },
    use: () => Promise<void>,
    testInfo: TestInfo,
): Promise<void>;
