<?php

namespace App\Controller;

use App\Demo\OrdersTable;
use App\Form\AutocompleteDemoType;
use App\Form\EditorDemoType;
use App\Form\MarkdownDemoType;
use App\Form\UploadDemoType;
use App\Kit\KitReader;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Validator\Constraints as Assert;
use Symfony\Component\Validator\Validator\ValidatorInterface;
use Symfony\UX\Turbo\TurboBundle;

/**
 * Turbo / Live Component scenario pages (one route per scenario under /lab/), each exercised by
 * tests/e2e/lab.*.spec.ts.
 */
#[Route('/lab', options: ['uxor_security' => 'development-only'])]
final class LabController extends AbstractController
{
    /**
     * Scenario name => description; each scenario gets its own "/lab/<name>" route.
     */
    private const SCENARIOS = [
        'live-dropdown' => 'A Dropdown open while its Live Component re-renders (action and model change).',
        'live-modal' => 'A Modal (<dialog>) across Live re-renders, open and closed.',
        'live-table' => 'A Live table re-sorting rows that hold Dropdowns and Tooltips.',
        'live-form' => 'A form rendered by the form theme in a Live Component: changed fields are validated on the server, focus and typed values survive the re-render.',
        'live-drawer' => 'A modal Drawer across Live re-renders, and a non-modal Drawer beside the page.',
        'turbo-nav' => 'Turbo Drive visits between two pages: a data-turbo-permanent Sidebar keeps its scroll, collapsed state and current item, the theme persists, a flash toast is not duplicated, an Avatar shows its picture.',
        'turbo-stream-toast' => 'A form whose Turbo Stream response appends a Toast to the region: it appears, pauses while hovered, dismisses itself, and focus stays put.',
        'turbo-frame-detail' => 'A list and a detail Turbo Frame holding a Dropdown, reloaded several times.',
        'permanent-plus-live' => 'A Live Component inside a data-turbo-permanent element across Turbo visits.',
        'data-table-live' => 'A Live DataTable: its state in the URL across Turbo visits and Back, rows selected across pages, values the table does not accept normalized; beside it, a Turbo Frame that reloads and a region Turbo Streams replace.',
        'data-table-live-frame' => 'A Live DataTable inside a Turbo Frame that reloads: the reloaded table is live again.',
        'data-table-live-permanent' => 'A Live DataTable inside a data-turbo-permanent element: it keeps its state across Turbo visits.',
        'data-table-live-stream' => 'A Live DataTable replaced and updated by Turbo Streams: it reconnects and starts from the server state.',
        'autocomplete' => 'Autocomplete fields in a Symfony form (one choice, several, a remote search) and the Autocomplete component outside a form, across Turbo visits and Back; a reset button puts back the values rendered (?defaults=1 gives the form some), in the Symfony form and in a form of Autocomplete components, one of them outside it (the form attribute), also without the layouts\' form-reset controller (?bare=1).',
        'autocomplete-frame' => 'An Autocomplete inside a Turbo Frame that reloads.',
        'autocomplete-stream' => 'An Autocomplete replaced by a Turbo Stream.',
        'live-autocomplete' => 'Autocomplete fields in a Live form that re-renders.',
        'popover-turbo' => 'Popovers across Turbo visits and Back: a plain one, a group, one inside a data-turbo-permanent element, one inside a Turbo Frame that reloads, and one whose link steps a frame whose visits are promoted to history (rendered open with ?open=1).',
        'popover-stream' => 'A Popover replaced and updated by Turbo Streams.',
        'live-popover' => 'A Popover open while its Live Component re-renders (action and model change).',
        'tooltip-turbo' => 'Tooltips across Turbo visits, Back and Forward: on the link that visits, on an icon button, inside a data-turbo-permanent element, inside a Turbo Frame that reloads, and on the link of a frame whose visits are promoted to history.',
        'tooltip-stream' => 'A Tooltip replaced and updated by Turbo Streams.',
        'dropdown-turbo' => 'Dropdowns across Turbo visits and Back: a plain one with a link to the other page, one inside a data-turbo-permanent element, one inside a Turbo Frame that its own menu reloads; page two waits for a stylesheet, so Turbo copies page one before its controllers disconnect. Beside a frame whose visits are promoted to history, stepped from a link in the menu or from the page\'s code, the open menu stays open; Back shows it closed.',
        'dropdown-stream' => 'A Dropdown replaced and updated by Turbo Streams while open.',
        'modal-turbo' => 'Modals across Turbo visits and Back: a plain one with a link to the other page, one inside a data-turbo-permanent element, one inside a Turbo Frame that a link in the open modal reloads; page two waits for a stylesheet, so Turbo copies page one before its controllers disconnect. Beside a frame whose visits are promoted to history, stepped from a link in the open modal or from the page\'s code, the open modal stays open; Back shows it closed.',
        'modal-stream' => 'A Modal replaced and updated by Turbo Streams while open.',
        'drawer-turbo' => 'Drawers across Turbo visits and Back: a plain one with a link to the other page, one inside a data-turbo-permanent element, one inside a Turbo Frame that a link in the open drawer reloads; page two waits for a stylesheet, so Turbo copies page one before its controllers disconnect. Beside a frame whose visits are promoted to history, stepped from a link in the open drawer or from the page\'s code, the open drawer stays open; Back shows it closed.',
        'drawer-stream' => 'A Drawer replaced and updated by Turbo Streams while open.',
        'calendar-turbo' => 'Calendars in a GET form (one date, a range, several dates) across Turbo visits and Back, one inside a data-turbo-permanent element, one inside a Turbo Frame that reloads.',
        'calendar-stream' => 'A Calendar replaced and updated by Turbo Streams.',
        'live-calendar' => 'Calendars bound to Live Component properties: a date, a range, bounds and a locale changed by the server.',
        'date-picker-turbo' => 'Date pickers across Turbo visits and Back: one in a GET form, one inside a data-turbo-permanent element, one inside a Turbo Frame that reloads, beside a frame whose visits are promoted to history.',
        'date-picker-stream' => 'A DatePicker replaced and updated by Turbo Streams.',
        'live-date-picker' => 'Date pickers in a Live form through the form theme: each pick reaches the server, and the end date follows the start.',
        'chart-turbo' => 'Charts across Turbo visits and Back: a bar chart, a doughnut in a card, one inside a data-turbo-permanent element, one inside a Turbo Frame that reloads; each follows the theme.',
        'chart-stream' => 'A Chart replaced and updated by Turbo Streams.',
        'live-chart' => 'A Chart in a Live Component whose data changes: the chart updates in place and keeps the theme.',
        'chart-points' => 'Charts whose category data come as points, without labels: vertical bars ({x: label, y: value}) and horizontal bars ({y: label, x: value}); their tables list every label.',
        'dropzone-turbo' => 'Dropzones across Turbo visits and Back (one file, several files), one inside a data-turbo-permanent element, and one in a multipart form inside a Turbo Frame that reloads and submits.',
        'dropzone-stream' => 'A Dropzone replaced and updated by Turbo Streams.',
        'dropzone-events' => 'A Dropzone given a controller of the page: its actions, values and target reach it.',
        'dropzone-form' => 'A Symfony form with DropzoneType fields posted through Turbo (303, or 422 with the errors), next to a Live Component whose re-renders leave the picked files alone.',
        'live-dropzone' => 'Files uploaded from a Live Component through a files action: re-renders leave the picked files alone, and each upload gives a fresh zone.',
        'editor-turbo' => 'Editors across Turbo visits and Back: a Symfony form posted through Turbo (303, or 422 with the errors), one inside a data-turbo-permanent element, one inside a Turbo Frame that reloads.',
        'editor-stream' => 'An Editor replaced and updated by Turbo Streams.',
        'live-editor' => 'An Editor bound to a Live Component property: unrelated re-renders leave the typing alone, a save reads the content, a reset from the server replaces it.',
        'turbo-restore' => 'Overlays left open when a link inside them visits another page, and a tooltip shown on such a link: Back shows them closed and working, also when the next page waits for a new stylesheet (Turbo then caches the page before the controllers disconnect). A toast outside the permanent region is not shown again on Back. Beside a frame whose visits are promoted to history, an open menu and the toast stay on screen; Back shows the menu closed and the toast gone.',
        'markdown-turbo' => 'Markdown editors across Turbo visits and Back: a Symfony form posted through Turbo (303, or 422 with the errors), one inside a data-turbo-permanent element, one inside a Turbo Frame that reloads.',
        'markdown-stream' => 'A MarkdownEditor replaced and updated by Turbo Streams.',
        'form-back' => 'What Back shows in a form, a GET one (/lab/form-back/get) and a POST one (/lab/form-back/post), each with a text field, an Autocomplete and a DatePicker rendered with the values of the URL: after a Turbo visit and Back, the GET form shows the values of the URL, the POST form what was typed and picked.',
        'data-table-frame' => 'A DataTable in its Turbo Frame: search, filter, sort, page and page size each add a history entry that Back and Forward walk through, in the same document.',
        'side-nav' => 'A multi-level SideNav across Turbo visits, Back and reloads: the open branches hold, the branch of the current page opens, and the keyboard moves through the tree.',
        'section-nav' => 'A SectionNav (one page per section) across Turbo visits, Back, Forward and reloads, rendered by each page and inside a data-turbo-permanent element; next to vertical Tabs that switch panels in place, with the keyboard of the tabs pattern.',
        'mobile-nav' => 'A MobileNav holding a SideNav, the same tree beside the page on wide screens: the drawer opens from the menu button and closes on Escape, the backdrop, a link, Turbo visits, Back and Forward; the two trees share their open branches.',
        'value-matrix' => 'The value matrix (tests/e2e/lab.value-matrix.spec.ts): every widget holding a value or a state the user changes (the fields of a GET and of a POST form, autocomplete, date picker, calendar, editor, Markdown editor, dropzone, tabs, the overlays, a tree, the theme toggle), four times on each page: rendered by the page, in a Turbo Frame that reloads, in a region Turbo Streams replace and update, and inside a data-turbo-permanent element.',
        'live-values' => 'The value matrix\'s widgets in a Live Component: a server action sets every property, which each widget then shows; the open overlays, the selected tab, the open branch and the focus stay.',
        'nav-menu' => 'A Navbar whose NavMenu opens submenus, nested two levels deep, as a disclosure navigation; the same menu in a MobileNav on small screens, and a second one in a data-turbo-permanent Navbar: the current page and its submenus are marked, the keyboard, a click outside and Turbo visits, Back and Forward close them.',
    ];

