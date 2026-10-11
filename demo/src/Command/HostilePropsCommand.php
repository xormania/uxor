<?php

namespace App\Command;

use App\Kit\PreviewForms;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Twig\Environment;
use Twig\Markup;
use Twig\TemplateWrapper;

/**
 * Renders the components whose props shape the markup with hostile and ordinary values, as JSON, for
 * tests/e2e/hostile-props.spec.ts: the `as` tag of six components, the attribute names of FormField's
 * `labelAttr` and `helpAttr`, every guarded link and image prop, every component given inline event handlers
 * (`on…`) among its attributes, and the Calendar's dates, modifier names and hidden-input attributes. Every value
 * is a constant of this class, never request data; the spec loads each rendering in the browser and checks what it
 * parsed.
 */
#[AsCommand('app:hostile-props', description: 'Renders the components with hostile prop values, as JSON')]
final class HostilePropsCommand
{
    /**
     * Each component with an `as` prop => its default tag, the tags it accepts, and its markup (`%s`: the `as`
     * argument, `:as="value"` or a spread).
     */
    private const TAG_COMPONENTS = [
        'Button' => ['button', ['button', 'a'], '<twig:Button %s data-testid="root">Go</twig:Button>'],
        'Badge' => ['div', ['div', 'span', 'a'], '<twig:Badge %s data-testid="root">New</twig:Badge>'],
        'Avatar:GroupCount' => ['div', ['div', 'a', 'button'], '<twig:Avatar:GroupCount %s data-testid="root">+9</twig:Avatar:GroupCount>'],
        'Card:Title' => ['span', ['span', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'], '<twig:Card:Title %s data-testid="root">Title</twig:Card:Title>'],
        'Dropdown:Item' => ['a', ['a', 'button'], '<ul role="menu"><twig:Dropdown:Item %s data-testid="root">Item</twig:Dropdown:Item></ul>'],
        'FormField' => ['div', ['div', 'fieldset'], '<twig:FormField %s for="field" label="Label" data-testid="root"><input id="field"></twig:FormField>'],
    ];

    /**
     * FormField's `labelAttr` and `helpAttr`: hostile names, each of which must stay one inert attribute, inline
     * event handlers (`on…`), which must not render, then ordinary ones, which must render as given (a `false` value omits the attribute, `true` renders the name).
     */
    private const LABEL_ATTRIBUTES = [
        'x onmouseover=window.__xss=1 y' => 'v',
        "x\tonmouseover=window.__xss=1" => 'v',
        "x\nonclick=window.__xss=1" => 'v',
        'x/onmouseover=window.__xss=1' => 'v',
        'tabindex=0 autofocus onfocus=window.__xss=1 x' => true,
        '"><svg onload=window.__xss=1>' => 'v',
        'onclick' => 'window.__xss=1',
        'onmouseover' => 'window.__xss=1',
        'ONCLICK' => 'window.__xss=1',
        ' onfocus' => 'window.__xss=1',
        'data-test' => 'ok',
        'title' => 'Hint',
        '@click' => 'go',
        'x-on:click.prevent' => 'go',
        'data-flag' => true,
        'hidden' => false,
    ];

    /**
     * Each link prop of the kit's own recipes => its markup (`value`: the URL, `form`: a fresh form of the
     * block), the text of the link it renders, and the recipe whose preview form the block takes.
     */
    private const URL_PROPS = [
        ['Button', 'href', '<twig:Button as="a" :href="value">Button</twig:Button>', 'Button', null],
        ['Badge', 'href', '<twig:Badge as="a" :href="value">Badge</twig:Badge>', 'Badge', null],
        ['Breadcrumb:Item', 'href', '<ol><twig:Breadcrumb:Item :href="value">Level</twig:Breadcrumb:Item></ol>', 'Level', null],
        ['Dropdown:Item', 'href', '<ul role="menu"><twig:Dropdown:Item :href="value">Item</twig:Dropdown:Item></ul>', 'Item', null],
        ['Pagination:Link', 'href', '<twig:Pagination><twig:Pagination:Content><twig:Pagination:Item><twig:Pagination:Link :href="value">Page</twig:Pagination:Link></twig:Pagination:Item></twig:Pagination:Content></twig:Pagination>', 'Page', null],
        ['Sidebar:Item', 'href', '<ul><twig:Sidebar:Item :href="value">Item</twig:Sidebar:Item></ul>', 'Item', null],
        ['SideNav:Item', 'href', '<ul role="tree" aria-label="Tree"><twig:SideNav:Item :href="value">Item</twig:SideNav:Item></ul>', 'Item', null],
        ['SectionNav:Item', 'href', '<ul><twig:SectionNav:Item :href="value">Item</twig:SectionNav:Item></ul>', 'Item', null],
        ['NavMenu:Link', 'href', '<twig:NavMenu><twig:NavMenu:Link :href="value">Item</twig:NavMenu:Link></twig:NavMenu>', 'Item', null],
        ['LoginForm', 'forgotPasswordHref', '<twig:LoginForm :form="form" :forgotPasswordHref="value" />', 'Forgot your password?', 'login'],
        ['LoginForm', 'signupHref', '<twig:LoginForm :form="form" :signupHref="value" />', 'Create one', 'login'],
        ['ForgotPasswordForm', 'loginHref', '<twig:ForgotPasswordForm :form="form" :loginHref="value" />', 'Back to sign in', 'forgot-password'],
        ['SignupForm', 'loginHref', '<twig:SignupForm :form="form" :loginHref="value" />', 'Sign in', 'signup'],
        ['NotFound', 'homeHref', '<twig:NotFound :homeHref="value" />', 'Back to the homepage', null],
    ];

    /** Inline event handlers, which every component drops, next to ordinary attributes, which it renders as given. */
    private const HANDLERS = [
        'onclick' => 'window.__xss=1',
        'onmouseover' => 'window.__xss=1',
        'ONCLICK' => 'window.__xss=1',
        ' onfocus' => 'window.__xss=1',
        'data-testid' => 'root',
        'data-extra' => 'ok',
        'aria-keyshortcuts' => 'k',
    ];

    /** Attributes the link and image components render as given (`class` and `data-action` merged with their own). */
    private const LEGIT = [
        'id' => 'given-id',
        'class' => 'given-class',
        'title' => 'Hint',
        'target' => '_blank',
        'rel' => 'noopener',
        'data-action' => 'click->given#run',
        'aria-label' => 'Given',
    ];

    /** The components whose URL attributes became props, given LEGIT and HANDLERS (`handlers`). */
    private const LEGIT_MARKUP = [
        'Button' => '<twig:Button as="a" href="/x" {{ ...handlers }}>Button</twig:Button>',
        'Badge' => '<twig:Badge as="a" href="/x" {{ ...handlers }}>Badge</twig:Badge>',
        'Dropdown:Item' => '<ul role="menu"><twig:Dropdown:Item href="/x" {{ ...handlers }}>Item</twig:Dropdown:Item></ul>',
        'Pagination:Link' => '<twig:Pagination:Link href="/x" {{ ...handlers }}>2</twig:Pagination:Link>',
        'Avatar:Image' => '<twig:Avatar><twig:Avatar:Image src="/a.png" {{ ...handlers }} /></twig:Avatar>',
    ];

    /**
     * The markup of each component that does not render alone as `<twig:Name %2$s>Text</twig:Name>` (`%2$s`: the
     * attributes), and the recipe whose preview variables it takes (`form`, `table`).
     */
    private const HANDLER_MARKUP = [
        'Chart' => ['<twig:Chart title="Visits" :labels="[\'Mon\']" :datasets="[{label: \'Visits\', data: [1]}]" %2$s />', null],
        'DataTable' => ['<twig:DataTable :table="table" id="orders" label="Orders" %2$s />', 'data-table'],
        'DataTableLive' => ['<twig:OrdersTable %2$s />', null],
        'Drawer' => ['<twig:Drawer id="d" %2$s><twig:Drawer:Content>Text</twig:Drawer:Content></twig:Drawer>', null],
        'Drawer:Content' => ['<twig:Drawer id="d"><twig:Drawer:Content %2$s>Text</twig:Drawer:Content></twig:Drawer>', null],
        'Drawer:Title' => ['<twig:Drawer id="d"><twig:Drawer:Content><twig:Drawer:Title %2$s>Text</twig:Drawer:Title></twig:Drawer:Content></twig:Drawer>', null],
        'Dropdown' => ['<twig:Dropdown id="d" %2$s><twig:Dropdown:Content>Text</twig:Dropdown:Content></twig:Dropdown>', null],
        'Dropdown:Content' => ['<twig:Dropdown id="d"><twig:Dropdown:Content %2$s>Text</twig:Dropdown:Content></twig:Dropdown>', null],
        'Dropdown:Sub' => ['<twig:Dropdown id="d"><twig:Dropdown:Content><twig:Dropdown:Sub id="s" %2$s><twig:Dropdown:SubTrigger>More</twig:Dropdown:SubTrigger><twig:Dropdown:Content>Text</twig:Dropdown:Content></twig:Dropdown:Sub></twig:Dropdown:Content></twig:Dropdown>', null],
        'Dropdown:SubTrigger' => ['<twig:Dropdown id="d"><twig:Dropdown:Content><twig:Dropdown:Sub id="s"><twig:Dropdown:SubTrigger %2$s>More</twig:Dropdown:SubTrigger><twig:Dropdown:Content>Text</twig:Dropdown:Content></twig:Dropdown:Sub></twig:Dropdown:Content></twig:Dropdown>', null],
        'Editor' => ['<twig:Editor id="e" name="body" %2$s />', null],
        'EmptyState' => ['<twig:EmptyState title="Title" %2$s />', null],
        'FormField' => ['<twig:FormField for="f" label="Label" help="Help" %2$s><input id="f"></twig:FormField>', null],
        'ForgotPasswordForm' => ['<twig:ForgotPasswordForm :form="form" %2$s />', 'forgot-password'],
        'LoginForm' => ['<twig:LoginForm :form="form" %2$s />', 'login'],
        'MarkdownEditor' => ['<twig:MarkdownEditor id="m" name="body" %2$s />', null],
        'Modal' => ['<twig:Modal id="m" %2$s><twig:Modal:Content>Text</twig:Modal:Content></twig:Modal>', null],
        'Modal:Content' => ['<twig:Modal id="m"><twig:Modal:Content %2$s>Text</twig:Modal:Content></twig:Modal>', null],
        'Modal:Title' => ['<twig:Modal id="m"><twig:Modal:Content><twig:Modal:Title %2$s>Text</twig:Modal:Title></twig:Modal:Content></twig:Modal>', null],
        'NavMenu:Link' => ['<twig:NavMenu><twig:NavMenu:Link href="/x" %2$s>Text</twig:NavMenu:Link></twig:NavMenu>', null],
        'NavMenu:Submenu' => ['<twig:NavMenu><twig:NavMenu:Submenu label="More" %2$s><twig:NavMenu:Link href="/x">Text</twig:NavMenu:Link></twig:NavMenu:Submenu></twig:NavMenu>', null],
        'PageHeader' => ['<twig:PageHeader title="Title" %2$s />', null],
        'SectionNav:Item' => ['<ul><twig:SectionNav:Item href="/x" %2$s>Text</twig:SectionNav:Item></ul>', null],
        'SettingsProfile' => ['<twig:SettingsProfile :form="form" name="Bonnie Green" email="bonnie@example.com" %2$s />', 'settings-profile'],
        'SideNav:Branch' => ['<ul role="tree" aria-label="Tree"><twig:SideNav:Branch label="More" %2$s><twig:SideNav:Item href="/x">Text</twig:SideNav:Item></twig:SideNav:Branch></ul>', null],
        'SideNav:Item' => ['<ul role="tree" aria-label="Tree"><twig:SideNav:Item href="/x" %2$s>Text</twig:SideNav:Item></ul>', null],
        'Sidebar:Item' => ['<ul><twig:Sidebar:Item href="/x" %2$s>Text</twig:Sidebar:Item></ul>', null],
        'SignupForm' => ['<twig:SignupForm :form="form" %2$s />', 'signup'],
        'StatCard' => ['<twig:StatCard label="Revenue" value="1" %2$s />', null],
        'Table:Body' => ['<table><twig:Table:Body %2$s><tr><td>Text</td></tr></twig:Table:Body></table>', null],
        'Table:Caption' => ['<table><twig:Table:Caption %2$s>Text</twig:Table:Caption></table>', null],
        'Table:Cell' => ['<table><tbody><tr><twig:Table:Cell %2$s>Text</twig:Table:Cell></tr></tbody></table>', null],
        'Table:Footer' => ['<table><twig:Table:Footer %2$s><tr><td>Text</td></tr></twig:Table:Footer></table>', null],
        'Table:Head' => ['<table><thead><tr><twig:Table:Head %2$s>Text</twig:Table:Head></tr></thead></table>', null],
        'Table:Header' => ['<table><twig:Table:Header %2$s><tr><th>Text</th></tr></twig:Table:Header></table>', null],
        'Table:Row' => ['<table><tbody><twig:Table:Row %2$s><td>Text</td></twig:Table:Row></tbody></table>', null],
        'Tabs:Content' => ['<twig:Tabs defaultValue="a"><twig:Tabs:List><twig:Tabs:Trigger value="a">A</twig:Tabs:Trigger></twig:Tabs:List><twig:Tabs:Content value="a" %2$s>Text</twig:Tabs:Content></twig:Tabs>', null],
        'Tabs:Trigger' => ['<twig:Tabs defaultValue="a"><twig:Tabs:List><twig:Tabs:Trigger value="a" %2$s>A</twig:Tabs:Trigger></twig:Tabs:List><twig:Tabs:Content value="a">Text</twig:Tabs:Content></twig:Tabs>', null],
        'Tooltip' => ['<twig:Tooltip content="Hint" id="t" %2$s><button type="button">Text</button></twig:Tooltip>', null],
    ];

    /** Each guarded image prop => its markup (`value`: the URL). */
    private const IMAGE_PROPS = [
        ['Avatar:Image', 'src', '<twig:Avatar><twig:Avatar:Image :src="value" data-testid="root" /><twig:Avatar:Fallback>A</twig:Avatar:Fallback></twig:Avatar>'],
    ];

    /** A Sidebar on the page at this path: its current item, an item whose link is rejected, a `#` item. */
    private const CHART = '<twig:Chart :id="id" :title="title" :type="type" :size="size" :table="table" :labelsHeader="title" :labels="labels" :datasets="datasets" data-testid="chart" />';

    private const SIDEBAR_PATH = '/lab';
    private const SIDEBAR = <<<'TWIG'
        <twig:Sidebar id="hostile-sidebar" label="Hostile links" storageKey="hostile-sidebar">
            <twig:Sidebar:Group>
                <twig:Sidebar:Item :href="rejected">Rejected</twig:Sidebar:Item>
                <twig:Sidebar:Item href="#placeholder">Placeholder</twig:Sidebar:Item>
                <twig:Sidebar:Item :href="current">Current</twig:Sidebar:Item>
            </twig:Sidebar:Group>
        </twig:Sidebar>
        TWIG;

    /**
     * A Calendar given dates it must drop (impossible, overflowing, hostile) next to one real date, and modifier
     * and input attribute names it must drop next to ordinary ones.
     */
    private const CALENDAR = '<twig:Calendar name="day" today="2026-03-15" :selected="selected" :month="month" :minDate="month" :disabled="selected" :modifiers="modifiers" :inputAttr="inputAttr" data-testid="root" />';

    /** @var array<string, TemplateWrapper> */
    private array $templates = [];

    public function __construct(
        private readonly Environment $twig,
        private readonly PreviewForms $forms,
        #[Autowire('%kernel.project_dir%/templates/components')]
        private readonly string $components,
    ) {
    }

    public function __invoke(OutputInterface $output): int
    {
        $output->writeln(json_encode([
            'tags' => $this->tags(),
            'attributes' => $this->attributes(),
            'urls' => $this->urls(),
            'images' => $this->images(),
            'handlers' => $this->handlers(),
            'calendar' => $this->calendar(),
            'editor' => $this->editor(),
            'markdown' => $this->markdown(),
            'chart' => ['html' => $this->render(self::CHART, [
                'id' => 'c" onmouseover="window.__xss=1',
                'title' => '"><svg onload=window.__xss=1>',
                'type' => 'bar onclick=x',
                'size' => '"><script>window.__xss=1</script>',
                'table' => 'visible" onfocus="window.__xss=1',
                'labels' => ['<img src=x onerror=window.__xss=1>', 'B'],
                'datasets' => [['label' => '"><svg onload=window.__xss=1>', 'data' => ['<script>window.__xss=1</script>', 2]]],
            ])],
            'sidebar' => [
                'path' => self::SIDEBAR_PATH,
                'html' => $this->render(self::SIDEBAR, ['rejected' => 'javascript:alert(document.domain)', 'current' => self::SIDEBAR_PATH]),
            ],
        ], \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES | \JSON_UNESCAPED_UNICODE));

        return Command::SUCCESS;
    }

    /**
     * The Editor component given hostile HTML (elements, attributes, link schemes), for the browser to parse. What the
     * policy itself returns is tested in demo/tests/Editor/EditorHtmlPolicyTest.php.
     *
     * @return array{html: string}
     */
    private function editor(): array
    {
        $value = '<p style="color:red" class="x" id="y" data-controller="z" onmouseover="x()">attributes</p><script>x()</script><style>p{}</style><img src=x onerror=x()><svg onload=x()></svg><math><mi>x</mi></math><iframe src="/"></iframe><form><input></form>'
            .'<p><a href="javascript:alert(1)">js</a><a href=" jav&#x09;ascript:alert(1)">js2</a><a href="data:text/html,x">data</a><a href="vbscript:x">vb</a><a href="https://example.com" target="_blank" rel="opener" onclick="x()">target</a></p>';

        return [
            'html' => $this->render('<twig:Editor id="hostile-editor" name="body" label="Body" :value="value" data-testid="editor" />', ['value' => $value]),
        ];
    }

    /**
     * The MarkdownEditor component given a hostile value, for the browser to parse. What the renderer itself returns is
     * tested in demo/tests/MarkdownEditor/MarkdownRendererTest.php.
     *
     * @return array{html: string}
     */
    private function markdown(): array
    {
        return [
            'html' => $this->render('<twig:MarkdownEditor id="hostile-markdown" name="body" label="Body" :value="value" data-testid="markdown" />', ['value' => '</textarea><script>window.__xss=1</script><img src=x onerror="window.__xss=1">']),
        ];
    }

    /**
     * @return list<array{component: string, input: string, expected: string, html: string}>
     */
    private function tags(): array
    {
        $cases = [];
        foreach (self::TAG_COMPONENTS as $component => [$default, $allowed, $markup]) {
            $values = array_map(static fn (mixed $value): array => [$value, $default], self::hostileTags());
            foreach ($allowed as $tag) {
                $values[] = [$tag, $tag];
                $values[] = [strtoupper($tag), $tag];
            }
            $values[] = [self::stringable($allowed[1]), $allowed[1]];

            foreach ($values as [$value, $expected]) {
                $cases[] = ['component' => $component, 'input' => self::describe($value), 'expected' => $expected, 'html' => $this->render(\sprintf($markup, ':as="value"'), ['value' => $value])];
            }
            // a spread reaches `as` too: the form theme spreads row_attr after as="fieldset"
            foreach (['img src=x onerror=alert(document.domain)', 'script'] as $value) {
                $cases[] = ['component' => $component, 'input' => 'spread '.self::describe($value), 'expected' => $default, 'html' => $this->render(\sprintf($markup, '{{ ...{as: value} }}'), ['value' => $value])];
            }
        }

        return $cases;
    }

    /**
     * @return array{html: string}
     */
    private function calendar(): array
    {
        $hostile = ['2026-13-45', '2026-02-30', '2026-3-12', 'x onmouseover=window.__xss=1', '"><svg onload=window.__xss=1>', '2026-03-12'];
        $names = array_keys(self::LABEL_ATTRIBUTES);

        return ['html' => $this->render(self::CALENDAR, [
            'selected' => $hostile,
            'month' => '"><svg onload=window.__xss=1>',
            'modifiers' => array_fill_keys($names, ['2026-03-12']) + ['booked' => ['2026-03-12', '2026-13-45']],
            'inputAttr' => self::LABEL_ATTRIBUTES + ['form' => 'booking', 'type' => 'text', 'name' => 'evil', 'value' => 'evil', 'onchange' => 'window.__xss=1', 'OnInput' => 'window.__xss=1'],
        ])];
    }

    /**
     * @return array{expected: array<string, string>, absent: list<string>, html: string}
     */
    private function attributes(): array
    {
        return [
            'expected' => ['data-test' => 'ok', 'title' => 'Hint', '@click' => 'go', 'x-on:click.prevent' => 'go', 'data-flag' => ''],
            'absent' => ['hidden', 'autofocus', 'tabindex'],
            'html' => $this->render(
                '<twig:FormField for="field" label="Label" help="Help" :labelAttr="value" :helpAttr="value"><input id="field"></twig:FormField>',
                ['value' => self::LABEL_ATTRIBUTES],
            ),
        ];
    }

    /**
     * @return list<array{component: string, prop: string, link: string, input: string, text: string, hostile: bool, html: string}>
     */
    private function urls(): array
    {
        $values = array_merge(
            array_map(static fn (mixed $value): array => [$value, true], self::hostileUrls()),
            array_map(static fn (mixed $value): array => [$value, false], self::ordinaryUrls()),
        );

        $cases = [];
        foreach (self::URL_PROPS as [$component, $prop, $markup, $link, $formRecipe]) {
            foreach ($values as [$value, $hostile]) {
                $context = ['value' => $value] + (null === $formRecipe ? [] : $this->forms->contextFor($formRecipe));
                $cases[] = [
                    'component' => $component,
                    'prop' => $prop,
                    'link' => $link,
                    'input' => self::describe($value),
                    // the URL as text: what the browser must read, whatever the type of the value
                    'text' => (string) $value,
                    'hostile' => $hostile,
                    'html' => $this->render($markup, $context),
                ];
            }
        }

        return $cases;
    }

    /**
     * @return list<array{component: string, prop: string, input: string, text: string, html: string}>
     */
    private function images(): array
    {
        $values = [...self::hostileUrls(), ...self::ordinaryUrls()];
        $cases = [];
        foreach (self::IMAGE_PROPS as [$component, $prop, $markup]) {
            foreach ($values as $value) {
                $cases[] = [
                    'component' => $component,
                    'prop' => $prop,
                    'input' => self::describe($value),
                    'text' => (string) $value,
                    'html' => $this->render($markup, ['value' => $value]),
                ];
            }
        }

        return $cases;
    }

    /**
     * Every component whose template reads the attributes given to it, rendered with inline event handlers next to
     * ordinary attributes; `bag` is false for the two that take only `class` from them.
     *
     * @return array{cases: list<array{component: string, bag: bool, html: string}>, legit: list<array{component: string, expected: array<string, string>, html: string}>}
     */
    private function handlers(): array
    {
        $templates = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($this->components, \FilesystemIterator::SKIP_DOTS)) as $file) {
            $path = $file->getPathname();
            if (str_ends_with($path, '.html.twig') && str_contains((string) file_get_contents($path), 'attributes')) {
                $templates[] = str_replace(\DIRECTORY_SEPARATOR, ':', substr($path, \strlen($this->components) + 1, -\strlen('.html.twig')));
            }
        }
        sort($templates);
        $cases = [];
        foreach ($templates as $component) {
            [$markup, $recipe] = self::HANDLER_MARKUP[$component] ?? ['<twig:%1$s %2$s>Text</twig:%1$s>', null];
            $cases[] = [
                'component' => $component,
                'bag' => !\in_array($component, ['Drawer:Content', 'Modal:Content'], true),
                'html' => $this->render(\sprintf($markup, $component, '{{ ...handlers }}'), ['handlers' => self::HANDLERS] + (null === $recipe ? [] : $this->forms->contextFor($recipe))),
            ];
        }
        $legit = [];
        foreach (self::LEGIT_MARKUP as $component => $markup) {
            // Pagination:Link takes its class from `active` alone
            $expected = 'Pagination:Link' === $component ? array_diff_key(self::LEGIT, ['class' => true]) : self::LEGIT;
            $legit[] = ['component' => $component, 'expected' => $expected, 'html' => $this->render($markup, ['handlers' => self::HANDLERS + self::LEGIT])];
        }

        return ['cases' => $cases, 'legit' => $legit];
    }

