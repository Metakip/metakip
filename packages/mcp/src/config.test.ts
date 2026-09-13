import { describe, expect, it } from 'vitest';
import { getMcpRuntimeConfig } from './config';

const internalSecret = 'test-mcp-api-internal-secret-0123456789';

describe('getMcpRuntimeConfig', () => {
  it('uses the dedicated MCP port even when API PORT is set', () => {
    expect(
      getMcpRuntimeConfig({
        NODE_ENV: 'development',
        PORT: '3001',
        MCP_API_INTERNAL_SECRET: internalSecret,
      }),
    ).toMatchObject({
      apiUrl: 'http://127.0.0.1:3001',
      port: 3002,
    });
  });

  it('returns the normalized public origin for route construction', () => {
    const config = getMcpRuntimeConfig({
      MCP_PUBLIC_URL: 'https://mcp.example.test/',
      MCP_API_INTERNAL_SECRET: internalSecret,
    });
    expect(config.publicUrl).toEqual(new URL('https://mcp.example.test/'));
  });

  it('rejects a remote plaintext API URL', () => {
    expect(() =>
      getMcpRuntimeConfig({
        MCP_API_URL: 'http://api.example.test:3001',
        MCP_API_INTERNAL_SECRET: internalSecret,
      }),
    ).toThrow('MCP_API_URL must use HTTPS');
  });

  it('requires a public HTTPS URL in production', () => {
    expect(() => getMcpRuntimeConfig({ NODE_ENV: 'production' })).toThrow(
      'MCP_PUBLIC_URL is required in production',
    );
    expect(() =>
      getMcpRuntimeConfig({ NODE_ENV: 'production', MCP_PUBLIC_URL: 'http://localhost:3002' }),
    ).toThrow('MCP_PUBLIC_URL must be a public HTTPS URL in production');
  });

  it('rejects invalid MCP ports', () => {
    expect(() =>
      getMcpRuntimeConfig({ MCP_PORT: '3001.5', MCP_API_INTERNAL_SECRET: internalSecret }),
    ).toThrow('MCP_PORT must be an integer between 1 and 65535');
  });

  it('requires the private MCP-to-API secret', () => {
    expect(() => getMcpRuntimeConfig({ NODE_ENV: 'development' })).toThrow(
      'MCP_API_INTERNAL_SECRET is required',
    );
  });

  it('rejects the development secret in production', () => {
    expect(() =>
      getMcpRuntimeConfig({
        NODE_ENV: 'production',
        MCP_PUBLIC_URL: 'https://mcp.metakip.com',
        MCP_API_INTERNAL_SECRET: 'development-only-mcp-api-secret-0123456789abcdef',
      }),
    ).toThrow('MCP_API_INTERNAL_SECRET must not use the development value in production');
  });
});