    private const ITEMS = ['apple' => 'Apple', 'banana' => 'Banana', 'cherry' => 'Cherry'];

    public function __construct(
        private readonly KitReader $kit,
    ) {
    }

    #[Route('', name: 'app_lab')]
    public function index(): Response
    {
        return $this->render('lab/index.html.twig', ['scenarios' => self::SCENARIOS]);
    }

    #[Route('/live-dropdown', name: 'app_lab_live_dropdown')]
    #[Route('/live-modal', name: 'app_lab_live_modal')]
    #[Route('/live-table', name: 'app_lab_live_table')]
    #[Route('/live-drawer', name: 'app_lab_live_drawer')]
    #[Route('/live-form', name: 'app_lab_live_form')]
    #[Route('/live-date-picker', name: 'app_lab_live_date_picker')]
    #[Route('/live-calendar', name: 'app_lab_live_calendar')]
    #[Route('/live-popover', name: 'app_lab_live_popover')]
    #[Route('/live-autocomplete', name: 'app_lab_live_autocomplete')]
    #[Route('/live-chart', name: 'app_lab_live_chart')]
    #[Route('/live-dropzone', name: 'app_lab_live_dropzone')]
    #[Route('/live-editor', name: 'app_lab_live_editor')]
    #[Route('/live-values', name: 'app_lab_live_values')]
    public function live(string $_route): Response
    {
        $name = str_replace('_', '-', substr($_route, \strlen('app_lab_')));

        return $this->render('lab/live.html.twig', [
            'name' => $name,
            'description' => self::SCENARIOS[$name],
            'component' => 'Lab:'.str_replace(' ', '', ucwords(str_replace('-', ' ', $name))),
        ]);
    }