    /**
     * `as` values that must render the default tag: the audit's payload, event handlers, elements that run or
     * swallow their content, near misses, and values that are not strings.
     *
     * @return list<mixed>
     */
    private static function hostileTags(): array
    {
        return [
            'img src=x onerror=alert(document.domain)',
            'img src=x onerror=window.__xss=1',
            'svg onload=window.__xss=1',
            "div\tonmouseover=window.__xss=1",
            "div\nonmouseover=window.__xss=1",
            'div/onmouseover=window.__xss=1',
            'a href=javascript:window.__xss=1',
            'button autofocus onfocus=window.__xss=1',
            'script',
            'SCRIPT',
            'sCrIpT',
            'iframe',
            'object',
            'style',
            'textarea',
            'template',
            'form',
            ' a',
            "a\n",
            'h7',
            '',
            true,
            false,
            null,
            1,
            self::stringable('img src=x onerror=window.__xss=1'),
            new Markup('<script>window.__xss=1</script>', 'UTF-8'),
        ];
    }

    /**
     * URLs that are not relative, http(s), mailto or tel once read as browsers do (case, leading C0 controls
     * and spaces, tabs and newlines anywhere), character references, attribute breakouts, other types.
     *
     * @return list<mixed>
     */
    private static function hostileUrls(): array
    {
        return [
            'javascript:alert(document.domain)',
            'JaVaScRiPt:alert(1)',
            'JAVASCRIPT:alert(1)',
            '  javascript:alert(1)',
            "\tjavascript:alert(1)",
            "\n javascript:alert(1)",
            "\x01javascript:alert(1)",
            "\x00javascript:alert(1)",
            "\x1F\x0C javascript:alert(1)",
            "java\tscript:alert(1)",
            "java\nscript:alert(1)",
            "java\rscript:alert(1)",
            "javascript\t:alert(1)",
            "j\na\tv\rascript:alert(1)",
            'javascript://example.com/%0Aalert(1)',
            '&#106;avascript:alert(1)',
            'jav&#x09;ascript:alert(1)',
            'javascript&colon;alert(1)',
            'javascript&#58;alert(1)',
            'vbscript:msgbox(1)',
            'data:text/html,<script>alert(1)</script>',
            'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
            'feed:javascript:alert(1)',
            'foo:bar',
            '" onmouseover="window.__xss=1',
            "' onmouseover='window.__xss=1",
            '"><img src=x onerror=window.__xss=1>',
            self::stringable('javascript:alert(1)'),
            new Markup('&#106;avascript:alert(1)', 'UTF-8'),
            new Markup('javascript&#58;alert(1)', 'UTF-8'),
            new Markup('" onmouseover="window.__xss=1', 'UTF-8'),
        ];
    }

