import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  root: {
    position: 'relative',
    zIndex: 40,
    display: 'flex',
    width: '100%',
    height: '100%',
    maxWidth: 240,
    flexShrink: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor:
      'light-dark(rgb(255 255 255 / 60%), color-mix(in srgb, var(--metakip-product-dark-border) 50%, transparent))',
    borderRadius: '2rem',
    backgroundColor:
      'light-dark(rgb(255 255 255 / 70%), color-mix(in srgb, var(--metakip-product-dark-surface-subtle) 70%, transparent))',
    boxShadow: '0 8px 30px light-dark(rgb(0 0 0 / 8%), rgb(0 0 0 / 30%))',
    backdropFilter: 'blur(40px)',
  },
  fill: {
    flex: 1,
  },
  content: {
    position: 'relative',
    zIndex: 0,
    display: 'flex',
    minHeight: 0,
    flex: 1,
    flexDirection: 'column',
    overflow: 'hidden',
    paddingTop: '0.75rem',
    paddingRight: '0.5rem',
    paddingLeft: '0.5rem',
  },
});