    #[Route('/turbo-nav/{page}', name: 'app_lab_turbo_nav', requirements: ['page' => 'one|two'], defaults: ['page' => 'one'])]
    public function turboNav(string $page): Response
    {
        return $this->render('lab/turbo_nav.html.twig', [
            'page' => $page,
            'description' => self::SCENARIOS['turbo-nav'],
            'recipes' => $this->kit->getRecipes(),
        ]);
    }

    #[Route('/turbo-restore/{page}', name: 'app_lab_turbo_restore', requirements: ['page' => 'one|two'], defaults: ['page' => 'one'])]
    public function turboRestore(Request $request, string $page): Response
    {
        return $this->render('lab/turbo_restore.html.twig', [
            'page' => $page,
            'step' => $request->query->getInt('step'),
            'description' => self::SCENARIOS['turbo-restore'],
        ]);
    }

    #[Route('/turbo-nav/save', name: 'app_lab_turbo_nav_save', methods: ['POST'])]
    public function turboNavSave(): Response
    {
        $this->addFlash('success', 'Settings saved.');

        return $this->redirectToRoute('app_lab_turbo_nav', ['page' => 'two'], Response::HTTP_SEE_OTHER);
    }

    #[Route('/turbo-stream-toast', name: 'app_lab_turbo_stream_toast', methods: ['GET', 'POST'])]
    public function turboStreamToast(Request $request): Response
    {
        if ($request->isMethod('POST')) {
            $request->setRequestFormat(TurboBundle::STREAM_FORMAT);

            return $this->render('lab/turbo_stream_toast.stream.html.twig', [
                'count' => $request->request->getInt('count') + 1,
                'timeout' => max(0, $request->request->getInt('timeout', 5000)),
            ]);
        }

        return $this->render('lab/turbo_stream_toast.html.twig', ['description' => self::SCENARIOS['turbo-stream-toast']]);
    }

