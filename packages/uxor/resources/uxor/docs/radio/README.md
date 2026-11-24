# Radio

A themed radio button. Give the buttons in a group the same `name` so the user can select one option.

```twig {"preview":true}
<div class="flex flex-col gap-3">
    <div class="flex items-center mb-4">
        <twig:Radio id="default" value="" name="radio-default"/>
        <label for="default" class="ms-2 select-none text-sm font-medium text-heading">Default radio</label>
    </div>

    <div class="flex items-center mb-4">
        <twig:Radio id="checked" value="" name="radio-default" checked/>
        <label for="checked" class="ms-2 select-none text-sm font-medium text-heading">Checked state</label>
    </div>
</div>
```

## Installation

::: installation

[Find this recipe in the latest published catalog](https://xormania.github.io/uxor/?recipe=radio#recipes). To install `radio` from this revision, follow the [kit installation guide](../INSTALL.md#choosing-a-revision). With the Composer dev package, `vendor/bin/uxor component radio --format=json` reads the bundled recipe manifest offline. <!-- recipe-source-note -->

## Usage

```twig
<twig:Radio />
```

## Examples

### Disabled

This example can be used for the disabled state of the radio component by applying the disabled attribute to the input element.

For this example, install the [label](../label/README.md) recipe.

```twig {"preview":true}
<div class="flex flex-col gap-3">
    <div class="flex items-center mb-4">
        <twig:Radio id="default" value="" name="radio-disabled" disabled/>
        <twig:Label for="default" class="select-none ms-2 font-medium text-fg-disabled">Default radio</twig:Label>
    </div>

    <div class="flex items-center mb-4">
        <twig:Radio id="checked" value="" name="radio-disabled" checked disabled/>
        <twig:Label for="checked" class="select-none ms-2 font-medium text-fg-disabled">Checked state</twig:Label>
    </div>
</div>
```

### Bordered

This example can be used to create a radio component with a bordered style, a description text and an icon.

For this example, install the [label](../label/README.md) recipe and run `composer require symfony/ux-icons`.

```twig {"preview":true}
<div class="grid gap-6 md:grid-cols-2">

    <div class="flex items-center mb-4">
        <twig:Label for="default" class="flex justify-between space-x-2.5 bg-neutral-primary-soft border border-default rounded-base shadow-xs">
            <div class="p-4">
                <twig:ux:icon name="flowbite:server-outline" class="w-7 h-7 text-body mb-1.5" aria-hidden="true" />
                <p class="select-none w-full text-sm font-medium text-heading">16GB unified memory</p>
                <p class="select-none text-sm text-body">Seamlessly handle multitasking, large apps.</p>
            </div>
            <twig:Radio id="default" value="default" class="mt-4 me-4" name="radio-bordered"/>
        </twig:Label>
    </div>

    <div class="flex items-center mb-4">
        <twig:Label for="checked" class="flex justify-between space-x-2.5 bg-neutral-primary-soft border border-default rounded-base shadow-xs">
            <div class="p-4">
                <twig:ux:icon name="flowbite:database-outline" class="w-7 h-7 text-body mb-1.5" aria-hidden="true" />
                <p class="select-none w-full text-sm font-medium text-heading">1TB SSD storage</p>
                <p class="select-none text-sm text-body">Get ultra-fast storage with 1TB of SSD space</p>
            </div>
            <twig:Radio id="checked" value="checked" class="mt-4 me-4" name="radio-bordered" checked/>
        </twig:Label>
    </div>
</div>
```

## API Reference

::: api-reference
