const root = document.documentElement;
let themeButton;
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');

function storedTheme() {
    try {
        return localStorage.getItem('theme');
    } catch {
        return null;
    }
}

function setTheme(theme) {
    const dark = theme === 'dark' || (theme !== 'light' && systemTheme.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    themeButton?.setAttribute('aria-pressed', String(dark));
}

setTheme(storedTheme());
document.addEventListener('DOMContentLoaded', () => {
    // A source README can describe a recipe before its first release. Only follow links in the published catalog.
    const requestedRecipe = new URLSearchParams(location.search).get('recipe');
    if (requestedRecipe && location.hash === '#recipes') {
        const published = [...document.querySelectorAll('#recipes .recipe-link')].find(link => link.textContent.trim() === requestedRecipe);
        if (published) {
            location.replace(published.href);
            return;
        }
    }

    themeButton = document.querySelector('.theme-toggle');
    themeButton.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
    themeButton.hidden = false;
    themeButton.addEventListener('click', () => {
        const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        try {
            localStorage.setItem('theme', next);
        } catch {
            // The preference still applies to this page if storage is unavailable.
        }
    });
    systemTheme.addEventListener('change', () => setTheme(storedTheme()));
    window.addEventListener('storage', event => {
        if (event.key === 'theme') setTheme(event.newValue);
    });

    // The document remains readable when scripting is off. Only an enhanced group hides panels.
    for (const group of document.querySelectorAll('[data-tabs]')) {
        const list = group.querySelector(':scope > .tab-list');
        const buttons = Array.from(list.querySelectorAll('button'));
        const panels = buttons.map(button => document.getElementById(button.getAttribute('aria-controls')));
        const select = index => {
            for (const [i, button] of buttons.entries()) {
                const active = i === index;
                button.setAttribute('aria-selected', String(active));
                button.tabIndex = active ? 0 : -1;
                panels[i].hidden = !active;
            }
        };
        for (const [index, button] of buttons.entries()) {
            button.setAttribute('role', 'tab');
            panels[index].setAttribute('role', 'tabpanel');
            panels[index].setAttribute('aria-labelledby', button.id);
            panels[index].tabIndex = 0;
            button.addEventListener('click', () => select(index));
            button.addEventListener('keydown', event => {
                const next = {
                    ArrowLeft: (index + buttons.length - 1) % buttons.length,
                    ArrowRight: (index + 1) % buttons.length,
                    Home: 0,
                    End: buttons.length - 1,
                }[event.key];
                if (next === undefined) return;
                event.preventDefault();
                select(next);
                buttons[next].focus();
            });
        }
        list.setAttribute('role', 'tablist');
        list.setAttribute('aria-label', buttons.map(button => button.textContent.trim()).join(' or '));
        select(0);
        group.dataset.enhanced = '';
        list.hidden = false;
    }

    for (const frame of document.querySelectorAll('.preview-pair iframe')) {
        function resize() {
            const content = frame.contentDocument;
            if (content?.body?.childElementCount) {
                const height = Math.min(content.documentElement.scrollHeight, 1200);
                if (height > frame.clientHeight) frame.style.height = height + 'px';
            }
        }
        frame.addEventListener('load', resize);
        resize();
    }
});
