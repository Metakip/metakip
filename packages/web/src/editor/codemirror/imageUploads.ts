import { type Extension, StateEffect, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ApiError } from '../../utils/api';
import type { ImageUploader } from '../../utils/imageUpload';
import { showErrorToast } from '../../utils/toast';
import { parseHtmlImagePaste, supportedImage } from './imagePaste';

const MAX_CONCURRENT_UPLOADS = 3;

type ImageBookmark = {
  id: string;
  from: number;
  to: number;
  selectedText: string;
  leftContext: string;
  rightContext: string;
};

const addBookmark = StateEffect.define<ImageBookmark>();
const removeBookmark = StateEffect.define<string>();

const imageBookmarkField = StateField.define<ReadonlyMap<string, ImageBookmark>>({
  create: () => new Map(),
  update(bookmarks, transaction) {
    const mapped = new Map<string, ImageBookmark>();
    for (const [id, bookmark] of bookmarks) {
      const from = transaction.changes.mapPos(bookmark.from, 1);
      // A cursor bookmark must stay collapsed when text is inserted exactly
      // there; opposite associations would put its ends on either side of the
      // new text and discard the pending image.
      const to = transaction.changes.mapPos(bookmark.to, bookmark.from === bookmark.to ? 1 : -1);
      if (from <= to && to <= transaction.newDoc.length) {
        mapped.set(id, { ...bookmark, from, to });
      }
    }
    for (const effect of transaction.effects) {
      if (effect.is(addBookmark)) mapped.set(effect.value.id, effect.value);
      if (effect.is(removeBookmark)) mapped.delete(effect.value);
    }
    return mapped;
  },
});

type UploadOutcome = { markdown: string } | { error: unknown; index: number } | null;
type UploadRunOptions = {
  position?: number;
  preserveSelection?: boolean;
  retryKeys?: readonly string[];
  previousOutcomes?: readonly UploadOutcome[];
};

function makeBookmark(view: EditorView, id: string, position?: number): ImageBookmark {
  const selection = view.state.selection.main;
  const from = position ?? selection.from;
  const to = position ?? selection.to;
  const line = view.state.doc.lineAt(from);
  return {
    id,
    from,
    to,
    selectedText: position === undefined ? view.state.sliceDoc(from, to) : '',
    leftContext: view.state.sliceDoc(Math.max(line.from, from - 16), from),
    rightContext: view.state.sliceDoc(from, Math.min(line.to, from + 16)),
  };
}

function destinationStillExists(view: EditorView, bookmark: ImageBookmark): boolean {
  if (!bookmark.leftContext && !bookmark.rightContext) return true;
  const line = view.state.doc.lineAt(bookmark.from);
  return (
    (bookmark.leftContext.length > 0 && line.text.includes(bookmark.leftContext)) ||
    (bookmark.rightContext.length > 0 && line.text.includes(bookmark.rightContext))
  );
}

export type ImageUploadOptions = {
  getUploader(): ImageUploader | undefined;
};

