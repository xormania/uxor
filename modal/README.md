# Modal

Use the modal component to show interactive dialogs and notifications to your website users available in multiple sizes, colors, and styles

```twig {"preview":true}
<div class="min-h-76">
    <twig:Modal id="delete_account">
        <twig:Modal:Trigger>
            <twig:Button variant="outline" {{ ...modal_trigger_attrs }}>Open Modal</twig:Button>
        </twig:Modal:Trigger>

        <twig:Modal:Content>
            <twig:Modal:Header>
                <twig:Modal:Title>Edit profile</twig:Modal:Title>
            </twig:Modal:Header>

            <twig:Modal:Body>
                <p class="leading-relaxed text-body">
                    With less than a month to go before the European Union enacts new consumer privacy laws for its citizens, companies around the world are updating their terms of service agreements to comply.
                </p>
                <p class="leading-relaxed text-body">
                    The European Union’s General Data Protection Regulation (G.D.P.R.) goes into effect on May 25 and is meant to ensure a common set of data rights in the European Union. It requires organizations to notify users as soon as possible of high-risk data breaches that could personally affect them.
                </p>
            </twig:Modal:Body>

            <twig:Modal:Footer>
                <twig:Button type="submit">I accept</twig:Button>
                <twig:Modal:Close>
                    <twig:Button variant="outline" {{ ...modal_close_attrs }}>Decline</twig:Button>
                </twig:Modal:Close>
            </twig:Modal:Footer>
        </twig:Modal:Content>
    </twig:Modal>
</div>
```

## Installation

::: installation

## Usage

```twig
<twig:Modal id="delete_account">
    <twig:Modal:Trigger>
        <twig:Button {{ ...modal_trigger_attrs }}>Open</twig:Button>
    </twig:Modal:Trigger>
    <twig:Modal:Content>
        <twig:Modal:Header>
            <twig:Modal:Title>Are you absolutely sure?</twig:Modal:Title>
        </twig:Modal:Header>
    </twig:Modal:Content>
</twig:Modal>
```

In a Live Component, an open modal stays open and modal across a re-render. A re-render that replaces the modal's container (a wrapper whose id changes) moves the `<dialog>` to a new controller: the old one disconnects without an error and the new one keeps the dialog as it is, open or closed, with its own trigger's `aria-expanded` set to match.

The backdrop appears and goes with the dialog, at once: it does not fade, with or without `prefers-reduced-motion`.

Whether a `turbo:before-cache` leaves the modal open (a frame visit promoted to history, a `data-turbo-permanent`
element) is answered by the `turbo` recipe's module (`assets/lib/uxor-turbo.js`), which `ux:install modal`
installs with it.

## Examples

### Static modal

Use the prop `backdrop="static"` to prevent the modal from closing when clicking outside of it. This can be used with situations where you want to force the user to choose an option such as a cookie notice or when taking a survey.

```twig {"preview":true}
<div class="min-h-76">
    <twig:Modal id="delete_account">
        <twig:Modal:Trigger>
            <twig:Button variant="outline" {{ ...modal_trigger_attrs }}>Open Modal</twig:Button>
        </twig:Modal:Trigger>

        <twig:Modal:Content class="max-w-[600px]" backdrop="static">
            <twig:Modal:Header>
                <twig:Modal:Title>Edit profile</twig:Modal:Title>
            </twig:Modal:Header>

            <twig:Modal:Body>
                <p class="leading-relaxed text-body">
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Aenean placerat, velit sit amet interdum auctor, ligula lorem posuere urna, ut lobortis odio odio et leo. Nam scelerisque vel sem vel pulvinar.
                </p>
            </twig:Modal:Body>

            <twig:Modal:Footer>
                <twig:Button type="submit">I accept</twig:Button>
                <twig:Modal:Close>
                    <twig:Button variant="outline" {{ ...modal_close_attrs }}>Decline</twig:Button>
                </twig:Modal:Close>
            </twig:Modal:Footer>
        </twig:Modal:Content>
    </twig:Modal>
</div>
```

### Pop-up modal

You can use this modal example to show a pop-up decision dialog to your users especially when deleting an item and making sure if the user really wants to do that by double confirming.

```twig {"preview":true}
<div class="min-h-76">
    <twig:Modal id="share_link">
        <twig:Modal:Trigger>
            <twig:Button variant="outline-danger" {{ ...modal_trigger_attrs }}>Delete</twig:Button>
        </twig:Modal:Trigger>

        <twig:Modal:Content class="sm:max-w-md" :showCloseButton="false">

            <twig:Modal:Body class="text-center">
                <twig:ux:icon name="flowbite:exclamation-circle-outline" class="mx-auto size-12 text-fg-disabled" aria-hidden="true" />
                <twig:Modal:Title>Are you sure you want to delete this product from your account?</twig:Modal:Title>
                <div class="flex items-center space-x-4 justify-center">
                    <twig:Button variant="danger">
                        Yes, I'm sure
                    </twig:Button>

                    <twig:Modal:Close>
                        <twig:Button variant="outline" {{ ...modal_close_attrs }}>
                            No, cancel
                        </twig:Button>
                    </twig:Modal:Close>
                </div>
            </twig:Modal:Body>

        </twig:Modal:Content>
    </twig:Modal>
</div>
```

### Opened by default

```twig {"preview":true}
<div class="min-h-76">
    <twig:Modal id="delete_account" open>
        <twig:Modal:Trigger>
            <twig:Button variant="outline" {{ ...modal_trigger_attrs }}>Open Modal</twig:Button>
        </twig:Modal:Trigger>

        <twig:Modal:Content>
            <twig:Modal:Header>
                <twig:Modal:Title>Edit profile</twig:Modal:Title>
            </twig:Modal:Header>

            <twig:Modal:Body>
                <p class="leading-relaxed text-body">
                    With less than a month to go before the European Union enacts new consumer privacy laws for its citizens, companies around the world are updating their terms of service agreements to comply.
                </p>
                <p class="leading-relaxed text-body">
                    The European Union’s General Data Protection Regulation (G.D.P.R.) goes into effect on May 25 and is meant to ensure a common set of data rights in the European Union. It requires organizations to notify users as soon as possible of high-risk data breaches that could personally affect them.
                </p>
            </twig:Modal:Body>

            <twig:Modal:Footer>
                <twig:Button type="submit">I accept</twig:Button>
                <twig:Modal:Close>
                    <twig:Button variant="outline" {{ ...modal_close_attrs }}>Decline</twig:Button>
                </twig:Modal:Close>
            </twig:Modal:Footer>
        </twig:Modal:Content>
    </twig:Modal>
</div>
```

## API Reference

::: api-reference
