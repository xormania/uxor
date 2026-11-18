<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\EventStreamResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\ServerEvent;
use Symfony\Component\Routing\Attribute\Route;

final class RevenueAssistantController extends AbstractController
{
    private const REQUESTS = [
        'show weekly revenue' => 'week',
        'show yearly revenue' => 'year',
        'show all-time revenue' => 'all',
    ];

    private const UNKNOWN_REQUEST = 'Choose weekly, yearly or all-time revenue using one of the example requests.';

    #[Route('/demo/revenue-assistant', name: 'app_demo_revenue_assistant', methods: ['GET'], options: ['uxor_security' => 'public-reference'])]
    public function __invoke(Request $request): Response
    {
        $prompt = $request->query->getString('prompt');
        $period = self::REQUESTS[strtolower(trim($prompt))] ?? null;

        if (\in_array('text/event-stream', $request->getAcceptableContentTypes(), true)) {
            $run = ['threadId' => 'revenue-demo', 'runId' => bin2hex(random_bytes(8))];

            return new EventStreamResponse(static function () use ($period, $run): \Generator {
                yield new ServerEvent(json_encode(['type' => 'RUN_STARTED', ...$run], \JSON_THROW_ON_ERROR));
                if (null === $period) {
                    yield new ServerEvent(json_encode(['type' => 'RUN_ERROR', 'message' => self::UNKNOWN_REQUEST], \JSON_THROW_ON_ERROR));

                    return;
                }
                yield new ServerEvent(json_encode(['type' => 'STATE_SNAPSHOT', 'snapshot' => ['revenuePeriod' => $period]], \JSON_THROW_ON_ERROR));
                yield new ServerEvent(json_encode(['type' => 'RUN_FINISHED', ...$run], \JSON_THROW_ON_ERROR));
            }, headers: ['Vary' => 'Accept']);
        }

        if (null !== $period) {
            $response = $this->redirectToRoute('app_demo', ['revenue' => $period]);
        } else {
            $invalid = $request->query->has('prompt');
            $response = $this->render('demo_app/revenue_assistant.html.twig', [
                'error' => $invalid ? self::UNKNOWN_REQUEST : '',
            ], new Response(status: $invalid ? Response::HTTP_UNPROCESSABLE_ENTITY : Response::HTTP_OK));
        }
        $response->setVary('Accept', false);

        return $response;
    }
}
