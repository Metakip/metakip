import { Menu } from '@base-ui/react/menu';
import type { StyleXStyles } from '@stylexjs/stylex';
import * as stylex from '@stylexjs/stylex';
import { MoreHorizontal } from 'lucide-react';
import { type CSSProperties, Fragment, type ReactNode } from 'react';
import { styles } from './KebabMenu.stylex';

type KebabMenuAction = {
  type?: 'action';
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: 'default' | 'destructive';
  disabled?: boolean;
  dividerBefore?: boolean;
};

export type KebabMenuRadioOption = {
  label: string;
  value: string;
  onSelect: () => void;
  icon?: ReactNode;
  disabled?: boolean;
};

type KebabMenuRadioGroup = {
  type: 'radio-group';
  label: string;
  value: string;
  options: readonly KebabMenuRadioOption[];
  dividerBefore?: boolean;
};

export type KebabMenuItem = KebabMenuAction | KebabMenuRadioGroup;

type KebabMenuProps = {
  items: KebabMenuItem[];
  triggerContent?: ReactNode;
  triggerStyle?: StyleXStyles;
  popupStyle?: StyleXStyles;
  popupWidth?: '10rem' | '11rem' | '12rem';
  ariaLabel?: string;
  onOpenChange?: (isOpen: boolean) => void;
};

function MenuItems({ items }: { items: KebabMenuItem[] }) {
  return items.map((item, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: labels are display text and may repeat.
    <Fragment key={`${item.label}-${index}`}>
      {item.dividerBefore && (
        <Menu.Separator className={stylex.props(styles.separator).className} />
      )}
      {item.type === 'radio-group' ? (
        <Menu.RadioGroup
          aria-label={item.label}
          value={item.value}
          onValueChange={(value: unknown) => {
            const option = item.options.find((candidate) => candidate.value === value);
            if (!option) throw new Error('Menu selected an unknown radio option');
            option.onSelect();
          }}
        >
          {item.options.map((option) => (
            <Menu.RadioItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              closeOnClick
              onClick={(event) => event.stopPropagation()}
              {...stylex.props(
                styles.menuItem,
                item.value === option.value && styles.selectedMenuItem,
                option.disabled && styles.disabledMenuItem,
              )}
              data-kebab-menu-item=""
            >
              {option.icon}
              {option.label}
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      ) : (
        <Menu.Item
          disabled={item.disabled}
          onClick={(event) => {
            event.stopPropagation();
            item.onClick();
          }}
          {...stylex.props(
            styles.menuItem,
            item.variant === 'destructive' && styles.destructiveItem,
            item.disabled && styles.disabledMenuItem,
          )}
          data-kebab-menu-item=""
          data-kebab-destructive={item.variant === 'destructive' ? '' : undefined}
        >
          {item.icon}
          {item.label}
        </Menu.Item>
      )}
    </Fragment>
  ));
}

export function KebabMenu({
  items,
  triggerContent,
  triggerStyle,
  popupStyle,
  popupWidth,
  ariaLabel = 'Open menu',
  onOpenChange,
}: KebabMenuProps) {
  return (
    <Menu.Root modal={false} onOpenChange={onOpenChange}>
      <Menu.Trigger
        aria-label={ariaLabel}
        className={({ open }) =>
          stylex.props(styles.trigger, triggerStyle, open && styles.triggerOpen).className ?? ''
        }
        onClick={(event) => event.stopPropagation()}
      >
        {triggerContent ?? <MoreHorizontal size={16} />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={6}
          className={stylex.props(styles.positioner).className}
        >
          <Menu.Popup
            data-kebab-popup=""
            {...stylex.props(styles.popup, popupStyle)}
            style={popupWidth ? ({ '--kebab-menu-width': popupWidth } as CSSProperties) : undefined}
          >
            <MenuItems items={items} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