    #[Route('/turbo-frame-detail/{item}', name: 'app_lab_turbo_frame_detail', defaults: ['item' => null])]
    public function turboFrameDetail(?string $item): Response
    {
        if (null !== $item && !isset(self::ITEMS[$item])) {
            throw $this->createNotFoundException();
        }

        return $this->render('lab/turbo_frame_detail.html.twig', [
            'items' => self::ITEMS,
            'item' => $item,
            'description' => self::SCENARIOS['turbo-frame-detail'],
        ]);
    }

    #[Route('/permanent-plus-live/{page}', name: 'app_lab_permanent_plus_live', requirements: ['page' => 'one|two'], defaults: ['page' => 'one'])]
    public function permanentPlusLive(string $page): Response
    {
        return $this->render('lab/permanent_plus_live.html.twig', ['page' => $page, 'description' => self::SCENARIOS['permanent-plus-live']]);
    }

    #[Route('/form-back/{method}', name: 'app_lab_form_back', requirements: ['method' => 'get|post'], defaults: ['method' => 'get'], methods: ['GET', 'POST'])]
    public function formBack(Request $request, string $method): Response
    {
        $fields = ['name', 'fruit', 'due'];
        // the POST form's submit: back to the page, rendered with the values sent
        if ($request->isMethod('POST')) {
            $sent = array_map(static fn (string $field): string => $request->request->getString($field), array_combine($fields, $fields));

            return $this->redirectToRoute('app_lab_form_back', ['method' => $method, ...array_filter($sent)], Response::HTTP_SEE_OTHER);
        }

        return $this->render('lab/form_back.html.twig', [
            'method' => $method,
            'page' => 'two' === $request->query->getString('page') ? 'two' : 'one',
            'values' => array_map(static fn (string $field): string => $request->query->getString($field), array_combine($fields, $fields)),
            'description' => self::SCENARIOS['form-back'],
        ]);
    }

    #[Route('/value-matrix/{page}', name: 'app_lab_value_matrix', requirements: ['page' => 'one|two'], defaults: ['page' => 'one'], methods: ['GET', 'POST'])]
    public function valueMatrix(Request $request, string $page): Response
    {
        // one widget alone (`?only=get-name`), as each test of the matrix loads it; a key the templates do not know shows none
        $only = $request->isMethod('POST') ? $request->request->getString('only') : $request->query->getString('only');
        $only = 1 === preg_match('/^[a-z-]{1,20}$/', $only) ? $only : '';
        // the stream buttons: the streamed region rendered anew, replaced or updated
        if ($request->isMethod('POST')) {
            $request->setRequestFormat(TurboBundle::STREAM_FORMAT);

            return $this->render('lab/value_matrix.stream.html.twig', [
                'page' => $page,
                'only' => $only,
                'action' => 'update' === $request->request->get('action') ? 'update' : 'replace',
            ]);
        }

        return $this->render('lab/value_matrix.html.twig', [
            'page' => $page,
            'only' => $only,
            'load' => $request->query->getInt('load'),
            'description' => self::SCENARIOS['value-matrix'],
        ]);
    }

    #[Route('/data-table-frame', name: 'app_lab_data_table_frame')]
    public function dataTableFrame(Request $request, OrdersTable $orders): Response
    {
        return $this->render('lab/data_table_frame.html.twig', [
            'table' => $orders->handleRequest($request),
            'description' => self::SCENARIOS['data-table-frame'],
        ]);
    }

    #[Route('/data-table-live', name: 'app_lab_data_table_live', methods: ['GET', 'POST'])]
    public function dataTableLive(Request $request): Response
    {
        // the region beside the table, replaced or updated by a Turbo Stream
        if ($request->isMethod('POST')) {
            $request->setRequestFormat(TurboBundle::STREAM_FORMAT);

            return $this->render('lab/data_table_live.stream.html.twig', [
                'action' => 'update' === $request->request->get('action') ? 'update' : 'replace',
            ]);
        }

        return $this->render('lab/data_table_live.html.twig', [
            'description' => self::SCENARIOS['data-table-live'],
            'load' => $request->query->getInt('load'),
        ]);
    }

    #[Route('/data-table-live-frame', name: 'app_lab_data_table_live_frame')]
    public function dataTableLiveFrame(Request $request): Response
    {
        return $this->render('lab/data_table_live_frame.html.twig', [
            'description' => self::SCENARIOS['data-table-live-frame'],
            'load' => $request->query->getInt('load'),
        ]);
    }

    #[Route('/data-table-live-permanent/{page}', name: 'app_lab_data_table_live_permanent', requirements: ['page' => 'one|two'], defaults: ['page' => 'one'])]
    public function dataTableLivePermanent(string $page): Response
    {
        return $this->render('lab/data_table_live_permanent.html.twig', ['page' => $page, 'description' => self::SCENARIOS['data-table-live-permanent']]);
    }

