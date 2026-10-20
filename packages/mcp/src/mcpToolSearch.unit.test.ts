import type { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import { registerSearchTool } from './mcpToolSearch';
import type { McpSearchBackend } from './types';

describe('search MCP tool registration', () => {
  it('registers search independently from page tools', () => {
    const registerTool = vi.fn();
    const server = { registerTool } as unknown as McpServer;
    const backend = { search: vi.fn() } as unknown as McpSearchBackend;

    registerSearchTool(server, backend);

    expect(registerTool).toHaveBeenCalledOnce();
    expect(registerTool.mock.calls[0]?.[0]).toBe('search');
  });
});
