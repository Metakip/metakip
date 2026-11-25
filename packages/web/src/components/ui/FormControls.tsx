import { FloatingPortal } from '@floating-ui/react';
import type { StyleXStyles } from '@stylexjs/stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, ChevronDown } from 'lucide-react';
import type React from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useFloatingMenu } from '../../hooks/useFloatingMenu';
import { styles } from './FormControls.stylex';

type TextBoxProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'className' | 'onChange' | 'type' | 'value'
> & {
  value: string;
  onChange: (value: string) => void;
  leadingIcon?: React.ReactNode;
  rightSlot?: React.ReactNode;
  rootStyle?: StyleXStyles;
  inputStyle?: StyleXStyles;
  type?: React.HTMLInputTypeAttribute;
};

export function TextBox({
  value,
  onChange,
  placeholder,
  readOnly = false,
  leadingIcon,
  rightSlot,
  rootStyle,
  inputStyle,
  type = 'text',
  style,
  ...inputProps
}: TextBoxProps) {
  return (
    <div {...stylex.props(styles.textBox, rootStyle)}>
      {leadingIcon ? <div {...stylex.props(styles.leadingIcon)}>{leadingIcon}</div> : null}
      <input
        {...inputProps}
        type={type}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        {...stylex.props(styles.textInput, inputStyle)}
        style={{
          border: 'none',
          boxShadow: 'none',
          outline: 'none',
          background: 'transparent',
          ...style,
        }}
      />
      {rightSlot ? <div {...stylex.props(styles.rightSlot)}>{rightSlot}</div> : null}
    </div>
  );
}

export const TextField = TextBox;

type DropdownOption<TValue extends string> = {
  value: TValue;
  label: string;
};

type DropdownProps<TValue extends string> = {
  value: TValue;
  options: Array<DropdownOption<TValue>>;
  onChange: (value: TValue) => void;
  ariaLabel: string;
  disabled?: boolean;
  rootStyle?: StyleXStyles;
  triggerStyle?: StyleXStyles;
};

export function Dropdown<TValue extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  rootStyle,
  triggerStyle,
}: DropdownProps<TValue>) {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();

  const currentLabel = useMemo(
    () => options.find((option) => option.value === value)?.label ?? '',
    [options, value],
  );

  const selectedIndex = useMemo(() => {
    const index = options.findIndex((option) => option.value === value);
    return index >= 0 ? index : 0;
  }, [options, value]);

  const menu = useFloatingMenu({
    align: 'start',
    matchReferenceWidth: true,
    role: 'listbox',
    onOpen: () => setHighlightedIndex(selectedIndex),
  });
  const open = menu.isOpen;

  const openMenu = (preferredIndex = selectedIndex) => {
    setHighlightedIndex(preferredIndex);
    menu.open();
  };

  const closeMenu = (restoreFocus = false) => {
    if (restoreFocus) {
      const reference = menu.refs.domReference.current;
      if (reference instanceof HTMLElement) reference.focus();
    }
    menu.close();
  };

  const selectOption = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    closeMenu(true);
  };

  const focusOption = (index: number) => {
    const normalized = (index + options.length) % options.length;
    setHighlightedIndex(normalized);
    optionRefs.current[normalized]?.focus();
  };

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => optionRefs.current[highlightedIndex]?.focus());
  }, [open, highlightedIndex]);

  return (
    <div {...stylex.props(styles.dropdown, rootStyle)}>
      <button
        ref={menu.refs.setReference}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        {...menu.getReferenceProps({
          onKeyDown: (event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (!open) {
                const offset = event.key === 'ArrowDown' ? 0 : -1;
                openMenu((selectedIndex + offset + options.length) % options.length);
              } else {
                focusOption(highlightedIndex + (event.key === 'ArrowDown' ? 1 : -1));
              }
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              if (!open) openMenu(event.key === 'Home' ? 0 : options.length - 1);
              else focusOption(event.key === 'Home' ? 0 : options.length - 1);
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              closeMenu();
            }
          },
        })}
        {...stylex.props(styles.dropdownTrigger, triggerStyle)}
      >
        <span {...stylex.props(styles.dropdownLabel)}>{currentLabel}</span>
        <ChevronDown
          size={14}
          {...stylex.props(styles.dropdownChevron, open && styles.dropdownChevronOpen)}
        />
      </button>

      {menu.isMounted && (
        <FloatingPortal>
          <div
            ref={menu.refs.setFloating}
            id={listboxId}
            role="listbox"
            aria-label="Choose an option"
            style={{ ...menu.floatingStyles, ...menu.transitionStyles }}
            {...menu.getFloatingProps()}
            className={stylex.props(styles.dropdownMenu).className}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {options.map((option, index) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  type="button"
                  role="option"
                  aria-selected={active}
                  tabIndex={index === highlightedIndex ? 0 : -1}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectOption(index);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      focusOption(index + (event.key === 'ArrowDown' ? 1 : -1));
                    } else if (event.key === 'Home' || event.key === 'End') {
                      event.preventDefault();
                      focusOption(event.key === 'Home' ? 0 : options.length - 1);
                    } else if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectOption(index);
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      closeMenu(true);
                    } else if (event.key === 'Tab') {
                      closeMenu();
                    }
                  }}
                  {...stylex.props(styles.dropdownOption, active && styles.dropdownOptionActive)}
                >
                  <span {...stylex.props(styles.dropdownLabel)}>{option.label}</span>
                  {active ? <Check size={14} {...stylex.props(styles.dropdownCheck)} /> : null}
                </button>
              );
            })}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}

type ChoiceGroupOption<TValue extends string> = {
  value: TValue;
  label: string;
};

type ChoiceGroupProps<TValue extends string> = {
  value: TValue;
  options: Array<ChoiceGroupOption<TValue>>;
  onChange: (value: TValue) => void;
  disabled?: boolean;
  rootStyle?: StyleXStyles;
  ariaLabel?: string;
};

export function ChoiceGroup<TValue extends string>({
  value,
  options,
  onChange,
  disabled = false,
  rootStyle,
  ariaLabel = 'Choose an option',
}: ChoiceGroupProps<TValue>) {
  return (
    <fieldset
      aria-label={ariaLabel}
      disabled={disabled}
      {...stylex.props(styles.choiceGroup, disabled && styles.choiceGroupDisabled, rootStyle)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            {...stylex.props(
              styles.choiceButton,
              active ? styles.choiceActive : styles.choiceInactive,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}