    #[Route('/data-table-live-stream', name: 'app_lab_data_table_live_stream', methods: ['GET', 'POST'])]
    public function dataTableLiveStream(Request $request): Response
    {
        if ($request->isMethod('POST')) {
            $request->setRequestFormat(TurboBundle::STREAM_FORMAT);

            return $this->render('lab/data_table_live_stream.stream.html.twig', [
                'action' => 'update' === $request->request->get('action') ? 'update' : 'replace',
            ]);
        }

        return $this->render('lab/data_table_live_stream.html.twig', ['description' => self::SCENARIOS['data-table-live-stream']]);
    }

    #[Route('/autocomplete', name: 'app_lab_autocomplete', methods: ['GET', 'POST'])]
    public function autocomplete(Request $request): Response
    {
        // ?defaults=1: the fields rendered with values, which a reset of the form puts back
        $form = $this->createForm(AutocompleteDemoType::class, $request->query->getBoolean('defaults') ? ['country' => 'FR', 'languages' => ['en', 'fr']] : null);
        $form->handleRequest($request);
        if ($form->isSubmitted() && $form->isValid()) {
            $data = $form->getData();

            return $this->redirectToRoute('app_lab_autocomplete', ['submitted' => \sprintf('%s; %s; %s', $data['country'], implode(',', $data['languages']), $data['customer'] ?? '-')], Response::HTTP_SEE_OTHER);
        }

        return $this->render('lab/autocomplete.html.twig', [
            'form' => $form,
            'submitted' => $request->query->getString('submitted'),
            // ?bare=1: the page without the layouts' form-reset controller on <body>
            'form_reset' => !$request->query->getBoolean('bare'),
            'description' => self::SCENARIOS['autocomplete'],
        ], new Response(null, $form->isSubmitted() ? 422 : 200));
    }

    #[Route('/autocomplete-frame', name: 'app_lab_autocomplete_frame')]
    public function autocompleteFrame(Request $request): Response
    {
        return $this->render('lab/autocomplete_frame.html.twig', ['load' => $request->query->getInt('load'), 'description' => self::SCENARIOS['autocomplete-frame']]);
    }

    #[Route('/autocomplete-stream', name: 'app_lab_autocomplete_stream', methods: ['GET', 'POST'])]
    public function autocompleteStream(Request $request): Response
    {
        if ($request->isMethod('POST')) {
            $request->setRequestFormat(TurboBundle::STREAM_FORMAT);

            return $this->render('lab/autocomplete_stream.stream.html.twig', ['count' => 1]);
        }

        return $this->render('lab/autocomplete_stream.html.twig', ['description' => self::SCENARIOS['autocomplete-stream']]);
    }

    #[Route('/popover-turbo/{page}', name: 'app_lab_popover_turbo', requirements: ['page' => 'one|two'], defaults: ['page' => 'one'])]
    public function popoverTurbo(Request $request, string $page): Response
    {
        return $this->render('lab/popover_turbo.html.twig', [
            'page' => $page,
            'load' => $request->query->getInt('load'),
            'step' => $request->query->getInt('step'),
            'open' => $request->query->getBoolean('open'),
            'description' => self::SCENARIOS['popover-turbo'],
        ]);
    }

    #[Route('/tooltip-turbo/{page}', name: 'app_lab_tooltip_turbo', requirements: ['page' => 'one|two'], defaults: ['page' => 'one'])]
    public function tooltipTurbo(Request $request, string $page): Response
    {
        return $this->render('lab/tooltip_turbo.html.twig', [
            'page' => $page,
            'load' => $request->query->getInt('load'),
            'step' => $request->query->getInt('step'),
            'description' => self::SCENARIOS['tooltip-turbo'],
        ]);
    }

    #[Route('/tooltip-stream', name: 'app_lab_tooltip_stream', methods: ['GET', 'POST'])]
    public function tooltipStream(Request $request): Response
    {
        if ($request->isMethod('POST')) {
            $request->setRequestFormat(TurboBundle::STREAM_FORMAT);

            return $this->render('lab/tooltip_stream.stream.html.twig', [
                'action' => 'update' === $request->request->get('action') ? 'update' : 'replace',
            ]);
        }

        return $this->render('lab/tooltip_stream.html.twig', ['description' => self::SCENARIOS['tooltip-stream']]);
    }

