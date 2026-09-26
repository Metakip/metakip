import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../utils/api';
import type { ImageUploader } from '../../utils/imageUpload';
import { showErrorToast } from '../../utils/toast';
import { createImageUploads } from './imageUploads';

vi.mock('../../utils/toast', () => ({ showErrorToast: vi.fn() }));

const file = (name = 'diagram.png') => new File(['image'], name, { type: 'image/png' });

function createHarness(uploader: ImageUploader) {
  const container = document.createElement('div');
  document.body.append(container);
  const uploads = createImageUploads({ getUploader: () => uploader });
  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: 'before after',
      selection: { anchor: 7 },
      extensions: [uploads.extension],
    }),
  });
  return {
    container,
    uploads,
    view,
    dispose() {
      uploads.dispose();
      view.destroy();
      container.remove();
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('CodeMirror image uploads', () => {
  it('maps the original insertion point through concurrent document edits', async () => {
    let finishUpload: (result: { url: string; markdown: string }) => void = () => undefined;
    const uploader = vi.fn(
      () =>
        new Promise<{ url: string; markdown: string }>((resolve) => {
          finishUpload = resolve;
        }),
    );
    const harness = createHarness(uploader);
    try {
      expect(harness.uploads.uploadFiles(harness.view, [file()])).toBe(true);
      await waitFor(() => expect(uploader).toHaveBeenCalledOnce());
      harness.view.dispatch({ changes: { from: 0, insert: 'remote ' } });
      finishUpload({
        url: '/api/uploads/diagram.png',
        markdown: '![diagram](/api/uploads/diagram.png)',
      });

      await waitFor(() =>
        expect(harness.view.state.doc.toString()).toBe(
          'remote before ![diagram](/api/uploads/diagram.png) after',
        ),
      );
    } finally {
      harness.dispose();
    }
  });

  it('keeps a pending image at the cursor when the user types there during upload', async () => {
    let finishUpload: (result: { url: string; markdown: string }) => void = () => undefined;
    const uploader = vi.fn(
      () =>
        new Promise<{ url: string; markdown: string }>((resolve) => {
          finishUpload = resolve;
        }),
    );
    const harness = createHarness(uploader);
    try {
      expect(harness.uploads.uploadFiles(harness.view, [file()])).toBe(true);
      await waitFor(() => expect(uploader).toHaveBeenCalledOnce());
      harness.view.dispatch({ changes: { from: 7, insert: 'x' } });
      finishUpload({
        url: '/api/uploads/diagram.png',
        markdown: '![diagram](/api/uploads/diagram.png)',
      });

      await waitFor(() =>
        expect(harness.view.state.doc.toString()).toBe(
          'before x ![diagram](/api/uploads/diagram.png) after',
        ),
      );
    } finally {
      harness.dispose();
    }
  });

  it('uploads clipboard image files and prevents empty native paste', async () => {
    const uploader = vi.fn(async (selected: File) => ({
      url: `/api/uploads/${selected.name}`,
      markdown: `![${selected.name}](/api/uploads/${selected.name})`,
    }));
    const harness = createHarness(uploader);
    try {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: { files: [file()], getData: () => '' },
      });
      harness.view.contentDOM.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);

      await waitFor(() => expect(uploader).toHaveBeenCalledOnce());
      await waitFor(() => expect(harness.view.state.doc.toString()).toContain('![diagram.png]'));
    } finally {
      harness.dispose();
    }
  });

  it('inserts only the managed image when the clipboard also has plain text', async () => {
    const uploader = vi.fn(async (selected: File) => ({
      url: `/api/uploads/${selected.name}`,
      markdown: `![${selected.name}](/api/uploads/${selected.name})`,
    }));
    const harness = createHarness(uploader);
    try {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          files: [file()],
          getData: (type: string) => (type === 'text/plain' ? 'clipboard caption' : ''),
        },
      });
      harness.view.contentDOM.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);

      await waitFor(() => expect(uploader).toHaveBeenCalledOnce());
      await waitFor(() =>
        expect(harness.view.state.doc.toString()).toBe(
          'before ![diagram.png](/api/uploads/diagram.png) after',
        ),
      );
    } finally {
      harness.dispose();
    }
  });

  it('uploads embedded clipboard data images without retaining a data URL', async () => {
    const uploader = vi.fn(async (selected: File) => ({
      url: `/api/uploads/${selected.name}`,
      markdown: `![${selected.name}](/api/uploads/${selected.name})`,
    }));
    const harness = createHarness(uploader);
    try {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          files: [],
          getData: (type: string) =>
            type === 'text/html' ? '<img alt="diagram" src="data:image/png;base64,aW1hZ2U=">' : '',
        },
      });
      harness.view.contentDOM.dispatchEvent(event);

      await waitFor(() => expect(uploader).toHaveBeenCalledOnce());
      expect(uploader.mock.calls[0]?.[0].name).toBe('diagram');
      await waitFor(() => expect(harness.view.state.doc.toString()).toContain('![diagram]'));
      expect(harness.view.state.doc.toString()).not.toContain('data:image');
    } finally {
      harness.dispose();
    }
  });

  it('keeps prose immediately and places multiple rich-paste images in their original order', async () => {
    const finish = new Map<string, (result: { url: string; markdown: string }) => void>();
    const uploader = vi.fn(
      (selected: File) =>
        new Promise<{ url: string; markdown: string }>((resolve) => {
          finish.set(selected.name, resolve);
        }),
    );
    const harness = createHarness(uploader);
    try {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          files: [],
          getData: (type: string) =>
            type === 'text/html'
              ? 'First <img alt="one" src="data:image/png;base64,aW1hZ2U="> middle <img alt="two" src="data:image/png;base64,aW1hZ2U="> last'
              : 'First middle last',
        },
      });
      harness.view.contentDOM.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(harness.view.state.doc.toString()).toContain('First  middle  last');
      await waitFor(() => expect(uploader).toHaveBeenCalledTimes(2));
      finish.get('two')?.({
        url: '/api/uploads/two.png',
        markdown: '![two](/api/uploads/two.png)',
      });
      finish.get('one')?.({
        url: '/api/uploads/one.png',
        markdown: '![one](/api/uploads/one.png)',
      });
      await waitFor(() => expect(harness.view.state.doc.toString()).toContain('![two]'));
      const content = harness.view.state.doc.toString();
      expect(content.indexOf('First')).toBeLessThan(content.indexOf('![one]'));
      expect(content.indexOf('![one]')).toBeLessThan(content.indexOf('middle'));
      expect(content.indexOf('middle')).toBeLessThan(content.indexOf('![two]'));
      expect(content.indexOf('![two]')).toBeLessThan(content.indexOf('last'));
    } finally {
      harness.dispose();
    }
  });

  it('keeps text alongside an image supplied as a clipboard file', async () => {
    const uploader = vi.fn(async () => ({
      url: '/api/uploads/diagram.png',
      markdown: '![diagram](/api/uploads/diagram.png)',
    }));
    const harness = createHarness(uploader);
    try {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          files: [file()],
          getData: (type: string) =>
            type === 'text/html' ? 'Before <img src="blob:image"> after' : 'Before after',
        },
      });
      harness.view.contentDOM.dispatchEvent(event);
      expect(harness.view.state.doc.toString()).toContain('Before  after');
      await waitFor(() =>
        expect(harness.view.state.doc.toString()).toContain(
          'Before ![diagram](/api/uploads/diagram.png) after',
        ),
      );
    } finally {
      harness.dispose();
    }
  });

  it('offers a retry with the original key and insertion position after an uncertain failure', async () => {
    vi.mocked(showErrorToast).mockReturnValueOnce(() => undefined);
    const keys: string[] = [];
    const uploader: ImageUploader = vi.fn(async (_file, _signal, key) => {
      if (key) keys.push(key);
      if (keys.length === 1) throw new Error('connection lost');
      return { url: '/api/uploads/diagram.png', markdown: '![diagram](/api/uploads/diagram.png)' };
    });
    const harness = createHarness(uploader);
    try {
      harness.uploads.uploadFiles(harness.view, [file()]);
      await waitFor(() => expect(showErrorToast).toHaveBeenCalledOnce());
      const retry = vi.mocked(showErrorToast).mock.calls[0]?.[1];
      expect(retry?.label).toBe('Retry');
      harness.view.dispatch({ changes: { from: 0, insert: 'remote ' } });
      retry?.onClick();
      await waitFor(() =>
        expect(harness.view.state.doc.toString()).toContain('remote before ![diagram]'),
      );
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBe(keys[1]);
    } finally {
      harness.dispose();
    }
  });

  it('keeps image order when only the first of several uploads needs retrying', async () => {
    vi.mocked(showErrorToast).mockReturnValueOnce(() => undefined);
    let firstAttempts = 0;
    const uploader: ImageUploader = vi.fn(async (selected) => {
      if (selected.name === 'first.png' && firstAttempts++ === 0)
        throw new Error('connection lost');
      return {
        url: `/api/uploads/${selected.name}`,
        markdown: `![${selected.name}](/api/uploads/${selected.name})`,
      };
    });
    const harness = createHarness(uploader);
    try {
      harness.uploads.uploadFiles(harness.view, [file('first.png'), file('second.png')]);
      await waitFor(() => expect(showErrorToast).toHaveBeenCalledOnce());
      expect(harness.view.state.doc.toString()).not.toContain('![second.png]');
      vi.mocked(showErrorToast).mock.calls[0]?.[1]?.onClick();
      await waitFor(() => expect(harness.view.state.doc.toString()).toContain('![second.png]'));
      const content = harness.view.state.doc.toString();
      expect(content.indexOf('![first.png]')).toBeLessThan(content.indexOf('![second.png]'));
      expect(uploader).toHaveBeenCalledTimes(3);
    } finally {
      harness.dispose();
    }
  });

  it('keeps completed images on dismissal, but not when an identity change clears the toast', async () => {
    const uploader: ImageUploader = async (selected) => {
      if (selected.name === 'first.png') throw new Error('connection lost');
      return {
        url: '/api/uploads/second.png',
        markdown: '![second.png](/api/uploads/second.png)',
      };
    };
    for (const reason of ['dismiss', 'clear'] as const) {
      vi.mocked(showErrorToast).mockClear();
      vi.mocked(showErrorToast).mockReturnValueOnce(() => undefined);
      const harness = createHarness(uploader);
      try {
        harness.uploads.uploadFiles(harness.view, [file('first.png'), file('second.png')]);
        await waitFor(() => expect(showErrorToast).toHaveBeenCalledOnce());
        vi.mocked(showErrorToast).mock.calls[0]?.[2]?.(reason);
        expect(harness.view.state.doc.toString().includes('![second.png]')).toBe(
          reason === 'dismiss',
        );
      } finally {
        harness.dispose();
      }
    }
  });

  it('does not offer a retry for a definitive client error', async () => {
    const harness = createHarness(async () => {
      throw new ApiError(400, 'Invalid image');
    });
    try {
      harness.uploads.uploadFiles(harness.view, [file()]);
      await waitFor(() => expect(showErrorToast).toHaveBeenCalledOnce());
      expect(vi.mocked(showErrorToast).mock.calls[0]?.[1]).toBeUndefined();
    } finally {
      harness.dispose();
    }
  });

  it('preserves the selected text when upload fails', async () => {
    const uploader = vi.fn().mockRejectedValue(new Error('storage unavailable'));
    const harness = createHarness(uploader);
    harness.view.dispatch({ selection: { anchor: 1, head: 6 } });
    const before = harness.view.state.doc.toString();
    try {
      harness.uploads.uploadFiles(harness.view, [file()]);
      await waitFor(() => expect(uploader).toHaveBeenCalledOnce());
      await waitFor(() => expect(harness.view.state.selection.main.to).toBe(6));
      expect(harness.view.state.doc.toString()).toBe(before);
    } finally {
      harness.dispose();
    }
  });

  it('aborts active uploads when the editor is retired', async () => {
    let signal: AbortSignal | undefined;
    const uploader = vi.fn(
      (_selected: File, currentSignal?: AbortSignal) =>
        new Promise<{ url: string; markdown: string }>((_resolve, reject) => {
          signal = currentSignal;
          currentSignal?.addEventListener('abort', () => reject(currentSignal.reason));
        }),
    );
    const harness = createHarness(uploader);
    harness.uploads.uploadFiles(harness.view, [file()]);
    await waitFor(() => expect(uploader).toHaveBeenCalledOnce());
    harness.uploads.dispose();
    expect(signal?.aborted).toBe(true);
    harness.view.destroy();
    harness.container.remove();
  });
});
