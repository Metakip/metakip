import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import type { BetterAuthPlugin } from '@better-auth/core';
import { mcp } from '@better-auth/mcp';
import { getApiLogger } from '@metakip/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt } from 'better-auth/plugins';
import { db } from './db/connection';
import {
  accounts,
  jwks,
  oauthAccessTokens,
  oauthClientAssertions,
  oauthClientResources,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  oauthResources,
  sessions,
  users,
  verifications,
} from './db/schema';
import { betterAuthIssuer, mcpResource } from './env';
import { publicFrontendUrl } from './utils/publicWebUrl';
import { createWelcomePageForUser } from './utils/welcomePage';

type CreateAuthOptions = {
  provisionWelcomePage?: typeof createWelcomePageForUser;
};

type BetterAuthMcpPlugin = ReturnType<typeof mcp>;
type BetterAuthEndpoints = NonNullable<BetterAuthPlugin['endpoints']>;

/**
 * The MCP package exports endpoint metadata with a type that does not fully
 * align with Better Auth's plugin contract. Keep the compatibility assertion
 * limited to that property instead of hiding the complete plugin contract.
 */
function adaptMcpPlugin(plugin: BetterAuthMcpPlugin): BetterAuthPlugin {
  const { endpoints, ...pluginWithoutEndpoints } = plugin;
  return {
    ...pluginWithoutEndpoints,
    ...(endpoints === undefined ? {} : { endpoints: endpoints as BetterAuthEndpoints }),
  };
}

function createMcpPlugins(): BetterAuthPlugin[] {
  const resource = mcpResource();
  return [
    jwt({ jwt: { issuer: betterAuthIssuer(), audience: resource } }),
    adaptMcpPlugin(
      mcp({
        loginPage: '/login',
        consentPage: '/oauth/authorize',
        resource,
        resources: [{ identifier: resource, dpopBoundAccessTokensRequired: false }],
        resourceSeedMode: 'merge',
        // MCP's proxy transport forwards bearer tokens only. An empty
        // algorithm allowlist makes DPoP proof validation fail closed and
        // prevents new DPoP-bound tokens from being issued for this resource.
        dpop: { signingAlgorithms: [] },
        scopes: ['openid', 'profile', 'offline_access', 'pages:read', 'pages:write'],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
    ),
    cimd({
      fetchClientMetadataResource,
      metadataProfile: 'mcp-2026-07-28',
    }),
  ];
}

export function createAuth(options: CreateAuthOptions = {}) {
  const provisionWelcomePage = options.provisionWelcomePage ?? createWelcomePageForUser;

  return betterAuth({
    baseURL: publicFrontendUrl,
    trustedOrigins: [publicFrontendUrl],
    plugins: createMcpPlugins(),
    database: drizzleAdapter(db, {
      provider: 'pg',
      transaction: true,
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        jwks,
        oauthClient: oauthClients,
        oauthResource: oauthResources,
        oauthClientResource: oauthClientResources,
        oauthRefreshToken: oauthRefreshTokens,
        oauthAccessToken: oauthAccessTokens,
        oauthConsent: oauthConsents,
        oauthClientAssertion: oauthClientAssertions,
      },
    }),
    advanced: {
      database: {
        generateId: false,
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            try {
              await db.transaction(async (transaction) => {
                await provisionWelcomePage(transaction, user.id);
              });
            } catch (error) {
              // The welcome page is optional. Better Auth runs create.after
              // hooks after its transaction commits, so report provisioning
              // failures without turning a successful signup into an error.
              getApiLogger().error('Welcome page provisioning failed after signup', {
                userId: user.id,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          },
        },
      },
    },
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID as string,
        clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
      },
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      },
    },
  });
}

export const auth = createAuth();