    #[Route('/dropdown-turbo/{page}', name: 'app_lab_dropdown_turbo', requirements: ['page' => 'one|two'], defaults: ['page' => 'one'])]
    #[Route('/modal-turbo/{page}', name: 'app_lab_modal_turbo', requirements: ['page' => 'one|two'], defaults: ['page' => 'one'])]
    #[Route('/drawer-turbo/{page}', name: 'app_lab_drawer_turbo', requirements: ['page' => 'one|two'], defaults: ['page' => 'one'])]
    public function overlayTurbo(Request $request, string $page, string $_route): Response
    {
        $name = str_replace('_', '-', substr($_route, \strlen('app_lab_')));

        return $this->render(\sprintf('lab/%s.html.twig', str_replace('-', '_', $name)), [
            'page' => $page,
            'load' => $request->query->getInt('load'),
            'step' => $request->query->getInt('step'),
            'description' => self::SCENARIOS[$name],
        ]);
    }

    #[Route('/dropdown-stream', name: 'app_lab_dropdown_stream', methods: ['GET', 'POST'])]
    #[Route('/modal-stream', name: 'app_lab_modal_stream', methods: ['GET', 'POST'])]
    #[Route('/drawer-stream', name: 'app_lab_drawer_stream', methods: ['GET', 'POST'])]
    public function overlayStream(Request $request, string $_route): Response
    {
        $name = str_replace('_', '-', substr($_route, \strlen('app_lab_')));
        $template = str_replace('-', '_', $name);
        if ($request->isMethod('POST')) {
            $request->setRequestFormat(TurboBundle::STREAM_FORMAT);

            return $this->render(\sprintf('lab/%s.stream.html.twig', $template), [
                'action' => 'update' === $request->request->get('action') ? 'update' : 'replace',
            ]);
        }

        return $this->render(\sprintf('lab/%s.html.twig', $template), ['description' => self::SCENARIOS[$name]]);
    }

    #[Route('/side-nav/{page}', name: 'app_lab_side_nav', requirements: ['page' => 'one|two|three|four'], defaults: ['page' => 'one'])]
    public function sideNav(string $page): Response
    {
        return $this->render('lab/side_nav.html.twig', ['page' => $page, 'description' => self::SCENARIOS['side-nav']]);
    }

    #[Route('/section-nav/{page}', name: 'app_lab_section_nav', requirements: ['page' => 'profile|account|notifications|billing|security|integrations'], defaults: ['page' => 'profile'])]
    public function sectionNav(string $page): Response
    {
        return $this->render('lab/section_nav.html.twig', ['page' => $page, 'description' => self::SCENARIOS['section-nav']]);
    }

    #[Route('/mobile-nav/{page}', name: 'app_lab_mobile_nav', requirements: ['page' => 'one|two|three'], defaults: ['page' => 'one'])]
    public function mobileNav(string $page): Response
    {
        return $this->render('lab/mobile_nav.html.twig', ['page' => $page, 'description' => self::SCENARIOS['mobile-nav']]);
    }

    #[Route('/nav-menu/{page}', name: 'app_lab_nav_menu', requirements: ['page' => 'one|two|three|four'], defaults: ['page' => 'one'])]
    public function navMenu(string $page): Response
    {
        return $this->render('lab/nav_menu.html.twig', ['page' => $page, 'description' => self::SCENARIOS['nav-menu']]);
    }

    #[Route('/popover-stream', name: 'app_lab_popover_stream', methods: ['GET', 'POST'])]
    public function popoverStream(Request $request): Response
    {
        if ($request->isMethod('POST')) {
            $request->setRequestFormat(TurboBundle::STREAM_FORMAT);

            return $this->render('lab/popover_stream.stream.html.twig', [
                'action' => 'update' === $request->request->get('action') ? 'update' : 'replace',
            ]);
        }

        return $this->render('lab/popover_stream.html.twig', ['description' => self::SCENARIOS['popover-stream']]);
    }

    #[Route('/chart-turbo/{page}', name: 'app_lab_chart_turbo', requirements: ['page' => 'one|two'], defaults: ['page' => 'one'])]
    public function chartTurbo(Request $request, string $page): Response
    {
        return $this->render('lab/chart_turbo.html.twig', [
            'page' => $page,
            'load' => $request->query->getInt('load'),
            'description' => self::SCENARIOS['chart-turbo'],
        ]);
    }

    #[Route('/chart-points', name: 'app_lab_chart_points')]
    public function chartPoints(): Response
    {
        return $this->render('lab/chart_points.html.twig', ['description' => self::SCENARIOS['chart-points']]);
    }

    #[Route('/chart-stream', name: 'app_lab_chart_stream', methods: ['GET', 'POST'])]
    public function chartStream(Request $request): Response
    {
        if ($request->isMethod('POST')) {
            $request->setRequestFormat(TurboBundle::STREAM_FORMAT);

            return $this->render('lab/chart_stream.stream.html.twig', [
                'action' => 'update' === $request->request->get('action') ? 'update' : 'replace',
            ]);
        }

        return $this->render('lab/chart_stream.html.twig', ['description' => self::SCENARIOS['chart-stream']]);
    }

