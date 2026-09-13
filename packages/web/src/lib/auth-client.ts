import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import type { BetterAuthClientOptions } from 'better-auth/client';
import { createAuthClient, type ReactAuthClient } from 'better-auth/react';

type MetakipAuthClientOptions = BetterAuthClientOptions & {
  plugins: [ReturnType<typeof oauthProviderClient>];
};

export const authClient: ReactAuthClient<MetakipAuthClientOptions> = createAuthClient({
  baseURL: `${window.location.origin}/api/auth`,
  plugins: [oauthProviderClient()],
});
