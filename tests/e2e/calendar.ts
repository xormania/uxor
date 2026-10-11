import type { Locator } from '@playwright/test';

/*
 * The calendar's day grid as the specs reach it (calendar/templates/components/Calendar.html.twig): each day is a
 * `data-slot="calendar-day"` cell named by its ISO date in `data-day`, holding the day's button. The calendar recipe,
 * the date picker's dialog and every lab page holding either use the same markup.
 */

/** The cell of `date` (`YYYY-MM-DD`) inside `scope`: the one carrying `aria-selected`. */
export const dayCell = (scope: Locator, date: string): Locator => scope.locator(`[data-slot="calendar-day"][data-day="${date}"]`);

/** The button of `date` (`YYYY-MM-DD`) inside `scope`: the one a pick clicks, focused, disabled or selected. */
export const day = (scope: Locator, date: string): Locator => dayCell(scope, date).locator('button');
