import type { Locator, Page } from '@playwright/test';

/*
 * The data tables as the specs read them: the DataTable recipe (a Turbo Frame and a GET form) and DataTableLive (a Live
 * Component) show the same status lines and keep their state in the URL.
 */

/** The status line telling which rows are shown (`Showing 11–20 of 57`, or `No rows…`), inside `scope`. */
export const tableStatus = (scope: Page | Locator): Locator => scope.getByRole('status').filter({ hasText: /Showing|No rows/ });

/** DataTableLive's status line counting the selected rows (`1 selected`), inside `scope`. */
export const selectionStatus = (scope: Page | Locator): Locator => scope.getByRole('status').filter({ hasText: 'selected' });

/** The page's URL parameters, the table's state, as an object: compared with `toEqual`, in any order. */
export const tableParams = (page: Page): Record<string, string> => Object.fromEntries(new URL(page.url()).searchParams);
