import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '../test-utils/render';
import { usePwaLaunchAction } from './usePwaLaunchAction';

const createPageAndNavigate = vi.fn();
const searchRequests: boolean[] = [];

vi.mock('./useEntityCreationActions', () => ({
  useEntityCreationActions: () => ({ createPageAndNavigate }),
}));

function LaunchActionHarness() {
  const openSearch = usePwaLaunchAction();
  searchRequests.push(openSearch);
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

describe('usePwaLaunchAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchRequests.length = 0;
    createPageAndNavigate.mockResolvedValue(undefined);
  });

  it('requests search and preserves other query parameters', async () => {
    render(<LaunchActionHarness />, { route: '/?action=search&filter=owned-by-me' });

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toHaveTextContent('?filter=owned-by-me');
    });
    expect(searchRequests).toContain(true);
    expect(createPageAndNavigate).not.toHaveBeenCalled();
  });

  it('does not interpret action parameters on other workspace routes', () => {
    render(<LaunchActionHarness />, { route: '/settings?action=new-page' });

    expect(createPageAndNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('location-search')).toHaveTextContent('?action=new-page');
  });
});
