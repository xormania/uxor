# Dropzone

File uploads with [Symfony UX Dropzone](https://symfony.com/bundles/ux-dropzone/current/index.html), styled with the kit's theme: drag and drop or browse, a preview of the picked image, several files that add up across picks.

```twig {"preview":true}
<div class="w-full max-w-md">
    <twig:FormField for="dropzone-default" label="Profile picture">
        <twig:Dropzone id="dropzone-default" name="photo" />
    </twig:FormField>
</div>
```

## Installation

::: installation

Then:

1. Run the `composer require` command `ux:install` prints (`symfony/ux-dropzone`). Symfony Flex registers the bundle
   and adds its Stimulus controller to `assets/controllers.json` and its entry to `importmap.php`; the package has no
   Flex recipe of its own.
2. Import the stylesheet after the kit's, in `assets/styles/app.css`:

   ```css
   @import "./uxor-dropzone.css";
   ```

3. Turn off UX Dropzone's own stylesheet in `assets/controllers.json`: this recipe's replaces it.

   ```json
   "@symfony/ux-dropzone": {
       "dropzone": {
           "enabled": true,
           "fetch": "eager",
           "autoimport": {
               "@symfony/ux-dropzone/dist/style.min.css": false
           }
       }
   }
   ```

## Usage

`Dropzone` renders UX Dropzone's markup with its controller, and the kit's `dropzone-assist` controller next to it.
`class` goes to the box's wrapper; every other attribute goes to the `<input type="file">`: `id`, `name`, `accept`,
`required`, `disabled`, `form`, `capture`, `aria-*`, `data-*`. A `data-controller` you pass joins UX Dropzone's on the
wrapper, where its events are dispatched; your `data-action` and your controller's values, classes, outlets and params
go there with it, and its target (`data-<controller>-target`) stays on the input.

```twig
<twig:Dropzone id="photo" name="photo" accept="image/png,image/jpeg" hint="PNG or JPG, up to 1 MB" />
<twig:Dropzone id="attachments" name="attachments[]" multiple />
```

- Give it a stable `id`, and its label a matching `for` (`FormField` does both): a click on the label opens the file
  chooser.
- `placeholder` is the main line and `hint` a smaller one, which also describes the input.
- `accept` limits the files the chooser offers and the files a drop adds (see *Limits*); the server still checks them.
- `multiple`: picks add up in a list under the box, each file with its own Remove button; a file picked twice is
  kept once. Name the input with `[]` (`attachments[]`) so the server receives every file.
- `maxFiles` caps a zone for several files: files over it are left out with `dropzone:reject` (see *Events*), and a
  full zone takes no more until a file is removed. It takes a positive whole number (`maxFiles="3"`); any other value,
  or a zone for one file, sets no cap. The server still counts the files.
- `removeLabel` names the Remove buttons, followed by the file name: "Remove photo.png".
- `reselect` shows a note in the box, which describes the input, such as a file the server did not keep.
- The `content` block replaces the icon and the placeholder, for a custom look; `hint` and `reselect` stay under it.
- The `preview_item` block replaces the preview of each picked file: one root element, which UX Dropzone clones for
  each file, filling the parts marked `data-dropzone-slot="image"` (an `<img>` gets the image as its `src`, another
  element as its background), `"filename"` (the name, as text) and `"remove"` (removes the file, named "Remove
  photo.png"). With none or several root elements, UX Dropzone does not connect and reports the error in the browser
  console. With `multiple`, each copy goes into the list, so make it an `<li>`.
- In an invalid field, set `aria-invalid="true"` and point `aria-describedby` at the error: the box turns red.

```twig
<twig:Dropzone id="attachments" name="attachments[]" multiple maxFiles="3">
    <twig:block name="preview_item">
        <li class="flex items-center gap-3 rounded-base border border-default p-2">
            <img class="size-10 rounded-sm object-cover" alt="" data-dropzone-slot="image">
            <span class="min-w-0 flex-1 text-sm text-heading" data-dropzone-slot="filename"></span>
            <button type="button" class="rounded-base p-1 text-body hover:text-heading" data-dropzone-slot="remove">
                <twig:ux:icon name="flowbite:close-outline" class="size-5" aria-hidden="true" />
            </button>
        </li>
    </twig:block>
</twig:Dropzone>
```

### In a Symfony form

With the `form-theme` recipe's theme, every `DropzoneType` renders as this `Dropzone`: the field's label points at
the file input, its help and errors describe it, the `placeholder` option is the main line and `remove_label` names
the Remove buttons. `attr.class` and `attr['data-controller']` go to the box, every other `attr` to the input. UX
Dropzone deprecates a placeholder passed in `attr`: use the option.

```php
use Symfony\Component\Validator\Constraints as Assert;
use Symfony\UX\Dropzone\Form\DropzoneType;

$builder
    ->add('photo', DropzoneType::class, [
        'required' => false,
        'help' => 'PNG or JPG, up to 1 MB.',
        'placeholder' => 'Drop a photo or browse',
        'attr' => ['accept' => 'image/png,image/jpeg'],
        'constraints' => [new Assert\Image(maxSize: '1M', mimeTypes: ['image/png', 'image/jpeg'])],
    ])
    ->add('attachments', DropzoneType::class, [
        'required' => false,
        'multiple' => true,
        'max_files' => 3,
        'constraints' => [new Assert\All([new Assert\File(maxSize: '1M')])],
    ]);
```

`max_files` (with `multiple`) caps the zone in the browser, as `maxFiles` does, and UX Dropzone's type adds a
`Count(max: …)` constraint for the server: add no `Count` of your own next to it, or the error shows twice.

The preview of each file comes from the `dropzone_preview_item` block of your form theme, when it defines one: the
markup of one file, as the component's `preview_item` block takes it, without a `<template>` around it. UX Dropzone's
own `dropzone_preview_item_template` block (a whole `<template>`, as its documentation shows) is not read with this
theme: rename yours to `dropzone_preview_item` and keep only what is inside its `<template>`.

```twig
{# templates/form/theme.html.twig, after form/flowbite_layout.html.twig in twig.form_themes #}
{% block dropzone_preview_item %}
    <li class="flex items-center gap-3">
        <span class="min-w-0 flex-1 text-sm text-heading" data-dropzone-slot="filename"></span>
        <button type="button" class="rounded-base p-1 text-body" data-dropzone-slot="remove">
            <twig:ux:icon name="flowbite:close-outline" class="size-5" aria-hidden="true" />
        </button>
    </li>
{% endblock %}
```

The controller is the usual one: `handleRequest()`, `getData()` gives an `UploadedFile` (a list of them with
`multiple`), then a 303 on success and `render()` (422) on errors; `form_start()` adds the `enctype`. When other
fields' errors send the form back, the files the user picked are gone: a field without errors of its own says so in
its box ("photo.png was not kept: choose it again."). Change that sentence with the `reselect_message` variable
(`%name%`, `%count%`), translated with the form's domain:

```twig
{{ form_row(form.photo, {reselect_message: 'Choose %name% again.'}) }}
```

A plain `FileType` stays the form theme's native file input.

### Outside a form

A hand-written form needs `method="post"` and `enctype="multipart/form-data"`. Without the `enctype`, the browser
sends the file names only, and Turbo sends no file.

```twig
<form method="post" action="{{ path('app_upload') }}" enctype="multipart/form-data">
    <twig:FormField for="files" label="Files">
        <twig:Dropzone id="files" name="files[]" multiple />
    </twig:FormField>
    <twig:Button type="submit" class="mt-4">Upload</twig:Button>
</form>
```

### Saving the files

The controller reads the files from the request (`$request->files->get('photo')`, `$request->files->all('files')`
for several), checks them with the Validator (`File`, `Image`, and `All` plus `Count` for several), and moves them
out of PHP's temporary directory. Never trust the name or the type the browser sent:

```php
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Symfony\Component\String\Slugger\SluggerInterface;

/** @param UploadedFile $file a file the Validator accepted */
function store(UploadedFile $file, SluggerInterface $slugger, string $uploadDir): string
{
    $name = $slugger->slug(pathinfo($file->getClientOriginalName(), \PATHINFO_FILENAME))->lower();
    // the extension guessed from the content, not the one the browser sent
    $fileName = \sprintf('%s-%s.%s', $name, bin2hex(random_bytes(6)), $file->guessExtension() ?? 'bin');
    $file->move($uploadDir, $fileName); // a directory outside public/, served by a controller that checks access

    return $fileName;
}
```

### Limits

The Validator's constraints decide what is accepted. The browser's checks only help the user:

- The file chooser offers the files `accept` matches, by the operating system's file types.
- A drop adds the files that match one of `accept`'s types or extensions and leaves out the others, which UX Dropzone
  dispatches with `dropzone:reject` (see *Events*). A dropped file's type comes from the operating system and can
  differ from the one in `accept`: on Windows, a CSV file is often `application/vnd.ms-excel`. List the extensions
  next to the types (`accept=".csv,text/csv"`). A file the browser reports no type for (a HEIC photo) passes any type in `accept`.
- Neither is validation: a request can carry any file, under any name and type. Check every file on the server.

PHP's own limits come first: a file over `upload_max_filesize` reaches the controller as an upload error
(the `File` constraint reports it), and a request over `post_max_size` reaches it empty, every field and file
dropped. Raise both in `php.ini` above your largest constraint, `post_max_size` above the sum of the files.

On FrankenPHP in worker mode (Symfony Docker), a request over `post_max_size` never reaches Symfony: the worker
fails it with a fatal error page (FrankenPHP issue
[#2631](https://github.com/php/frankenphp/issues/2631)). Set `post_max_size` well above what a form can send, and let `upload_max_filesize`
and the constraints refuse large files (each comes back as its field's error).

### With Turbo

- Turbo submits a `multipart/form-data` form with its files. Answer 303 on success and 422 with the errors, as for
  any form.
- Files never come back from the server: after a 422, or when a Turbo Stream replaces the field, the zone is empty
  and the user picks the files again. Say so next to the errors.
- After Back and Forward, a zone for one file in a POST form (any form but a GET one) shows the file picked, as the
  form holds the user's work: the zone keeps it for Turbo's copy of the page, also the copy a frame visit promoted to
  history takes as it starts (a data table's pages). Outside such a form it starts empty. A
  zone for several files lists what its input holds: Turbo's copy of the page keeps the files in some browsers
  (Chromium), not in others.
- A zone inside a `data-turbo-permanent` element keeps its files across visits.

### In a Live Component

A Live Component never receives a `DropzoneType` file through its form. Upload the files with a `files` action
first, then keep their names or ids in a LiveProp:

```twig
{# re-renders leave the zone alone; ids that change after each upload make Live replace it, empty #}
<div id="photos-zone-{{ uploads|length }}">
    <div data-live-ignore>
        <twig:FormField for="photos-{{ uploads|length }}" label="Photos">
            <twig:Dropzone id="photos-{{ uploads|length }}" name="photos[]" multiple />
        </twig:FormField>
    </div>
</div>
<twig:Button data-action="live#action" data-live-action-param="files(photos[])|upload">Upload</twig:Button>
```

```php
#[LiveAction]
public function upload(Request $request, ValidatorInterface $validator): void
{
    $files = $request->files->all('photos');
    // validate (All + Image, Count), store, then keep the stored names in a LiveProp
}
```

- `data-live-ignore` keeps the picked files and their list through re-renders the zone has nothing to do with.
- The wrapper's id and the input's id must both change after an upload (a counter): with a new wrapper id alone,
  Live keeps the ignored zone and moves its input into the new one.

### Events

UX Dropzone dispatches these events on the wrapper, all bubbling:

- `dropzone:connect`, when its controller connects. It keeps the files the input already holds then, and clears
  nothing.
- `dropzone:pre-add`, cancelable, before picked or dropped files are added (UX Dropzone's documentation describes
  its `waitUntil()`).
- `dropzone:change`, when files are added, or one of several is removed: the `File`, or the input's `FileList` with
  `multiple`. With `multiple`, a pick that adds nothing (every file is in the list already, or over `maxFiles`)
  dispatches none.
- `dropzone:remove`, after its `dropzone:change`, when one of several files is removed: the removed `File`.
- `dropzone:clear`, when the zone becomes empty: Remove with one file, removing the last of several files, a reset
  of the form. The kit dispatches it too when it empties a zone for one file that Turbo restored outside a POST form
  (see *With Turbo*).
- `dropzone:reject`, when files are left out: `{files, reason}`, the reason `accept` for dropped files that `accept`
  does not match, and `max_files` for the files over `maxFiles` (`max_files` in a form) in a zone for several files,
  or after the first when a zone for one file is given several files at once, dropped or picked.

Listen to them from your own controller, on the `Dropzone` (its `data-controller` joins UX Dropzone's on the
wrapper) or on an element around it:

```twig
<div data-controller="photo-upload" data-action="dropzone:change->photo-upload#show">
    <twig:Dropzone id="photo" name="photo" />
</div>
```

### Content Security Policy

The markup has no `style` attribute and no inline handler. UX Dropzone shows and hides its parts with the `hidden`
attribute, and shows an image preview as a background image set through the CSSOM, which a policy allows, from a
`data:` URL: the policy's `img-src` needs `data:`. A `display` class on one of those parts would keep it shown
without the theme's base styles, which hide every `[hidden]` element: the template leaves them off. A changed copy
of the template keeps it so: the preview starts with the `hidden` attribute, never a `hidden` class, which UX
Dropzone does not remove; its image takes no hiding class (UX Dropzone hides it until an image file is read); and no
part it shows and hides takes a `display` class.

Whether a zone is inside a `data-turbo-permanent` element, and whether a `turbo:before-cache` comes from a frame visit
promoted to history, are answered by the `turbo` recipe's module (`assets/lib/uxor-turbo.js`), which
`ux:install dropzone` installs with it.

## Examples

### Hint and accepted types

```twig {"preview":true}
<div class="w-full max-w-md">
    <twig:FormField for="dropzone-hint" label="Cover image">
        <twig:Dropzone id="dropzone-hint" name="cover" accept="image/png,image/jpeg" placeholder="Drop an image or browse" hint="PNG or JPG, up to 2 MB" />
    </twig:FormField>
</div>
```

### Multiple files

```twig {"preview":true}
<div class="w-full max-w-md">
    <twig:FormField for="dropzone-multiple" label="Attachments">
        <twig:Dropzone id="dropzone-multiple" name="attachments[]" multiple hint="Up to 3 files" />
    </twig:FormField>
</div>
```

### Invalid

```twig {"preview":true}
<div class="w-full max-w-md">
    <twig:FormField for="dropzone-invalid" label="Profile picture" help="PNG or JPG, up to 1 MB." error="The file is too large (1.5 MB). The maximum allowed size is 1 MB.">
        <twig:Dropzone id="dropzone-invalid" name="photo" accept="image/png,image/jpeg" aria-invalid="true" aria-describedby="dropzone-invalid_help dropzone-invalid_error" />
    </twig:FormField>
</div>
```

### Disabled

```twig {"preview":true}
<div class="w-full max-w-md">
    <twig:FormField for="dropzone-disabled" label="Contract">
        <twig:Dropzone id="dropzone-disabled" name="contract" disabled hint="Uploads are closed" />
    </twig:FormField>
</div>
```

### Custom content

```twig {"preview":true}
<div class="w-full max-w-md">
    <twig:FormField for="dropzone-custom" label="Invoice">
        <twig:Dropzone id="dropzone-custom" name="invoice" accept="application/pdf" hint="PDF only">
            <twig:ux:icon name="flowbite:paper-clip-outline" class="size-8 text-body" aria-hidden="true" />
            <p class="text-sm text-body"><span class="font-semibold text-heading">Click to upload</span> or drag and drop</p>
        </twig:Dropzone>
    </twig:FormField>
</div>
```

## Accessibility

- The file input stays the control: it covers the box, takes the focus (the box shows the focus ring), opens the
  chooser with Enter or Space, and is named by its label.
- After a pick made from the keyboard, focus moves to the Remove button, named "Remove photo.png", which tells a
  screen reader what was picked; Remove puts it back on the input. With `multiple`, the list is announced as it
  changes, and removing a file focuses the next Remove button, else the input. With a `preview_item` block, its
  `remove` slot is that button: keep one, a `<button type="button">`, in each item.
- A file dropped outside the input (on the list or the preview) is refused, so the browser never opens it in the tab.

## Security

`Dropzone` has no tag, URL or attribute-name prop. Its attributes render escaped, as the kit's guide says
(`docs/GUIDE.md`, *Security*), and `maxFiles` renders only as digits. The `preview_item` block (and the form theme's
`dropzone_preview_item`) is your own markup, rendered as you write it; UX Dropzone puts each file's name in it as
text, never as HTML.
