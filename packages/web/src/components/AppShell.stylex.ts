import * as stylex from '@stylexjs/stylex';
import { colors } from '../theme.stylex';

const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

export const styles = stylex.create({
  root: {
    display: 'grid',
    width: '100%',
    height: '100vh',
    gridTemplateRows: 'auto minmax(0, 1fr)',
    overflow: 'hidden',
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: 'var(--font-sans)',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      '@media (min-width: 48rem)': 'var(--sidebar-column-width) minmax(0, 1fr)',
    },
    transitionProperty: {
      default: null,
      '@media (min-width: 48rem)': '--sidebar-column-width',
    },
    transitionDuration: {
      default: null,
      '@media (min-width: 48rem)': '200ms',
    },
    transitionTimingFunction: {
      default: null,
      '@media (min-width: 48rem)': 'ease',
    },
  },
  toolbarSlot: {
    display: 'none',
    gridColumn: '1',
    gridRow: '1',
    minHeight: 'var(--app-toolbar-height)',
    alignItems: 'center',
    backgroundColor: `color-mix(in srgb, ${colors.surface} 95%, transparent)`,
    backdropFilter: 'blur(24px)',
  },
  toolbarSlotVisible: {
    position: 'relative',
    zIndex: 60,
    display: {
      default: 'grid',
      '@media (min-width: 48rem)': 'block',
    },
    gridColumn: {
      default: '1',
      '@media (min-width: 48rem)': '1 / -1',
    },
    gridTemplateColumns: 'minmax(36px, auto) minmax(0, 1fr)',
  },
  toolbarSlotWithoutSidebar: {
    gridTemplateColumns: 'minmax(0, 1fr)',
  },
  toolbarContentSlot: {
    display: 'none',
    gridColumn: '2',
    width: '100%',
    minWidth: 0,
  },
  toolbarContentSlotVisible: {
    display: {
      default: 'flex',
      '@media (min-width: 48rem)': 'block',
    },
    gridColumn: {
      default: '2',
      '@media (min-width: 48rem)': '1 / -1',
    },
  },
  toolbarContentSlotWithoutSidebar: {
    gridColumn: '1',
  },
  toolbarContent: {
    paddingRight: '1rem',
    backgroundColor: colors.surface,
    width: '100%',
    minWidth: 0,
    paddingBlock: {
      default: '0.5rem',
      '@media (min-width: 48rem)': '0.75rem',
    },
    paddingLeft: {
      default: '0px',
      '@media (min-width: 48rem)': '52px',
    },
  },
  toolbarPortal: {
    width: '100%',
    minWidth: 0,
  },
  toolbarToggle: {
    display: 'flex',
    gridColumn: '1',
    alignItems: 'center',
    justifyContent: 'flex-start',
    position: {
      default: null,
      '@media (min-width: 48rem)': 'absolute',
    },
    zIndex: {
      default: null,
      '@media (min-width: 48rem)': 60,
    },
    top: {
      default: null,
      '@media (min-width: 48rem)': '0.875rem',
    },
    left: {
      default: null,
      '@media (min-width: 48rem)': '1rem',
    },
  },
  sidebarToggle: {
    display: 'flex',
    width: '2rem',
    height: '2rem',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: '0.375rem',
    padding: '0.5rem',
    color: 'var(--metakip-neutral-zinc-400)',
    transitionProperty: 'background-color, color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    ':hover': {
      backgroundColor: colors.selection,
      color: 'light-dark(var(--metakip-neutral-zinc-600), var(--metakip-neutral-zinc-200))',
    },
  },
  sidebarToggleOpen: {
    backgroundColor: colors.selection,
    color: colors.controlText,
  },
  mobileOverlay: {
    position: 'fixed',
    inset: 'var(--app-toolbar-height) 0 0',
    zIndex: 50,
    borderWidth: 0,
    padding: 0,
    backgroundColor: 'color-mix(in srgb, var(--metakip-product-dark-surface) 50%, transparent)',
    backdropFilter: 'blur(4px)',
    animationName: fadeIn,
    animationDuration: '150ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
    cursor: 'pointer',
  },
  sidebar: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.75rem',
    transitionProperty: 'transform, opacity',
    transitionDuration: '200ms',
    transitionTimingFunction: 'ease-in-out',
    position: {
      default: 'fixed',
      '@media (min-width: 48rem)': 'static',
    },
    zIndex: {
      default: 51,
      '@media (min-width: 48rem)': 40,
    },
    top: {
      default: 'var(--app-toolbar-height)',
      '@media (min-width: 48rem)': null,
    },
    bottom: {
      default: 0,
      '@media (min-width: 48rem)': null,
    },
    left: {
      default: 0,
      '@media (min-width: 48rem)': null,
    },
    gridColumn: {
      default: null,
      '@media (min-width: 48rem)': '1',
    },
    gridRow: {
      default: null,
      '@media (min-width: 48rem)': '2',
    },
    width: {
      default: '80vw',
      '@media (min-width: 48rem)': 'var(--sidebar-width)',
    },
    maxWidth: {
      default: 'var(--sidebar-width)',
      '@media (min-width: 48rem)': 'none',
    },
    height: {
      default: null,
      '@media (min-width: 48rem)': '100%',
    },
    overflow: {
      default: null,
      '@media (min-width: 48rem)': 'hidden',
    },
    padding: {
      default: '0.75rem',
      '@media (min-width: 48rem)': '0.75rem 0 0.75rem 1rem',
    },
  },
  sidebarOpen: {
    transform: 'translateX(0)',
    opacity: 1,
    pointerEvents: 'auto',
  },
  sidebarClosed: {
    transform: 'translateX(-100%)',
    opacity: 0,
    pointerEvents: 'none',
  },
  profile: {
    flexShrink: 0,
  },
  main: {
    position: 'relative',
    gridRow: '2',
    display: 'flex',
    height: '100%',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    gridColumn: {
      default: '1',
      '@media (min-width: 48rem)': '2',
    },
  },
  scrollContent: {
    minWidth: 0,
    flex: 1,
    overflowX: 'hidden',
    overflowY: 'auto',
    paddingBottom: '2rem',
    scrollBehavior: 'smooth',
  },
  content: {
    width: '100%',
    minWidth: 0,
    marginInline: 'auto',
  },
  contentConstrained: {
    maxWidth: '56rem',
    paddingTop: {
      default: '1.5rem',
      '@media (min-width: 48rem)': '3rem',
    },
    paddingRight: {
      default: '1.5rem',
      '@media (min-width: 48rem)': '3rem',
    },
    paddingBottom: {
      default: '1.5rem',
      '@media (min-width: 48rem)': '3rem',
    },
    paddingLeft: {
      default: '1.5rem',
      '@media (min-width: 48rem)': '3rem',
    },
  },
  contentFullWidth: {
    maxWidth: 'none',
    paddingTop: {
      default: '1.5rem',
      '@media (min-width: 48rem)': 0,
    },
    paddingLeft: 0,
    paddingRight: 0,
    paddingBottom: {
      default: '1.5rem',
      '@media (min-width: 48rem)': '3rem',
    },
  },
  contentLoading: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: {
      default: 'calc(100dvh - 3.5rem)',
      '@media (min-width: 48rem)': '100dvh',
    },
  },
  contentLoadingAnonymous: {
    minHeight: '100dvh',
  },
  contentReady: {
    minHeight: '100%',
  },
  loadingContent: {
    display: 'flex',
    minHeight: 0,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
