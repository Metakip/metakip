import { useShareContext } from '../../contexts/ShareContext';
import { type EntityActionOptions, useEntityActions } from '../../hooks/useEntityActions';
import { KebabMenu } from './KebabMenu';

type PageContextMenuProps = EntityActionOptions & {
  triggerClassName?: string;
  menuClassName?: string;
  onOpenChange?: ((isOpen: boolean) => void) | undefined;
};

export function PageContextMenu({
  triggerClassName,
  menuClassName,
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
        {...(triggerClassName != null ? { triggerClassName } : {})}
        {...(menuClassName != null ? { menuClassName } : {})}
        {...(onOpenChange != null ? { onOpenChange } : {})}
        items={items}
      />
      {actions.dialogs}
    </>
  );
}
