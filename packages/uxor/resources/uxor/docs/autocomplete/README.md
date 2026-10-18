# Autocomplete

Searchable selects with [Symfony UX Autocomplete](https://symfony.com/bundles/ux-autocomplete/current/index.html) (Tom Select), styled with the kit's theme: one choice, several choices, values the user types, and options searched on the server.

```twig {"preview":true}
<div class="w-full max-w-sm">
    <twig:Label for="autocomplete-country" class="mb-2.5">Country</twig:Label>
    <twig:Autocomplete id="autocomplete-country">
        <option value="">Choose a country</option>
        <option value="US">United States</option>
        <option value="CA">Canada</option>
        <option value="FR">France</option>
        <option value="DE">Germany</option>
    </twig:Autocomplete>
</div>
```

## Installation

::: installation

Then:

1. Run the `composer require` command `ux:install` prints (`symfony/ux-autocomplete`); its Flex recipe registers the
   bundle, its route and its Stimulus controller.
2. Import the stylesheet after the kit's, in `assets/styles/app.css`:

   ```css
   @import "./uxor-autocomplete.css";
   ```

3. Turn off Tom Select's own stylesheet in `assets/controllers.json`: this recipe's replaces it.

   ```json
   "@symfony/ux-autocomplete": {
       "autocomplete": {
           "enabled": true,
           "fetch": "eager",
           "autoimport": {
               "tom-select/dist/css/tom-select.default.css": false,
               "tom-select/dist/css/tom-select.bootstrap4.css": false,
               "tom-select/dist/css/tom-select.bootstrap5.css": false
           }
       }
   }
   ```

## Usage

### In a Symfony form

Add `'autocomplete' => true` to a `ChoiceType`, `EntityType`, `CountryType` (or any choice field). The `form-theme`
recipe renders it through `Select`, with its label, help and errors and the recipe's `autocomplete-sync` controller
(see [Reset](#reset)), and Tom Select enhances it.

```php
$builder
    ->add('country', CountryType::class, [
        'autocomplete' => true,
        'placeholder' => 'Choose a country',
    ])
    ->add('languages', ChoiceType::class, [
        'choices' => ['English' => 'en', 'French' => 'fr', 'Spanish' => 'es'],
        'multiple' => true,
        'autocomplete' => true,
    ])
    ->add('tags', ChoiceType::class, [
        'multiple' => true,
        'autocomplete' => true,
        'tom_select_options' => ['create' => true],
    ]);
```

For options searched on the server as the user types, make a field class with `#[AsAutocompleteField]` whose parent
is `AutocompleteChoiceType` (any data) or `BaseEntityAutocompleteType` with `#[AsEntityAutocompleteField]` (Doctrine
entities); see the
[UX Autocomplete documentation](https://symfony.com/bundles/ux-autocomplete/current/index.html). The search URL is
public unless you protect it (the `security` option).

### Outside a form

`Autocomplete` renders a `Select` with the controller (and the recipe's `autocomplete-sync`, see [Reset](#reset)); its
content is the options, and every other attribute goes to the `<select>`. Give it an `id` and its label a matching `for`, and no `id` on the label: Tom Select names the label
`<id>-ts-label`, and the hidden `<select>` keeps the label's name through it.

```twig
<twig:Autocomplete id="fruit" name="fruit" :options="{create: true}">
    <option value="">Choose a fruit</option>
    <option value="apple">Apple</option>
    <option value="banana">Banana</option>
</twig:Autocomplete>
```

- `multiple`: several values.
- `options`: [Tom Select settings](https://tom-select.js.org/docs/), such as `{create: true}` (values the user types)
  or `{maxItems: 3}`.
- `url` and `minCharacters`: search on the server; the URL answers with UX Autocomplete's JSON
  (`{"results": [{"value": …, "text": …}]}`), and the content holds the selected options only.

### Reset

A reset of the field's form (a `<button type="reset">`, `form.reset()`) puts back the options the server rendered
selected, and Tom Select shows them: the recipe's `autocomplete-sync` controller, which `Autocomplete` and the form
theme put next to UX Autocomplete's, syncs Tom Select from the `<select>` once the reset is done. It needs no other
recipe (the layouts' [`form-reset`](../layouts/README.md#back-and-forms) is not required), follows the form a `form`
attribute names, and dispatches no `input` or `change` event, so a Live Component sends no request. A reset another
listener cancels (`preventDefault()` on the `reset` event) changes nothing.

### With Turbo and Live Components

Fields keep working through Turbo visits and Back, inside a Turbo Frame and after a Turbo Stream replaces them: the
controller sets Tom Select up when the `<select>` appears and removes it when it leaves. In a Live Component form, use
the form option (`'autocomplete' => true`): UX Autocomplete keeps the chosen values across re-renders, and a value
the server sets in a re-render (a reset, another record) shows in the field (the recipe's `autocomplete-sync`
controller, which the `Autocomplete` component and the form theme put next to UX Autocomplete's). After Back, a
field in a GET form shows the URL's choice, one in a POST form the choice left (the layouts'
[`form-reset`](../layouts/README.md#back-and-forms)), also Back from a frame visit promoted to history (a data
table's pages), whose copy of the page Turbo takes with Tom Select on screen: `autocomplete-sync` removes the copied
Tom Select, so the field shows one, in the Tab order as before.
