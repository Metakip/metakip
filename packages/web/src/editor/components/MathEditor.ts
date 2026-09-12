import type { EditorView } from '@codemirror/view';

export type MathDisplayMode = 'inline' | 'block';

interface MathEditorOptions {
  initialValue: string;
  displayMode: MathDisplayMode;
  onConfirm: (newValue: string) => void;
  onCancel: () => void;
}

export class MathEditor {
  private popup: HTMLDivElement | null = null;
  private cleanup: (() => void) | null = null;

  open(view: EditorView, anchorElement: HTMLElement, options: MathEditorOptions): void {
    this.close();

    this.popup = this.createPopup(options);
    this.positionPopup(anchorElement);
    this.attachEvents(view, options);

    document.body.appendChild(this.popup);
    this.focusEditor();
  }

  close(): void {
    this.cleanup?.();
    this.cleanup = null;
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }
  }

  private createPopup(options: MathEditorOptions): HTMLDivElement {
    const popup = document.createElement('div');
    popup.className = 'math-editor-popup';

    const header = this.createHeader(options.displayMode);
    const textarea = this.createTextarea(options);
    const buttons = this.createButtons();

    popup.appendChild(header);
    popup.appendChild(textarea);
    popup.appendChild(buttons.container);

    return popup;
  }

  private createHeader(displayMode: MathDisplayMode): HTMLDivElement {
    const header = document.createElement('div');
    header.className = 'math-editor-header';
    header.textContent = displayMode === 'block' ? 'Edit Block Equation' : 'Edit Equation';
    return header;
  }

  private createTextarea(options: MathEditorOptions): HTMLTextAreaElement {
    const textarea = document.createElement('textarea');
    textarea.className = 'math-editor-textarea';
    textarea.value = options.initialValue;
    textarea.placeholder = 'Enter LaTeX...';
    textarea.rows = options.displayMode === 'block' ? 5 : 3;
    return textarea;
  }

  private createButtons(): {
    container: HTMLDivElement;
    done: HTMLButtonElement;
    cancel: HTMLButtonElement;
  } {
    const container = document.createElement('div');
    container.className = 'math-editor-buttons';

    const cancel = document.createElement('button');
    cancel.className = 'math-editor-btn math-editor-btn-cancel';
    cancel.textContent = 'Cancel';

    const done = document.createElement('button');
    done.className = 'math-editor-btn math-editor-btn-done';
    done.textContent = 'Done';

    container.appendChild(cancel);
    container.appendChild(done);

    return { container, done, cancel };
  }

  private positionPopup(anchorElement: HTMLElement): void {
    if (!this.popup) return;

    const coords = anchorElement.getBoundingClientRect();
    const popupWidth = 400;
    const popupHeight = 200;

    let left = coords.left;
    let top = coords.bottom + 8 + window.scrollY;

    // Keep popup within viewport
    if (left + popupWidth > window.innerWidth) {
      left = window.innerWidth - popupWidth - 16;
    }
    if (top + popupHeight > window.innerHeight + window.scrollY) {
      top = coords.top - popupHeight - 8 + window.scrollY;
    }

    this.popup.style.left = `${Math.max(16, left)}px`;
    this.popup.style.top = `${top}px`;
  }

  private attachEvents(view: EditorView, options: MathEditorOptions): void {
    if (!this.popup) return;

    const textarea = this.popup.querySelector('textarea') as HTMLTextAreaElement;
    const doneBtn = this.popup.querySelector('.math-editor-btn-done') as HTMLButtonElement;
    const cancelBtn = this.popup.querySelector('.math-editor-btn-cancel') as HTMLButtonElement;

    const close = () => {
      this.close();
      view.focus();
    };

    doneBtn.addEventListener('click', () => {
      const newValue = textarea.value.trim();
      if (newValue !== options.initialValue) {
        options.onConfirm(newValue);
      }
      close();
    });

    cancelBtn.addEventListener('click', () => {
      options.onCancel();
      close();
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doneBtn.click();
      }
      if (e.key === 'Escape') {
        cancelBtn.click();
      }
    });

    // Close on click outside
    const handleClickOutside = (e: MouseEvent) => {
      if (this.popup && !this.popup.contains(e.target as Node)) {
        close();
        document.removeEventListener('mousedown', handleClickOutside);
      }
    };
    setTimeout(() => {
      if (this.popup) document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    this.cleanup = () => document.removeEventListener('mousedown', handleClickOutside);
  }

  private focusEditor(): void {
    setTimeout(() => {
      const textarea = this.popup?.querySelector('textarea');
      if (textarea) {
        textarea.focus();
        textarea.select();
      }
    }, 0);
  }
}

export const mathEditor = new MathEditor();
