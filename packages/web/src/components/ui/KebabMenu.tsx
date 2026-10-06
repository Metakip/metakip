import { FloatingPortal } from '@floating-ui/react';
import { MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { useFloatingMenu } from '../../hooks/useFloatingMenu';

export type KebabMenuItem = {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
  dividerBefore?: boolean;
};

type KebabMenuProps = {
  items: KebabMenuItem[];
  triggerClassName?: string;
  menuClassName?: string;
  ariaLabel?: string;
  onOpenChange?: (isOpen: boolean) => void;
};

const defaultMenuItemClass =
  'flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/10 w-full text-left cursor-pointer rounded-xl transition-colors';

const defaultMenuClass =
  'w-40 bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 shadow-xl rounded-xl p-1.5 flex flex-col z-[9999]';

export function KebabMenu({
  items,
  triggerClassName,
  menuClassName,
  ariaLabel = 'Open menu',
  onOpenChange,
}: KebabMenuProps) {
  const kebab = useFloatingMenu();
  const menuId = useId();
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    onOpenChange?.(kebab.isMounted);
  }, [kebab.isMounted, onOpenChange]);

  useEffect(() => {
    if (!kebab.isMounted) return;
    window.requestAnimationFrame(() => itemRefs.current[0]?.focus());
  }, [kebab.isMounted]);

  const focusItem = (index: number) => {
    if (items.length === 0) return;
    const normalized = (index + items.length) % items.length;
    itemRefs.current[normalized]?.focus();
  };

  return (
    <>
      <button
        ref={kebab.refs.setReference}
        type="button"
        id={menuId}
        aria-label={ariaLabel}
        className={`${triggerClassName ?? ''} ${kebab.isOpen ? 'opacity-100 bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100' : ''}`}
        {...kebab.getReferenceProps({ onClick: (e) => e.stopPropagation() })}
      >
        <MoreHorizontal size={16} />
      </button>

      {kebab.isMounted && (
        <FloatingPortal>
          <div
            ref={kebab.refs.setFloating}
            style={kebab.floatingStyles}
            {...kebab.getFloatingProps()}
            className="z-[9999]"
          >
            <div
              style={kebab.transitionStyles}
              role="menu"
              aria-labelledby={menuId}
              className={menuClassName ?? defaultMenuClass}
            >
              {items.map((item, index) => (
                <div key={item.label}>
                  {item.dividerBefore && (
                    <hr className="mx-1 my-1 border-0 h-px bg-zinc-200 dark:bg-zinc-700" />
                  )}
                  <button
                    ref={(element) => {
                      itemRefs.current[index] = element;
                    }}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={(e) => {
                      e.stopPropagation();
                      kebab.close();
                      item.onClick();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        focusItem(index + (event.key === 'ArrowDown' ? 1 : -1));
                      } else if (event.key === 'Home' || event.key === 'End') {
                        event.preventDefault();
                        focusItem(event.key === 'Home' ? 0 : items.length - 1);
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        kebab.close();
                        const reference = kebab.refs.domReference.current;
                        if (reference instanceof HTMLElement) reference.focus();
                      }
                    }}
                    className={`${defaultMenuItemClass} ${item.className ?? ''}`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