    /**
     * URLs that must render unchanged.
     *
     * @return list<mixed>
     */
    private static function ordinaryUrls(): array
    {
        return [
            '/',
            '/demo/login',
            '?page=2',
            '#dashboard',
            'relative/path',
            './a:b',
            '/a:b',
            '//cdn.example.com/x',
            'https://example.com/a?b=c&d=e#f',
            'HTTP://EXAMPLE.COM/',
            'http://example.com',
            'mailto:team@example.com',
            'MailTo:team@example.com',
            'tel:+15550100',
            42,
            true,
            self::stringable('/from-an-object'),
            new Markup('/a?b=1&c=2', 'UTF-8'),
        ];
    }

    /**
     * @param array<string, mixed> $context
     */
    private function render(string $markup, array $context): string
    {
        return ($this->templates[$markup] ??= $this->twig->createTemplate($markup))->render($context);
    }

    private static function stringable(string $value): \Stringable
    {
        return new class($value) implements \Stringable {
            public function __construct(private readonly string $value)
            {
            }

            public function __toString(): string
            {
                return $this->value;
            }
        };
    }

    private static function describe(mixed $value): string
    {
        return match (true) {
            \is_string($value) => json_encode($value, \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES | \JSON_UNESCAPED_UNICODE),
            $value instanceof Markup => 'Markup '.json_encode((string) $value, \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES),
            $value instanceof \Stringable => 'Stringable '.json_encode((string) $value, \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES),
            default => json_encode($value, \JSON_THROW_ON_ERROR),
        };
    }
}
