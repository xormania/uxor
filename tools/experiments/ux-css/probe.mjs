import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const url = new URL('/_experiments/ux-css/motion', process.env.DEMO_URL ?? 'http://127.0.0.1:8003');
const wsEndpoint = process.env.PW_WS_ENDPOINT ?? 'ws://127.0.0.1:3000/';
const browser = await chromium.connect(wsEndpoint, {
    ...(process.env.PW_DIRECT_NETWORK ? {} : { exposeNetwork: '<loopback>' }),
});

async function openProbe(reducedMotion) {
    const page = await browser.newPage({ reducedMotion });
    const response = await page.goto(url.href);
    assert.equal(response?.status(), 200, 'The motion-only Twig fixture must render');
    return page;
}

function computedTransitions(page) {
    return page.evaluate(() => Object.fromEntries(['kit', 'named', 'direct'].map(id => {
        const style = getComputedStyle(document.getElementById(id));
        return [id, [style.transitionProperty, style.transitionDuration, style.transitionTimingFunction]];
    })));
}

function opacityTransitions(page) {
    return page.locator('#direct').evaluate(async panel => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        panel.style.opacity = '0.4';
        void getComputedStyle(panel).opacity;
        return panel.getAnimations().map(animation => [animation.transitionProperty, animation.effect.getTiming().duration]);
    });
}

try {
    const page = await openProbe('no-preference');
    const sheetOrder = await page.locator('link[rel="stylesheet"][id]').evaluateAll(links => links.map(link => link.id));
    assert.deepEqual(sheetOrder, ['override-css', 'generated-css']);
    const generatedSheet = page.locator('#generated-css');
    const cssResponse = await page.request.get(await generatedSheet.evaluate(link => link.href));
    assert.equal(cssResponse.status(), 200, 'AssetMapper must serve the generated stylesheet');
    const css = await cssResponse.text();
    assert.match(css, /--durations-normal:\s*var\(--uxor-motion-duration-normal\)/);
    assert.match(css, /--easings-out:\s*var\(--uxor-motion-ease-out\)/);
    assert.match(css, /@layer utilities\b/);
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*no-preference\)/);
    assert.match(css, /transition-property:\s*none[;}]/);
    assert.match(css, /transition-property:\s*opacity[;}]/);
    for (const [property, alias, token] of [
        ['transition-duration', 'durations-normal', 'duration-normal'],
        ['transition-timing-function', 'easings-out', 'ease-out'],
    ]) {
        assert.match(css, new RegExp(`${property}:\\s*var\\(--${alias}\\)`));
        assert.match(css, new RegExp(`${property}:\\s*var\\(--uxor-motion-${token}\\)`));
    }

    const defaults = await computedTransitions(page);
    assert.deepEqual(defaults, {
        kit: ['opacity, translate', '0.15s', 'ease-out'],
        named: ['opacity', '0.15s', 'ease-out'],
        direct: ['opacity', '0.15s', 'ease-out'],
    });
    const active = await opacityTransitions(page);
    assert.deepEqual(active, [['opacity', 150]]);

    await page.locator('#panels').evaluate(panel => panel.classList.add('motion-probe-scope'));
    const scopedOverride = await computedTransitions(page);
    assert.deepEqual(scopedOverride, {
        kit: ['opacity, translate', '0.41s', 'ease-in'],
        named: ['opacity', '0.15s', 'ease-out'],
        direct: ['opacity', '0.41s', 'ease-in'],
    });
    await page.locator('#panels').evaluate(panel => panel.classList.remove('motion-probe-scope'));
    await page.locator('html').evaluate(root => root.classList.add('motion-probe-root'));
    const rootOverride = await computedTransitions(page);
    assert.deepEqual(rootOverride, {
        kit: ['opacity, translate', '0.24s', 'linear'],
        named: ['opacity', '0.24s', 'linear'],
        direct: ['opacity', '0.24s', 'linear'],
    });

    await page.locator('#direct').evaluate(panel => panel.classList.add('motion-probe-property'));
    const propertyOverride = await computedTransitions(page);
    assert.deepEqual(propertyOverride.direct, ['opacity', '0.52s', 'linear']);
    await page.close();

    const reducedPage = await openProbe('reduce');
    const reduced = await computedTransitions(reducedPage);
    assert.deepEqual(reduced, {
        kit: ['all', '0s', 'ease'],
        named: ['none', '0s', 'ease'],
        direct: ['none', '0s', 'ease'],
    });
    await reducedPage.locator('html').evaluate(root => root.classList.add('motion-probe-root'));
    await reducedPage.locator('#panels').evaluate(panel => panel.classList.add('motion-probe-scope'));
    await reducedPage.locator('#direct').evaluate(panel => panel.classList.add('motion-probe-property'));
    const reducedOverrides = await computedTransitions(reducedPage);
    assert.deepEqual(reducedOverrides, {
        kit: ['all', '0s', 'ease'],
        named: ['none', '0s', 'ease'],
        direct: ['none', '0.52s', 'ease'],
    });

    const reducedActive = await opacityTransitions(reducedPage);
    assert.deepEqual(reducedActive, []);
    await reducedPage.close();

    console.log(JSON.stringify({
        chromium: browser.version(),
        cssBytes: Buffer.byteLength(css),
        defaults,
        scopedOverride,
        rootOverride,
        propertyOverride,
        reduced,
        reducedOverrides,
        opacityTransitions: { normal: active, reduced: reducedActive },
    }, null, 2));
} finally {
    await browser.close();
}
