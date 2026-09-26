import { describe, expect, it } from 'vitest';
import { parseHtmlImagePaste } from './imagePaste';

describe('rich image paste parsing', () => {
  it('keeps prose and data images in document order', () => {
    const parsed = parseHtmlImagePaste(
      'Before <img alt="first" src="data:image/png;base64,aW1hZ2U="> middle <img alt="second" src="data:image/png;base64,aW1hZ2U="> after',
      [],
    );
    expect(parsed?.text).toBe('Before  middle  after');
    expect(parsed?.slots.map(({ offset, files }) => [offset, files[0]?.name])).toEqual([
      [7, 'first'],
      [15, 'second'],
    ]);
  });

  it('uses clipboard files in their HTML positions without duplicating embedded data', () => {
    const first = new File(['one'], 'first.png', { type: 'image/png' });
    const second = new File(['two'], 'second.png', { type: 'image/png' });
    const parsed = parseHtmlImagePaste(
      'A<img src="data:image/png;base64,aW1hZ2U="> B<img src="data:image/png;base64,aW1hZ2U="> C',
      [first, second],
    );
    expect(parsed?.slots.map(({ files }) => files)).toEqual([[first], [second]]);
    expect(parsed?.text).toBe('A B C');
  });

  it('retains prose and files even if the HTML omits image positions', () => {
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    const parsed = parseHtmlImagePaste('<p>Caption</p>', [file]);
    expect(parsed).toEqual({ text: 'Caption\n', slots: [{ offset: 8, files: [file] }] });
  });

  it('keeps a block image separate from the following paragraph', () => {
    const parsed = parseHtmlImagePaste(
      '<p><img src="data:image/png;base64,aW1hZ2U="></p><p>After</p>',
      [],
    );
    expect(parsed?.text).toBe('\nAfter\n');
    expect(parsed?.slots[0]?.offset).toBe(0);
  });

  it('does not treat scripts or unsupported data images as pasteable content', () => {
    expect(
      parseHtmlImagePaste('<script>hidden</script><img src="data:image/svg+xml;base64,AA==">', []),
    ).toBeNull();
  });
});