    #[Route('/calendar-turbo/{page}', name: 'app_lab_calendar_turbo', requirements: ['page' => 'one|two'], defaults: ['page' => 'one'])]
    public function calendarTurbo(Request $request, string $page): Response
    {
        $stay = $request->query->all('stay');
        $dates = $request->query->all('dates');

        return $this->render('lab/calendar_turbo.html.twig', [
            'page' => $page,
            'load' => $request->query->getInt('load'),
            'submitted' => $request->query->has('day') ? [
                'day' => $request->query->getString('day'),
                'stay' => implode('..', array_map('strval', [$stay['from'] ?? '', $stay['to'] ?? ''])),
                'dates' => implode(',', array_map('strval', $dates)),
            ] : null,
            'description' => self::SCENARIOS['calendar-turbo'],
        ]);
    }

    #[Route('/calendar-stream', name: 'app_lab_calendar_stream', methods: ['GET', 'POST'])]
    public function calendarStream(Request $request): Response
    {
        if ($request->isMethod('POST')) {
            $request->setRequestFormat(TurboBundle::STREAM_FORMAT);

            return $this->render('lab/calendar_stream.stream.html.twig', [
                'action' => 'update' === $request->request->get('action') ? 'update' : 'replace',
            ]);
        }

        return $this->render('lab/calendar_stream.html.twig', ['description' => self::SCENARIOS['calendar-stream']]);
    }

    #[Route('/date-picker-turbo/{page}', name: 'app_lab_date_picker_turbo', requirements: ['page' => 'one|two'], defaults: ['page' => 'one'])]
    public function datePickerTurbo(Request $request, string $page): Response
    {
        return $this->render('lab/date_picker_turbo.html.twig', [
            'page' => $page,
            'load' => $request->query->getInt('load'),
            'step' => $request->query->getInt('step'),
            'submitted' => $request->query->has('due') ? $request->query->getString('due') : null,
            'description' => self::SCENARIOS['date-picker-turbo'],
        ]);
    }

    #[Route('/date-picker-stream', name: 'app_lab_date_picker_stream', methods: ['GET', 'POST'])]
    public function datePickerStream(Request $request): Response
    {
        if ($request->isMethod('POST')) {
            $request->setRequestFormat(TurboBundle::STREAM_FORMAT);

            return $this->render('lab/date_picker_stream.stream.html.twig', [
                'action' => 'update' === $request->request->get('action') ? 'update' : 'replace',
            ]);
        }

        return $this->render('lab/date_picker_stream.html.twig', ['description' => self::SCENARIOS['date-picker-stream']]);
    }

    #[Route('/dropzone-turbo/{page}', name: 'app_lab_dropzone_turbo', requirements: ['page' => 'one|two'], defaults: ['page' => 'one'], methods: ['GET', 'POST'])]
    public function dropzoneTurbo(Request $request, ValidatorInterface $validator, string $page): Response
    {
        $error = null;
        // the multipart form inside the Turbo Frame: a 303 back into the frame, or a 422 with the error in it
        if ($request->isMethod('POST')) {
            $file = $request->files->get('framed');
            $violations = $validator->validate($file, [new Assert\NotNull(message: 'Choose an image.'), new Assert\Image(maxSize: '1M')]);
            if (0 === \count($violations) && $file instanceof UploadedFile) {
                return $this->redirectToRoute('app_lab_dropzone_turbo', ['page' => $page, 'framed' => $file->getClientOriginalName()], Response::HTTP_SEE_OTHER);
            }
            $error = (string) $violations[0]?->getMessage();
        }

        return $this->render('lab/dropzone_turbo.html.twig', [
            'page' => $page,
            'load' => $request->query->getInt('load'),
            'zones' => max(0, min(20, $request->query->getInt('zones'))),
            'framed' => $request->query->getString('framed'),
            'error' => $error,
            'description' => self::SCENARIOS['dropzone-turbo'],
        ], new Response(null, null === $error ? 200 : 422));
    }

    #[Route('/dropzone-stream', name: 'app_lab_dropzone_stream', methods: ['GET', 'POST'])]
    public function dropzoneStream(Request $request): Response
    {
        if ($request->isMethod('POST')) {
            $request->setRequestFormat(TurboBundle::STREAM_FORMAT);

            return $this->render('lab/dropzone_stream.stream.html.twig', [
                'action' => 'update' === $request->request->get('action') ? 'update' : 'replace',
            ]);
        }

        return $this->render('lab/dropzone_stream.html.twig', ['description' => self::SCENARIOS['dropzone-stream']]);
    }

