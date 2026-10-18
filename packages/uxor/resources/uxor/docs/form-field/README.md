# Form Field

A labelled form control with its help text and error message, wired by id (used by the form theme).

```twig {"preview":true}
<div class="w-full max-w-sm space-y-6">
    <twig:FormField for="email" label="Email" help="We never share it." required>
        <twig:Input id="email" type="email" placeholder="name@example.com" aria-describedby="email_help" required />
    </twig:FormField>
    <twig:FormField for="username" label="Username" error="This username is already taken.">
        <twig:Input id="username" value="bonnie" aria-invalid="true" aria-describedby="username_error" />
    </twig:FormField>
</div>
```

## Installation

::: installation

## Usage

```twig
<twig:FormField for="email" label="Email" help="Hint" error="{{ error }}" required>
    <twig:Input id="email" aria-describedby="email_help email_error" aria-invalid="{{ error ? 'true' : 'false' }}" />
</twig:FormField>
```

The component lays out the label, help and error, and gives the help and the error their ids: `<for>_help` and `<for>_error`, as Symfony forms do. It does not change the control. Set these on the control yourself: `id` equal to `for`, `aria-describedby` with the two ids, and `aria-invalid="true"` when there is an error. `error` also takes a list of messages.

Group several controls (radios, checkboxes) with `as="fieldset"`: the label becomes the `legend`.

```twig
<twig:FormField as="fieldset" for="plan" label="Plan" aria-describedby="plan_help" help="You can change it later.">
    …radios…
</twig:FormField>
```

The `form-theme` recipe renders every Symfony form row through this component.
