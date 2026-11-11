import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KebabMenu } from './KebabMenu';

describe('KebabMenu', () => {
  it('uses Base UI menu semantics and invokes an action once without navigating the row', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onRowClick = vi.fn();
    const onOpenChange = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: simulates a surrounding clickable row
      // biome-ignore lint/a11y/useKeyWithClickEvents: only pointer propagation is under test
      <div onClick={onRowClick}>
        <KebabMenu
          items={[{ label: 'Export', onClick: onAction }]}
          ariaLabel="Page actions"
          onOpenChange={onOpenChange}
        />
      </div>,
    );

    const trigger = screen.getByRole('button', { name: 'Page actions' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(trigger);
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('menuitem', { name: 'Export' }));

    expect(onAction).toHaveBeenCalledOnce();
    expect(onRowClick).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(onOpenChange).toHaveBeenCalledWith(true, expect.anything());
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it('supports keyboard navigation, disabled actions, Escape, and focus restoration', async () => {
    const user = userEvent.setup();
    const disabledAction = vi.fn();
    render(
      <KebabMenu
        items={[
          { label: 'Full width', onClick: vi.fn() },
          { label: 'Move', onClick: disabledAction, disabled: true },
          { label: 'Export', onClick: vi.fn() },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    const firstItem = await screen.findByRole('menuitem', { name: 'Full width' });
    await waitFor(() => expect(firstItem).toHaveFocus());
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Export' })).toHaveFocus();
    await user.click(screen.getByRole('menuitem', { name: 'Move' }));
    expect(disabledAction).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('dismisses on outside interaction without firing an action', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <>
        <button type="button">Outside</button>
        <KebabMenu items={[{ label: 'Copy', onClick: onAction }]} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await screen.findByRole('menu');
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(onAction).not.toHaveBeenCalled();
  });
});
