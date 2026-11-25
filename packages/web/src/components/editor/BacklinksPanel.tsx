import * as stylex from '@stylexjs/stylex';
import { ArrowLeft, ArrowRight, Link2, LockKeyhole } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useBacklinks, useOutgoingLinks } from '../../hooks/use-backlinks';
import { buildPagePath } from '../../utils/url';
import { styles } from './BacklinksPanel.stylex';

interface BacklinksPanelProps {
  pageId: string;
}

export function BacklinksPanel({ pageId }: BacklinksPanelProps) {
  const { data: backlinks } = useBacklinks(pageId);
  const { data: outgoing } = useOutgoingLinks(pageId);

  const hasBacklinks = backlinks && backlinks.length > 0;
  const hasOutgoing = outgoing && outgoing.length > 0;

  if (!hasBacklinks && !hasOutgoing) {
    return null;
  }

  return (
    <div {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.heading)}>
        <Link2 size={14} {...stylex.props(styles.headingIcon)} />
        <span {...stylex.props(styles.headingLabel)}>Links</span>
      </div>

      {hasBacklinks && (
        <div {...stylex.props(styles.section)}>
          <div {...stylex.props(styles.sectionHeading)}>
            <ArrowLeft size={12} {...stylex.props(styles.sectionIcon)} />
            <span {...stylex.props(styles.sectionLabel)}>
              {backlinks.length} linked mention{backlinks.length > 1 ? 's' : ''}
            </span>
          </div>
          <div {...stylex.props(styles.linkList)}>
            {backlinks.slice(0, 5).map((link) => (
              <Link
                key={link.id}
                to={buildPagePath(link.sourceTitle, link.sourcePageId)}
                {...stylex.props(styles.link)}
              >
                <span {...stylex.props(styles.pageIcon)}>{link.sourceIcon || '📄'}</span>
                <span {...stylex.props(styles.pageTitle)}>{link.sourceTitle}</span>
              </Link>
            ))}
            {backlinks.length > 5 && (
              <p {...stylex.props(styles.moreLinks)}>+{backlinks.length - 5} more</p>
            )}
          </div>
        </div>
      )}

      {hasOutgoing && (
        <div>
          <div {...stylex.props(styles.sectionHeading)}>
            <ArrowRight size={12} {...stylex.props(styles.sectionIcon)} />
            <span {...stylex.props(styles.sectionLabel)}>
              {outgoing.length} outgoing link{outgoing.length > 1 ? 's' : ''}
            </span>
          </div>
          <div {...stylex.props(styles.linkList)}>
            {outgoing.slice(0, 5).map((link) =>
              link.targetPageId ? (
                <Link
                  key={link.id}
                  to={buildPagePath(link.targetPageTitle || link.targetTitle, link.targetPageId)}
                  {...stylex.props(styles.link)}
                >
                  <span {...stylex.props(styles.pageIcon)}>{link.targetPageIcon || '📄'}</span>
                  <span {...stylex.props(styles.pageTitle)}>
                    {link.targetPageTitle || link.targetTitle}
                  </span>
                </Link>
              ) : (
                <div
                  key={link.id}
                  title={
                    link.targetState === 'restricted'
                      ? "You don't have access to this page."
                      : 'This link is unavailable.'
                  }
                  {...stylex.props(styles.unavailableLink)}
                >
                  {link.targetState === 'restricted' ? (
                    <LockKeyhole size={14} aria-hidden="true" />
                  ) : (
                    <span {...stylex.props(styles.pageIcon)}>{link.targetPageIcon || '📄'}</span>
                  )}
                  <span {...stylex.props(styles.pageTitle)}>
                    {link.targetPageTitle || link.targetTitle}
                  </span>
                </div>
              ),
            )}
            {outgoing.length > 5 && (
              <p {...stylex.props(styles.moreLinks)}>+{outgoing.length - 5} more</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
