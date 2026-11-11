import { Menu } from '@base-ui/react/menu';
import { MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';

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
  triggerContent?: ReactNode;
  triggerClassName?: string;
  menuClassName?: string;
  ariaLabel?: string;
  onOpenChange?: (isOpen: boolean) => void;
};

const defaultMenuItemClass =
  'flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 data-highlighted:bg-black/5 dark:data-highlighted:bg-white/10 w-full text-left cursor-pointer rounded-xl outline-none transition-colors data-disabled:cursor-not-allowed data-disabled:opacity-50';

const defaultMenuClass =
  'w-40 bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 shadow-xl rounded-xl p-1.5 flex flex-col z-[9999]';

export function KebabMenu({
  items,
  triggerContent,
  triggerClassName,
  menuClassName,
  ariaLabel = 'Open menu',
  onOpenChange,
}: KebabMenuProps) {
  return (
    <Menu.Root modal={false} onOpenChange={onOpenChange}>
      <Menu.Trigger
        aria-label={ariaLabel}
        className={`${triggerClassName ?? ''} cursor-pointer data-popup-open:opacity-100 data-popup-open:bg-zinc-200 dark:data-popup-open:bg-zinc-700 data-popup-open:text-zinc-900 dark:data-popup-open:text-zinc-100`}
        onClick={(event) => event.stopPropagation()}
      >
        {triggerContent ?? <MoreHorizontal size={16} />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-[9999]">
          <Menu.Popup
            className={`${menuClassName ?? defaultMenuClass} max-h-[var(--available-height)] overflow-y-auto outline-none origin-[var(--transform-origin)] transition-[opacity,transform] duration-100 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0`}
          >
            {items.map((item) => (
              <div key={item.label}>
                {item.dividerBefore && (
                  <Menu.Separator className="mx-1 my-1 h-px bg-zinc-200 dark:bg-zinc-700" />
                )}
                <Menu.Item
                  disabled={item.disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    item.onClick();
                  }}
                  className={`${defaultMenuItemClass} ${item.className ?? ''}`}
                >
                  {item.icon}
                  {item.label}
                </Menu.Item>
              </div>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
