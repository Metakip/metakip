import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../test-utils/render';

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ data: { user: { id: 'user-1' } } }),
}));

import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('renders the sidebar', () => {
    render(<Sidebar />);

    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });
});
