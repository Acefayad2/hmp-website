import {test, expect} from '@playwright/test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

let richFieldModule;
test.beforeAll(async () => {
  // Keep testing the production dist server without exposing source files in dist.
  const {outputFiles} = await build({
    entryPoints: [fileURLToPath(new URL('../../src/rich-text-fields.js', import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  });
  richFieldModule = outputFiles[0].text;
});

test('agreement details save text and formatting from the same editor state', async ({page}) => {
  await page.route('**/__test/rich-text-fields.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: richFieldModule,
  }));
  await page.goto('/agreement.html');
  await page.setContent('<form><textarea name="details">First line\nSecond line</textarea></form>');
  const result = await page.evaluate(async () => {
    const {setRichField, collectRichFields} = await import('/__test/rich-text-fields.js');
    const field = document.querySelector('textarea');
    setRichField(field, [{start:0,end:10,bold:true}]);
    const editor = document.querySelector('[data-rich-field]');
    editor.innerHTML = '<div>First line</div><div><strong>Second line with more text</strong></div>';
    const current = collectRichFields({details:'[name="details"]'}, document);
    return {text:current.values.details, runs:current.textFormatting.details};
  });
  expect(result.text).toBe('First line\nSecond line with more text');
  expect(result.runs.some(run => run.bold && result.text.slice(run.start,run.end) === 'Second line with more text')).toBe(true);
  expect(result.runs.every(run => run.end <= result.text.length)).toBe(true);
});
