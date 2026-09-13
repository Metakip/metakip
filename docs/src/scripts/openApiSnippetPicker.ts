interface PickerState {
  highlightedIndex: number;
  label: HTMLSpanElement;
  menu: HTMLDivElement;
  optionButtons: HTMLButtonElement[];
  options: HTMLOptionElement[];
  select: HTMLSelectElement;
  selectedIndex: number;
  trigger: HTMLButtonElement;
}

let activePicker: PickerState | null = null;
let initialized = false;
let pickerId = 0;

function getSelectedIndex(state: PickerState): number {
  const index = state.options.findIndex((option) => option.value === state.select.value);
  return index >= 0 ? index : 0;
}

function updateOptionState(state: PickerState): void {
  state.selectedIndex = getSelectedIndex(state);
  const selectedOption = state.options[state.selectedIndex];
  state.label.textContent = selectedOption?.textContent?.trim() ?? '';

  state.trigger.setAttribute('aria-label', `Code sample: ${state.label.textContent}`);

  state.optionButtons.forEach((button, index) => {
    const isSelected = index === state.selectedIndex;
    button.setAttribute('aria-selected', String(isSelected));
    button.tabIndex = index === state.highlightedIndex ? 0 : -1;
  });
}

function highlightOption(state: PickerState, index: number, focus = true): void {
  const normalizedIndex = (index + state.options.length) % state.options.length;
  state.highlightedIndex = normalizedIndex;
  state.optionButtons.forEach((button, buttonIndex) => {
    button.dataset.highlighted = String(buttonIndex === normalizedIndex);
    button.tabIndex = buttonIndex === normalizedIndex ? 0 : -1;
  });

  if (focus) state.optionButtons[normalizedIndex]?.focus();
}

function positionPicker(state: PickerState): void {
  const referenceRect = state.trigger.getBoundingClientRect();
  const viewportPadding = 8;
  const menuWidth = Math.max(referenceRect.width, state.menu.offsetWidth);
  const maxLeft = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding);
  const left = Math.min(Math.max(referenceRect.left, viewportPadding), maxLeft);
  const preferredTop = referenceRect.bottom + 4;
  const menuHeight = state.menu.offsetHeight;
  const canFlipAbove = referenceRect.top - menuHeight - 4 >= viewportPadding;
  const top =
    preferredTop + menuHeight > window.innerHeight - viewportPadding && canFlipAbove
      ? referenceRect.top - menuHeight - 4
      : Math.min(preferredTop, window.innerHeight - menuHeight - viewportPadding);

  state.menu.style.left = `${left}px`;
  state.menu.style.minWidth = `${referenceRect.width}px`;
  state.menu.style.top = `${Math.max(viewportPadding, top)}px`;
}

function closePicker(restoreFocus = false): void {
  if (!activePicker) return;

  const state = activePicker;
  activePicker = null;
  state.menu.hidden = true;
  delete state.menu.dataset.open;
  state.trigger.setAttribute('aria-expanded', 'false');

  if (restoreFocus) state.trigger.focus();
}

function openPicker(state: PickerState, preferredIndex = state.selectedIndex): void {
  if (activePicker && activePicker !== state) closePicker();

  activePicker = state;
  state.highlightedIndex = preferredIndex;
  state.menu.hidden = false;
  state.menu.dataset.open = 'true';
  state.trigger.setAttribute('aria-expanded', 'true');
  positionPicker(state);
  highlightOption(state, preferredIndex, false);

  window.requestAnimationFrame(() => {
    positionPicker(state);
    state.optionButtons[state.highlightedIndex]?.focus();
  });
}

function selectOption(state: PickerState, index: number): void {
  const option = state.options[index];
  if (!option) return;

  state.select.value = option.value;
  state.select.dispatchEvent(new Event('change', { bubbles: true }));
  updateOptionState(state);
  closePicker(true);
}

function normalizeOptions(select: HTMLSelectElement): HTMLOptionElement[] {
  const options = [...select.querySelectorAll('option')];

  for (const option of options) {
    const group = option.parentElement;
    if (
      option.value === 'javascript:fetch' ||
      (group instanceof HTMLOptGroupElement && group.label === 'JavaScript')
    ) {
      option.textContent = 'JavaScript';
    }
    select.append(option);
  }

  for (const group of select.querySelectorAll('optgroup')) group.remove();
  return options;
}

