import type { EditorView } from '@codemirror/view';
import { ensureAbsoluteUrl } from '../../utils/url';

export interface LinkEditorOptions {
  initialUrl: string;
  initialText: string;
  onConfirm: (values: { url: string; text: string }) => void;
  onRemove: () => void;
}

export class LinkEditor {
  private tooltip: HTMLDivElement | null = null;
  private popup: HTMLDivElement | null = null;
  private cleanupHandlers: Array<() => void> = [];
  private closeTimer: number | null = null;

  open(view: EditorView, anchorElement: HTMLElement, options: LinkEditorOptions): void {
    this.close();

    this.tooltip = this.createTooltip(options);
    this.positionFloatingElement(this.tooltip, anchorElement, 320, 52);
    this.attachTooltipEvents(view, anchorElement, options);

    document.body.appendChild(this.tooltip);
  }

  close(): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }

    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }

    for (const cleanup of this.cleanupHandlers) {
      cleanup();
    }
    this.cleanupHandlers = [];
  }

  private createTooltip(options: LinkEditorOptions): HTMLDivElement {
    const tooltip = document.createElement('div');
    tooltip.className = 'link-hover-tooltip';
    tooltip.style.zIndex = '1000';

    const urlText = document.createElement('a');
    const safeUrl = ensureAbsoluteUrl(options.initialUrl);
    if (safeUrl) {
      urlText.href = safeUrl;
      urlText.target = '_blank';
      urlText.rel = 'noopener noreferrer';
    } else {
      urlText.setAttribute('aria-disabled', 'true');
    }
    urlText.textContent = options.initialUrl;
    urlText.title = options.initialText || options.initialUrl;

    const actions = document.createElement('div');

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'link-hover-tooltip-edit';
    editButton.textContent = 'Edit';

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'link-hover-tooltip-remove';
    removeButton.textContent = 'Remove';

    actions.appendChild(editButton);
    actions.appendChild(removeButton);

    tooltip.appendChild(urlText);
    tooltip.appendChild(actions);

    return tooltip;
  }

  private createPopup(options: LinkEditorOptions): HTMLDivElement {
    const popup = document.createElement('div');
    popup.className = 'link-editor-popup';

    const header = document.createElement('div');
    header.className = 'link-editor-header';
    header.textContent = 'Edit Link';

    const textLabel = document.createElement('div');
    textLabel.className = 'link-editor-header';
    textLabel.style.fontSize = '11px';
    textLabel.style.marginTop = '4px';
    textLabel.textContent = 'Text';

    const textInput = document.createElement('input');
    textInput.className = 'link-editor-input link-editor-input-text';
    textInput.type = 'text';
    textInput.value = options.initialText;
    textInput.placeholder = 'Display text';

    const urlLabel = document.createElement('div');
    urlLabel.className = 'link-editor-header';
    urlLabel.style.fontSize = '11px';
    urlLabel.style.marginTop = '4px';
    urlLabel.textContent = 'URL';

    const urlInput = document.createElement('input');
    urlInput.className = 'link-editor-input link-editor-input-url';
    urlInput.type = 'url';
    urlInput.value = options.initialUrl;
    urlInput.placeholder = 'https://example.com';

    const buttons = document.createElement('div');
    buttons.className = 'link-editor-buttons';

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'link-editor-btn link-editor-btn-remove';
    removeButton.textContent = 'Remove Link';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'link-editor-btn link-editor-btn-cancel';
    cancelButton.textContent = 'Cancel';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'link-editor-btn link-editor-btn-save';
    saveButton.textContent = 'Save';

    buttons.appendChild(removeButton);
    buttons.appendChild(cancelButton);
    buttons.appendChild(saveButton);

    popup.appendChild(header);
    popup.appendChild(textLabel);
    popup.appendChild(textInput);
    popup.appendChild(urlLabel);
    popup.appendChild(urlInput);
    popup.appendChild(buttons);

    return popup;
  }

  private positionFloatingElement(
    element: HTMLDivElement,
    anchorElement: HTMLElement,
    width: number,
    height: number,
  ): void {
    const coords = anchorElement.getBoundingClientRect();

    let left = coords.left;
    let top = coords.bottom + 8 + window.scrollY;

    if (left + width > window.innerWidth) {
      left = window.innerWidth - width - 16;
    }
    if (top + height > window.innerHeight + window.scrollY) {
      top = coords.top - height - 8 + window.scrollY;
    }

    element.style.left = `${Math.max(16, left)}px`;
    element.style.top = `${top}px`;
  }

  private attachTooltipEvents(
    view: EditorView,
    anchorElement: HTMLElement,
    options: LinkEditorOptions,
  ): void {
    if (!this.tooltip) return;

    const editButton = this.tooltip.querySelector('.link-hover-tooltip-edit');
    const removeButton = this.tooltip.querySelector('.link-hover-tooltip-remove');

    if (
      !(editButton instanceof HTMLButtonElement) ||
      !(removeButton instanceof HTMLButtonElement)
    ) {
      return;
    }

    const cancelCloseTimer = (): void => {
      if (this.closeTimer !== null) {
        window.clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }
    };

    const scheduleClose = (): void => {
      cancelCloseTimer();
      this.closeTimer = window.setTimeout(() => {
        this.close();
      }, 150);
    };

    const handleAnchorEnter = (): void => {
      cancelCloseTimer();
    };

    const handleAnchorLeave = (event: MouseEvent): void => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && this.tooltip?.contains(nextTarget)) {
        return;
      }
      scheduleClose();
    };

    const handleTooltipEnter = (): void => {
      cancelCloseTimer();
    };

    const handleTooltipLeave = (event: MouseEvent): void => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && anchorElement.contains(nextTarget)) {
        return;
      }
      scheduleClose();
    };

    const handleEdit = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      cancelCloseTimer();
      this.openPopup(view, anchorElement, options);
    };

    const handleRemove = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      options.onRemove();
      this.close();
      view.focus();
    };

    anchorElement.addEventListener('mouseenter', handleAnchorEnter);
    anchorElement.addEventListener('mouseleave', handleAnchorLeave);
    this.tooltip.addEventListener('mouseenter', handleTooltipEnter);
    this.tooltip.addEventListener('mouseleave', handleTooltipLeave);
    editButton.addEventListener('click', handleEdit);
    removeButton.addEventListener('click', handleRemove);

    this.cleanupHandlers.push(() => {
      anchorElement.removeEventListener('mouseenter', handleAnchorEnter);
      anchorElement.removeEventListener('mouseleave', handleAnchorLeave);
      this.tooltip?.removeEventListener('mouseenter', handleTooltipEnter);
      this.tooltip?.removeEventListener('mouseleave', handleTooltipLeave);
      editButton.removeEventListener('click', handleEdit);
      removeButton.removeEventListener('click', handleRemove);
    });
  }

  private openPopup(
    view: EditorView,
    anchorElement: HTMLElement,
    options: LinkEditorOptions,
  ): void {
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }

    this.popup = this.createPopup(options);
    this.positionFloatingElement(this.popup, anchorElement, 400, 240);
    document.body.appendChild(this.popup);
    this.attachPopupEvents(view, options);
    this.focusPopupInput();
  }

  private attachPopupEvents(view: EditorView, options: LinkEditorOptions): void {
    if (!this.popup) return;

    const textInput = this.popup.querySelector('.link-editor-input-text');
    const urlInput = this.popup.querySelector('.link-editor-input-url');
    const saveButton = this.popup.querySelector('.link-editor-btn-save');
    const cancelButton = this.popup.querySelector('.link-editor-btn-cancel');
    const removeButton = this.popup.querySelector('.link-editor-btn-remove');

    if (
      !(textInput instanceof HTMLInputElement) ||
      !(urlInput instanceof HTMLInputElement) ||
      !(saveButton instanceof HTMLButtonElement) ||
      !(cancelButton instanceof HTMLButtonElement) ||
      !(removeButton instanceof HTMLButtonElement)
    ) {
      return;
    }

    const close = (): void => {
      this.close();
      view.focus();
    };

    saveButton.addEventListener('click', () => {
      const newUrl = urlInput.value.trim();
      const newText = textInput.value.trim();
      const safeUrl = ensureAbsoluteUrl(newUrl);
      if (!safeUrl) {
        urlInput.setCustomValidity('Enter a safe HTTP, HTTPS, email, phone, or relative link');
        urlInput.reportValidity();
        return;
      }
      urlInput.setCustomValidity('');
      if (newText) {
        options.onConfirm({ url: safeUrl, text: newText });
        close();
      }
    });

    cancelButton.addEventListener('click', () => {
      close();
    });

    removeButton.addEventListener('click', () => {
      options.onRemove();
      close();
    });

    const handleEnter = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveButton.click();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelButton.click();
      }
    };

    textInput.addEventListener('keydown', handleEnter);
    urlInput.addEventListener('keydown', handleEnter);

    const handleClickOutside = (event: MouseEvent): void => {
      if (this.popup && !this.popup.contains(event.target as Node)) {
        close();
        document.removeEventListener('mousedown', handleClickOutside);
      }
    };

    setTimeout(() => {
      if (this.popup) document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    this.cleanupHandlers.push(() => {
      document.removeEventListener('mousedown', handleClickOutside);
    });
  }

  private focusPopupInput(): void {
    setTimeout(() => {
      const input = this.popup?.querySelector('.link-editor-input-url');
      if (input instanceof HTMLInputElement) {
        input.focus();
      }
    }, 0);
  }
}

export const linkEditor = new LinkEditor();
