# Mate 1.0 beta in the UXor consumer

Can an application discover and use UXor after moving its development tools from Mate 0.14 to 1.0.0-BETA1?

Run `packages/uxor/dev/check-mate-beta.sh` from a checkout with PHP 8.4 or later, Composer, Bash and jq. It copies the package and the locked Symfony 7.4 development consumer into a temporary directory, pins Mate, its Symfony extension and its Composer plugin to the beta there, and runs discovery with the plugin enabled. It removes that installation on exit.

On November 18, 2026, all seven UXor tool schemas were discoverable. A component lookup returned the packaged Button reference and a bounded workflow read returned a continuation at byte 64. The native metadata tool preserved its explicit trust check when called with default arguments. Mate installed and validated the build, setup and verify skills from the UXor package. [Mate documentation](https://symfony.com/doc/current/ai/components/mate.html)

This supports testing the next release candidate in the consumer. Keep the existing supported constraints until the final release is tested against both the package and a consumer upgrade. The trial covers a fresh installation of the beta and representative calls. An application's existing generated instructions and local skill overrides need an in-place upgrade test before broadening support.
