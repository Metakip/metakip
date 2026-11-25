import * as stylex from '@stylexjs/stylex';
import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useIsReadOnly } from '../../contexts/EditorReadOnlyContext';
import { useShareContext } from '../../contexts/ShareContext';
import { useUpdatePage } from '../../hooks/use-pages';
import { EmojiPicker } from '../EmojiPicker';
import { styles } from './PageIcon.stylex';

interface PageIconProps {
  pageId: string;
  initialIcon: string | null;
}

export function PageIcon({ pageId, initialIcon }: PageIconProps) {
  const readOnly = useIsReadOnly();
  const { isAnonymous } = useShareContext();
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const updatePageMutation = useUpdatePage();

  useEffect(() => {
    setIcon(initialIcon);
  }, [initialIcon]);

  const handleIconChange = async (newIcon: string | null) => {
    if (readOnly) return;
    setIcon(newIcon);
    try {
      await updatePageMutation.mutateAsync({
        pageId,
        updates: { icon: newIcon },
      });
    } catch {
      // Error toast handled globally by MutationCache.onError
      setIcon(initialIcon);
    }
  };

  const content = (
    <div {...stylex.props(styles.root)}>
      {icon ? icon : <FileText {...stylex.props(styles.fallbackIcon)} />}
    </div>
  );

  if (readOnly || isAnonymous) {
    return content;
  }

  return (
    <EmojiPicker icon={icon} onChange={handleIconChange}>
      {content}
    </EmojiPicker>
  );
}