function createOptionButton(
  state: PickerState,
  option: HTMLOptionElement,
  index: number,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = `${state.menu.id}-option-${index}`;
  button.className = 'metakip-openapi-picker-option';
  button.setAttribute('role', 'option');
  button.tabIndex = -1;

  const label = document.createElement('span');
  label.className = 'metakip-openapi-picker-option-label';
  label.textContent = option.textContent?.trim() ?? '';

  const check = document.createElement('span');
  check.className = 'metakip-openapi-picker-check';
  check.setAttribute('aria-hidden', 'true');
  check.textContent = '✓';

  button.append(label, check);
  button.addEventListener('mouseenter', () => highlightOption(state, index, false));
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  button.addEventListener('click', () => selectOption(state, index));
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      highlightOption(state, index + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      highlightOption(state, event.key === 'Home' ? 0 : state.options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectOption(state, index);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closePicker(true);
    } else if (event.key === 'Tab') {
      closePicker();
    }
  });

  return button;
}

function enhancePicker(picker: HTMLElement): void {
  if (picker.dataset.metakipPicker === 'true') return;

  const select = picker.querySelector('select');
  const originalRoot = picker.querySelector<HTMLElement>('.sl-openapi-snippet-picker');
  if (!(select instanceof HTMLSelectElement) || !originalRoot) return;

  const options = normalizeOptions(select);
  if (options.length === 0) return;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'metakip-openapi-picker-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const label = document.createElement('span');
  label.className = 'metakip-openapi-picker-label';

  const caret = document.createElement('span');
  caret.className = 'metakip-openapi-picker-caret';
  caret.setAttribute('aria-hidden', 'true');

  trigger.append(label, caret);

  const menu = document.createElement('div');
  menu.id = `metakip-openapi-picker-${pickerId++}`;
  menu.className = 'metakip-openapi-picker-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Choose a code sample');

  const state: PickerState = {
    highlightedIndex: 0,
    label,
    menu,
    optionButtons: [],
    options,
    select,
    selectedIndex: 0,
    trigger,
  };

  for (const [index, option] of options.entries()) {
    const button = createOptionButton(state, option, index);
    state.optionButtons.push(button);
    menu.append(button);
  }

  select.hidden = true;
  select.setAttribute('aria-hidden', 'true');
  const root = document.createElement('div');
  root.className = originalRoot.className;
  root.append(trigger, select);
  originalRoot.replaceWith(root);
  document.body.append(menu);
  picker.dataset.metakipPicker = 'true';

  select.addEventListener('change', () => updateOptionState(state));
  trigger.setAttribute('aria-controls', menu.id);
  trigger.addEventListener('click', () => {
    if (activePicker === state) closePicker();
    else openPicker(state);
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = event.key === 'ArrowDown' ? 0 : -1;
      openPicker(
        state,
        (state.selectedIndex + offset + state.options.length) % state.options.length,
      );
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      openPicker(state, event.key === 'Home' ? 0 : state.options.length - 1);
    } else if ((event.key === 'Enter' || event.key === ' ') && activePicker !== state) {
      event.preventDefault();
      openPicker(state);
    } else if (event.key === 'Escape' && activePicker === state) {
      event.preventDefault();
      closePicker();
    }
  });

  updateOptionState(state);
}

function enhancePickers(): void {
  for (const picker of document.querySelectorAll<HTMLElement>('sl-openapi-snippet-picker')) {
    enhancePicker(picker);
  }
}

export function initializeOpenAPISnippetPickers(): void {
  if (initialized) return;
  initialized = true;

  document.addEventListener('pointerdown', (event) => {
    if (!activePicker || !(event.target instanceof Node)) return;
    if (activePicker.trigger.contains(event.target) || activePicker.menu.contains(event.target))
      return;
    closePicker();
  });
  document.addEventListener('astro:before-swap', () => {
    closePicker();
    for (const menu of document.querySelectorAll('.metakip-openapi-picker-menu')) menu.remove();
  });
  document.addEventListener('astro:page-load', enhancePickers);
  window.addEventListener('resize', () => {
    if (activePicker) positionPicker(activePicker);
  });
  window.addEventListener(
    'scroll',
    () => {
      if (activePicker) positionPicker(activePicker);
    },
    true,
  );

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhancePickers, { once: true });
  } else {
    window.requestAnimationFrame(enhancePickers);
  }
}
