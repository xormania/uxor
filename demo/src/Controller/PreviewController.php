<?php

namespace App\Controller;

use App\Kit\KitReader;
use App\Kit\PreviewForms;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\MapQueryParameter;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\UX\Toolkit\Recipe\RecipeType;
use Twig\Environment;

/**
 * Renders one README example of a recipe alone on a page, like the UX Toolkit's own preview app
 * (symfony/ux apps/toolkit), so screenshots can be compared with the upstream ones.
 *
 * The example is Twig code from the repository, compiled and run with the app's services: trusted code
 * (CONTRIBUTING.md, *Setup*). A request only picks a recipe and an example among those KitReader finds.
 */
#[Route(options: ['uxor_security' => 'trusted-code-preview'])]
final class PreviewController extends AbstractController
{
    private const THEMES = ['light', 'dark'];

    #[Route('/preview/{recipe}/{example}', name: 'app_preview', requirements: ['recipe' => '[a-z0-9][a-z0-9-]*', 'example' => '[a-z0-9][a-z0-9-]*'], methods: ['GET'])]
    public function __invoke(
        string $recipe,
        string $example,
        KitReader $kit,
        PreviewForms $forms,
        Environment $twig,
        #[MapQueryParameter]
        string $theme = 'light',
    ): Response {
        if (!\in_array($theme, self::THEMES, true)) {
            throw new NotFoundHttpException(\sprintf('Unknown theme "%s".', $theme));
        }

        $recipeObject = $kit->getRecipe($recipe) ?? throw new NotFoundHttpException(\sprintf('Unknown recipe "%s".', $recipe));
        $code = $kit->getExample($recipe, $example)['code'] ?? throw new NotFoundHttpException(\sprintf('Unknown example "%s" of recipe "%s".', $example, $recipe));

        $template = $twig->createTemplate($code);
        // Twig's random() draws from mt_rand(): a fixed seed keeps screenshots stable (as upstream does).
        mt_srand(0);

        return $this->render('preview.html.twig', [
            'title' => \sprintf('%s / %s', $recipe, $example),
            'theme' => $theme,
            'is_block' => RecipeType::Block === $recipeObject->manifest->type,
            'html' => $template->render($forms->contextFor($recipe)),
        ]);
    }
}
