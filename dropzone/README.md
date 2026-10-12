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
- `multiple`: picks add up in a list under the box, each file with its own Remove button; a file picked twice is
  kept once. Name the input with `[]` (`attachments[]`) so the server receives every file.
- `removeLabel` names the Remove buttons, followed by the file name: "Remove photo.png".
- `reselect` shows a note in the box, which describes the input, such as a file the server did not keep.
- The `content` block replaces the icon and the placeholder, for a custom look; `hint` and `reselect` stay under it.
- In an invalid field, set `aria-invalid="true"` and point `aria-describedby` at the error: the box turns red.

### In a Symfony form

With the `form-theme` recipe's theme, every `DropzoneType` renders as this `Dropzone`: the field's label points at
the file input, its help and errors describe it, `attr.placeholder` is the main line and `remove_label` names the
Remove buttons. `attr.class` and `attr['data-controller']` go to the box, every other `attr` to the input.

```php
use Symfony\Component\Validator\Constraints as Assert;
use Symfony\UX\Dropzone\Form\DropzoneType;

$builder
    ->add('photo', DropzoneType::class, [
        'required' => false,
        'help' => 'PNG or JPG, up to 1 MB.',
        'attr' => ['accept' => 'image/png,image/jpeg', 'placeholder' => 'Drop a photo or browse'],
        'constraints' => [new Assert\Image(maxSize: '1M', mimeTypes: ['image/png', 'image/jpeg'])],
    ])
    ->add('attachments', DropzoneType::class, [
        'required' => false,
        'multiple' => true,
        'constraints' => [new Assert\Count(max: 3), new Assert\All([new Assert\File(maxSize: '1M')])],
    ]);
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

The Validator's constraints decide what is accepted: the browser checks nothing, `accept` only filters the file
chooser. PHP's own limits come first: a file over `upload_max_filesize` reaches the controller as an upload error
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

UX Dropzone dispatches these events on the wrapper, all bubbling: `dropzone:connect`, `dropzone:change` (the `File`,
or the `FileList` with `multiple`), `dropzone:clear` (one file, Remove) and `dropzone:remove` (several files, the
removed `File`). Listen to them from your own controller, on the `Dropzone` (its `data-controller` joins UX
Dropzone's on the wrapper) or on an element around it:

```twig
<div data-controller="photo-upload" data-action="dropzone:change->photo-upload#show">
    <twig:Dropzone id="photo" name="photo" />
</div>
```

### Content Security Policy

The markup has no `style` attribute and no inline handler. UX Dropzone shows and hides its parts through the CSSOM,
which a policy allows, and shows an image preview as a `data:` URL: the policy's `img-src` needs `data:`.

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
  changes, and removing a file focuses the next Remove button, else the input.
- A file dropped outside the input (on the list or the preview) is refused, so the browser never opens it in the tab.

## Security

`Dropzone` has no tag, URL or attribute-name prop. Its attributes render escaped, as the kit's guide says
(`docs/GUIDE.md`, *Security*).
