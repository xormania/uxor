import { startStimulusApp } from '@symfony/stimulus-bundle';

const app = startStimulusApp();
// register any custom, 3rd party controllers here
// app.register('some_controller_name', SomeImportedController);

// the demo only: the browser tests count the connected controllers (tests/e2e/fixtures.ts, stimulusControllers)
window.Stimulus = app;
