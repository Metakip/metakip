import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';

const inlineCodeStylesPlugin = {
  name: 'metakip-inline-code-styles',
  hooks: {
    'config:setup': ({ command, config, updateConfig }) => {
      if (command !== 'build') return;
      // Apply after starlight-openapi so its config update does not restore external styles.
      const expressiveCode = typeof config.expressiveCode === 'object' ? config.expressiveCode : {};
      updateConfig({ expressiveCode: { ...expressiveCode, emitExternalStylesheet: false } });
    },
  },
};

export default defineConfig({
  site: 'https://docs.metakip.com',
  redirects: {
    '/api-reference/': '/api-reference/endpoints/',
    '/agents/markdawn-cli/': '/agents/metakip-cli/',
    '/agents/use-markdawn-with-ai-assistants/': '/agents/use-metakip-with-ai-assistants/',
    '/self-hosting/deploy-markdawn-on-a-vps/': '/self-hosting/deploy-metakip-on-a-vps/',
    '/self-hosting/maintain-a-self-hosted-markdawn/':
      '/self-hosting/maintain-a-self-hosted-metakip/',
    '/self-hosting/move-a-markdawn-deployment/': '/self-hosting/move-a-metakip-deployment/',
    '/comparisons/markdawn-vs-apple-notes/': '/comparisons/metakip-vs-apple-notes/',
    '/comparisons/markdawn-vs-coda/': '/comparisons/metakip-vs-coda/',
    '/comparisons/markdawn-vs-confluence/': '/comparisons/metakip-vs-confluence/',
    '/comparisons/markdawn-vs-craft/': '/comparisons/metakip-vs-craft/',
    '/comparisons/markdawn-vs-evernote/': '/comparisons/metakip-vs-evernote/',
    '/comparisons/markdawn-vs-gitbook/': '/comparisons/metakip-vs-gitbook/',
    '/comparisons/markdawn-vs-google-docs/': '/comparisons/metakip-vs-google-docs/',
    '/comparisons/markdawn-vs-notion/': '/comparisons/metakip-vs-notion/',
    '/comparisons/markdawn-vs-obsidian/': '/comparisons/metakip-vs-obsidian/',
    '/comparisons/markdawn-vs-onenote/': '/comparisons/metakip-vs-onenote/',
    '/comparisons/markdawn-vs-outline/': '/comparisons/metakip-vs-outline/',
    '/comparisons/markdawn-vs-slite/': '/comparisons/metakip-vs-slite/',
  },
  integrations: [
    starlight({
      title: 'Metakip Docs',
      description: 'Learn Metakip, build with the API, and bring your own agents.',
      favicon: 'https://metakip.com/icon-192.png',
      editLink: {
        baseUrl: 'https://github.com/Metakip/metakip/edit/master/docs/',
      },
      lastUpdated: true,
      social: [
        {
          icon: 'github',
          label: 'Metakip on GitHub',
          href: 'https://github.com/Metakip/metakip',
        },
      ],
      customCss: ['./src/styles/custom.css'],
      plugins: [
        starlightOpenAPI([
          {
            base: 'api-reference/endpoints',
            schema: './openapi.json',
            sidebar: {
              label: 'Endpoints',
              collapsed: false,
              operations: { badges: true, labels: 'summary', sort: 'document' },
              tags: { sort: 'document' },
            },
            snippets: {
              operation: {
                clients: { javascript: ['fetch'], shell: ['curl'] },
                default: { target: 'shell', client: 'curl' },
              },
            },
          },
        ]),
        inlineCodeStylesPlugin,
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Getting Started', link: '/getting-started/' },
            { label: 'Create Your First Page', link: '/getting-started/create-your-first-page/' },
            { label: 'Markdown Support', link: '/getting-started/markdown-support/' },
            { label: 'Bring Your Notes to Metakip', link: '/getting-started/bring-your-notes/' },
            {
              label: 'Organize Pages and Folders',
              link: '/getting-started/organize-pages-and-folders/',
            },
            { label: 'Share a Page', link: '/getting-started/share-a-page/' },
          ],
        },
        {
          label: 'Agents',
          items: [
            { label: 'Agents', link: '/agents/' },
            { label: 'MCP', link: '/agents/mcp/' },
            { label: 'Metakip CLI', link: '/agents/metakip-cli/' },
            {
              label: 'Use Metakip With AI Assistants',
              link: '/agents/use-metakip-with-ai-assistants/',
            },
          ],
        },
        {
          label: 'API Reference',
          items: [...openAPISidebarGroups],
        },
        {
          label: 'Self-Hosting',
          items: [
            { label: 'Self-Hosting', link: '/self-hosting/' },
            { label: 'Deploy Metakip on a VPS', link: '/self-hosting/deploy-metakip-on-a-vps/' },
            {
              label: 'Maintain a Self-Hosted Metakip',
              link: '/self-hosting/maintain-a-self-hosted-metakip/',
            },
            {
              label: 'Move a Metakip Deployment',
              link: '/self-hosting/move-a-metakip-deployment/',
            },
          ],
        },
        {
          label: 'Comparisons',
          items: [
            { label: 'Apple Notes', link: '/comparisons/metakip-vs-apple-notes/' },
            { label: 'Coda / Superhuman Docs', link: '/comparisons/metakip-vs-coda/' },
            { label: 'Confluence', link: '/comparisons/metakip-vs-confluence/' },
            { label: 'Craft', link: '/comparisons/metakip-vs-craft/' },
            { label: 'Evernote', link: '/comparisons/metakip-vs-evernote/' },
            { label: 'GitBook', link: '/comparisons/metakip-vs-gitbook/' },
            { label: 'Google Docs', link: '/comparisons/metakip-vs-google-docs/' },
            { label: 'Notion', link: '/comparisons/metakip-vs-notion/' },
            { label: 'Obsidian', link: '/comparisons/metakip-vs-obsidian/' },
            { label: 'OneNote', link: '/comparisons/metakip-vs-onenote/' },
            { label: 'Outline', link: '/comparisons/metakip-vs-outline/' },
            { label: 'Slite', link: '/comparisons/metakip-vs-slite/' },
          ],
        },
      ],
      components: {
        Head: './src/components/Head.astro',
        Header: './src/components/Header.astro',
        Sidebar: './src/components/Sidebar.astro',
        PageSidebar: './src/components/PageSidebar.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeToggle.astro',
        MobileMenuFooter: './src/components/MobileMenuFooter.astro',
      },
    }),
  ],
});
