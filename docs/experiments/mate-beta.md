# Mate 1.0 beta in the UXor consumer

The Composer development package and its Symfony 8.1 consumer use Mate 1.0.0-BETA1. The demo uses Mate 0.14.

Run `packages/uxor/dev/check-mate-beta.sh` from a checkout with PHP 8.4 or later, Composer, Bash and jq. It installs
the development consumer from its lockfile in a disposable directory, checks the three installed Beta 1 versions
and runs explicit Mate discovery and CLI calls there.

For regular development, `python3 packages/uxor/dev/run.py --native prepare` installs the same locked consumer in
the checkout.

In the initial Symfony 7.4 trial on November 18, 2026, all seven UXor tool schemas were discoverable. A component lookup returned the packaged Button reference and a bounded workflow read returned a continuation at byte 64. The native metadata tool preserved its explicit trust check when called with default arguments. Mate installed and validated the build, setup and verify skills from the UXor package. [Mate documentation](https://symfony.com/doc/current/ai/components/mate.html)

The probe covers discovery and representative calls. Existing generated instructions and local skill overrides
remain important for in-place upgrade checks. [Package installation and update instructions](../../packages/uxor/README.md)