    #[Route('/dropzone-form', name: 'app_lab_dropzone_form', methods: ['GET', 'POST'])]
    public function dropzoneForm(Request $request): Response
    {
        $form = $this->createForm(UploadDemoType::class);
        $form->handleRequest($request);
        if ($form->isSubmitted() && $form->isValid()) {
            $name = static fn (?UploadedFile $file): string => $file?->getClientOriginalName() ?? '';
            $photo = $form->get('photo')->getData();
            $attachments = $form->get('attachments')->getData() ?? [];

            return $this->redirectToRoute('app_lab_dropzone_form', [
                'submitted' => \sprintf('photo=%s; attachments=%s', $name($photo), implode(',', array_map($name, $attachments))),
            ], Response::HTTP_SEE_OTHER);
        }

        return $this->render('lab/dropzone_form.html.twig', [
            'form' => $form,
            'submitted' => $request->query->getString('submitted'),
            'description' => self::SCENARIOS['dropzone-form'],
        ], new Response(null, $form->isSubmitted() ? 422 : 200));
    }

    #[Route('/dropzone-events', name: 'app_lab_dropzone_events')]
    public function dropzoneEvents(): Response
    {
        return $this->render('lab/dropzone_events.html.twig', ['description' => self::SCENARIOS['dropzone-events']]);
    }

    #[Route('/editor-turbo/{page}', name: 'app_lab_editor_turbo', requirements: ['page' => 'one|two'], defaults: ['page' => 'one'], methods: ['GET', 'POST'])]
    public function editorTurbo(Request $request, string $page): Response
    {
        $form = $this->createForm(EditorDemoType::class);
        $form->handleRequest($request);
        if ($form->isSubmitted() && $form->isValid()) {
            // what the field stored, shown after the redirect
            $request->getSession()->set('lab_editor_body', $form->get('body')->getData());

            return $this->redirectToRoute('app_lab_editor_turbo', ['page' => $page, 'saved' => 1], Response::HTTP_SEE_OTHER);
        }

        return $this->render('lab/editor_turbo.html.twig', [
            'page' => $page,
            'form' => $form,
            'load' => $request->query->getInt('load'),
            'step' => $request->query->getInt('step'),
            'saved' => $request->query->getBoolean('saved') ? $request->getSession()->get('lab_editor_body') : null,
            'description' => self::SCENARIOS['editor-turbo'],
        ], new Response(null, $form->isSubmitted() ? 422 : 200));
    }

    #[Route('/editor-stream', name: 'app_lab_editor_stream', methods: ['GET', 'POST'])]
    public function editorStream(Request $request): Response
    {
        if ($request->isMethod('POST')) {
            $request->setRequestFormat(TurboBundle::STREAM_FORMAT);

            return $this->render('lab/editor_stream.stream.html.twig', [
                'action' => 'update' === $request->request->get('action') ? 'update' : 'replace',
            ]);
        }

        return $this->render('lab/editor_stream.html.twig', ['description' => self::SCENARIOS['editor-stream']]);
    }

    #[Route('/markdown-turbo/{page}', name: 'app_lab_markdown_turbo', requirements: ['page' => 'one|two'], defaults: ['page' => 'one'], methods: ['GET', 'POST'])]
    public function markdownTurbo(Request $request, string $page): Response
    {
        $form = $this->createForm(MarkdownDemoType::class);
        $form->handleRequest($request);
        if ($form->isSubmitted() && $form->isValid()) {
            // what the field stored, shown after the redirect
            $request->getSession()->set('lab_markdown_body', $form->get('body')->getData());

            return $this->redirectToRoute('app_lab_markdown_turbo', ['page' => $page, 'saved' => 1], Response::HTTP_SEE_OTHER);
        }

        return $this->render('lab/markdown_turbo.html.twig', [
            'page' => $page,
            'form' => $form,
            'load' => $request->query->getInt('load'),
            'step' => $request->query->getInt('step'),
            'saved' => $request->query->getBoolean('saved') ? $request->getSession()->get('lab_markdown_body') : null,
            'description' => self::SCENARIOS['markdown-turbo'],
        ], new Response(null, $form->isSubmitted() ? 422 : 200));
    }

    #[Route('/markdown-stream', name: 'app_lab_markdown_stream', methods: ['GET', 'POST'])]
    public function markdownStream(Request $request): Response
    {
        if ($request->isMethod('POST')) {
            $request->setRequestFormat(TurboBundle::STREAM_FORMAT);

            return $this->render('lab/markdown_stream.stream.html.twig', [
                'action' => 'update' === $request->request->get('action') ? 'update' : 'replace',
            ]);
        }

        return $this->render('lab/markdown_stream.html.twig', ['description' => self::SCENARIOS['markdown-stream']]);
    }
}