/** Upload image files and map their insertion bookmark through local and Yjs edits. */
export function createImageUploads(options: ImageUploadOptions): {
  dispose(): void;
  extension: Extension;
  uploadFiles(view: EditorView, files: readonly File[], position?: number): boolean;
} {
  let disposed = false;
  let activeCount = 0;
  const controllers = new Set<AbortController>();
  const retryToasts = new Set<() => void>();
  const waiting: Array<(acquired: boolean) => void> = [];

  const dispose = (): void => {
    disposed = true;
    for (const controller of controllers) controller.abort();
    for (const resume of waiting.splice(0)) resume(false);
    for (const dismiss of retryToasts) dismiss();
    retryToasts.clear();
  };

  const acquire = async (): Promise<boolean> => {
    if (disposed) return false;
    if (activeCount < MAX_CONCURRENT_UPLOADS) {
      activeCount += 1;
      return true;
    }
    return new Promise((resolve) => waiting.push(resolve));
  };

  const release = (): void => {
    const resume = waiting.shift();
    if (resume) resume(true);
    else activeCount -= 1;
  };

  const insertResults = (
    view: EditorView,
    id: string,
    outcomes: readonly UploadOutcome[],
    preserveSelection: boolean,
  ): void => {
    const bookmark = view.state.field(imageBookmarkField, false)?.get(id);
    if (!bookmark) return;
    const markdown = outcomes.flatMap((outcome) =>
      outcome && 'markdown' in outcome ? [outcome.markdown] : [],
    );
    if (view.state.readOnly || markdown.length === 0 || !destinationStillExists(view, bookmark)) {
      view.dispatch({ effects: removeBookmark.of(id) });
      return;
    }
    const { from, to, selectedText } = bookmark;
    const replaceSelection =
      selectedText.length > 0 && view.state.sliceDoc(from, to) === selectedText;
    const replaceTo = replaceSelection ? to : from;
    const prefix = from > 0 && !/\s$/.test(view.state.sliceDoc(from - 1, from)) ? ' ' : '';
    const suffix =
      replaceTo < view.state.doc.length &&
      !/^\s/.test(view.state.sliceDoc(replaceTo, replaceTo + 1))
        ? ' '
        : '';
    const inserted = `${prefix}${markdown.join(' ')}${suffix}`;
    view.dispatch({
      changes: { from, to: replaceTo, insert: inserted },
      effects: removeBookmark.of(id),
      ...(!preserveSelection ? { selection: { anchor: from + inserted.length } } : {}),
      scrollIntoView: true,
      userEvent: 'input',
    });
  };

  const startUploads = (
    view: EditorView,
    inputFiles: readonly File[],
    { position, preserveSelection = false, retryKeys, previousOutcomes }: UploadRunOptions = {},
  ): boolean => {
    const uploader = options.getUploader();
    const files = inputFiles.filter(supportedImage);
    if (
      disposed ||
      view.state.readOnly ||
      !uploader ||
      files.length === 0 ||
      (position !== undefined && (position < 0 || position > view.state.doc.length))
    ) {
      return false;
    }

    const id = crypto.randomUUID();
    const keys = files.map((_, index) => retryKeys?.[index] ?? crypto.randomUUID());
    const bookmark = makeBookmark(view, id, position);
    view.dispatch({ effects: addBookmark.of(bookmark) });

    void (async () => {
      const outcomes: UploadOutcome[] = previousOutcomes
        ? [...previousOutcomes]
        : Array.from({ length: files.length }, () => null);
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < files.length && !disposed) {
          const index = next++;
          const file = files[index];
          if (outcomes[index] !== null) continue;
          if (!file || !(await acquire())) continue;
          const controller = new AbortController();
          controllers.add(controller);
          try {
            const uploaded = await uploader(file, controller.signal, keys[index]);
            outcomes[index] = { markdown: uploaded.markdown };
          } catch (error) {
            outcomes[index] = { error, index };
          } finally {
            controllers.delete(controller);
            release();
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(MAX_CONCURRENT_UPLOADS, files.length) }, worker),
      );
      if (disposed || !view.dom.isConnected) return;

      const bookmarkNow = view.state.field(imageBookmarkField, false)?.get(id);
      if (!bookmarkNow) return;
      const failures = outcomes.filter(
        (outcome): outcome is { error: unknown; index: number } =>
          outcome !== null && 'error' in outcome,
      );
      const retryable = failures.filter(
        ({ error }) =>
          !(error instanceof Error && error.name === 'AbortError') &&
          !(
            error instanceof ApiError &&
            error.status >= 400 &&
            error.status < 500 &&
            !(error.status === 409 && error.code === 'idempotency_in_progress')
          ),
      );
      const retryIndexes = new Set(retryable.map(({ index }) => index));
      const canRetry =
        retryable.length > 0 && !view.state.readOnly && destinationStillExists(view, bookmarkNow);
      if (!canRetry) insertResults(view, id, outcomes, preserveSelection);

      const visibleFailures = failures.filter(
        ({ error }) => !(error instanceof Error && error.name === 'AbortError'),
      );
      if (visibleFailures.length > 0) {
        let retried = false;
        const message =
          visibleFailures.length === 1
            ? `${canRetry ? 'Upload may have completed' : 'Upload failed'}: ${visibleFailures[0]?.error instanceof Error ? visibleFailures[0].error.message : String(visibleFailures[0]?.error)}`
            : `${visibleFailures.length} image uploads failed${canRetry ? '; some may have completed' : ''}`;
        const dismiss = showErrorToast(
          message,
          canRetry
            ? {
                label: 'Retry',
                onClick: () => {
                  if (disposed || !view.dom.isConnected || view.state.readOnly) return;
                  const current = view.state.field(imageBookmarkField, false)?.get(id);
                  if (!current || !destinationStillExists(view, current)) return;
                  const nextOutcomes = outcomes.map((outcome, index) =>
                    retryIndexes.has(index) ? null : outcome,
                  );
                  if (
                    current.selectedText &&
                    view.state.sliceDoc(current.from, current.to) === current.selectedText
                  ) {
                    view.dispatch({ selection: { anchor: current.from, head: current.to } });
                    retried = startUploads(view, files, {
                      preserveSelection,
                      retryKeys: keys,
                      previousOutcomes: nextOutcomes,
                    });
                  } else {
                    retried = startUploads(view, files, {
                      position: current.from,
                      preserveSelection,
                      retryKeys: keys,
                      previousOutcomes: nextOutcomes,
                    });
                  }
                },
              }
            : undefined,
          canRetry
            ? (reason) => {
                if (dismiss) retryToasts.delete(dismiss);
                if (!disposed && view.dom.isConnected) {
                  if (retried || reason === 'clear')
                    view.dispatch({ effects: removeBookmark.of(id) });
                  else insertResults(view, id, outcomes, preserveSelection);
                }
              }
            : undefined,
        );
        if (canRetry && dismiss) retryToasts.add(dismiss);
        if (canRetry && !dismiss) insertResults(view, id, outcomes, preserveSelection);
      }
    })().catch((error: unknown) => {
      if (disposed || !view.dom.isConnected) return;
      view.dispatch({ effects: removeBookmark.of(id) });
      showErrorToast(
        `Could not insert uploaded images: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return true;
  };

  const extension: Extension = [
    imageBookmarkField,
    EditorView.domEventHandlers({
      paste(event, view) {
        if (view.state.readOnly) return false;
        const clipboard = event.clipboardData;
        const files = [...(clipboard?.files ?? [])].filter(supportedImage);
        const richPaste = parseHtmlImagePaste(clipboard?.getData('text/html') ?? '', files);
        if (richPaste?.text.trim()) {
          const selection = view.state.selection.main;
          view.dispatch({
            changes: { from: selection.from, to: selection.to, insert: richPaste.text },
            selection: { anchor: selection.from + richPaste.text.length },
            userEvent: 'input.paste',
          });
          for (const slot of richPaste.slots) {
            startUploads(view, slot.files, {
              position: selection.from + slot.offset,
              preserveSelection: true,
            });
          }
          return true;
        }
        // Image-only clipboards often also contain a duplicate text/alt
        // representation. Do not paste that as a second piece of content.
        return startUploads(
          view,
          files.length > 0 ? files : (richPaste?.slots.flatMap((slot) => slot.files) ?? []),
        );
      },
      drop(event, view) {
        if (view.state.readOnly) return false;
        const files = [...(event.dataTransfer?.files ?? [])].filter(supportedImage);
        if (files.length === 0) return false;
        const position =
          view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
          view.state.selection.main.head;
        return startUploads(view, files, { position });
      },
    }),
  ];

  return {
    dispose,
    extension,
    uploadFiles: (view, files, position) =>
      startUploads(view, files, position === undefined ? {} : { position }),
  };
}
