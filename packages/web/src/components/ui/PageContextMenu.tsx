import type { StyleXStyles } from '@stylexjs/stylex';
import { useShareContext } from '../../contexts/ShareContext';
import { type EntityActionOptions, useEntityActions } from '../../hooks/useEntityActions';
import { KebabMenu } from './KebabMenu';

type PageContextMenuProps = EntityActionOptions & {
  triggerStyle?: StyleXStyles;
  popupStyle?: StyleXStyles;
  onOpenChange?: ((isOpen: boolean) => void) | undefined;
};

export function PageContextMenu({
  triggerStyle,
  popupStyle,
  onOpenChange,
  ...options
}: PageContextMenuProps) {
  const { isAnonymous } = useShareContext();
  const actions = useEntityActions(options);
  const items = [
    !isAnonymous && actions.star,
    actions.rename,
    !isAnonymous && actions.share,
    ...actions.items,
  ].filter((item) => !!item);

  return (
    <>
      <KebabMenu
        {...(triggerStyle != null ? { triggerStyle } : {})}
        {...(popupStyle != null ? { popupStyle } : {})}
        {...(onOpenChange != null ? { onOpenChange } : {})}
        items={items}
      />
      {actions.dialogs}
    </>
  );
}
