---
title: Metakip vs Outline
description: Compare Metakip and Outline for team wikis, collaboration, permissions, self-hosting, APIs, MCP, AI assistants, and Markdown portability.
---

Outline is a focused team wiki and documentation product with collections, nested documents, real-time editing, comments, public sharing, APIs, and a built-in MCP server. Metakip overlaps with Outline in collaborative knowledge work, but puts more emphasis on a smaller markdown-centered content model, imports, self-hosting, and client-neutral CLI and API access.

Choose Outline for a polished internal wiki with mature review, search, collection permissions, and built-in AI integrations. Choose Metakip when pages also need to hold personal notes, research, project context, and API-accessible content without adopting a larger wiki workflow.

## At A Glance

| Decision Area | Metakip | Outline |
| --- | --- | --- |
| Main job | Shared project knowledge and documentation | Team wiki and documentation |
| Content model | Markdown pages, folders, links, and backlinks | Collections, nested documents, comments, and rich editor content |
| Collaboration | View, Edit, and Admin access with real-time coediting | Real-time collaborative editing, comments, and document history |
| Permissions | Page and folder access roles | Admin, Editor, Viewer, Guest, collection permissions, and document sharing |
| Public access | Shared pages and deployed documentation | Public documents and collections with child documents |
| Portability | Markdown files, folders, and Obsidian vault imports | Markdown, HTML, PDF, JSON, Notion, Confluence, Word, and Outline exports/imports |
| Automation | CLI, API, AI assistant workflows, and MCP | Scoped API keys, webhooks, integrations, and built-in MCP |
| CLI | Metakip CLI | No dedicated official Outline CLI documented |
| AI | Controlled AI assistant access through CLI, API, and MCP | AI answers in cloud/licensed editions and MCP for connected AI assistants |
| Hosting | Hosted or self-hosted | Outline Cloud or self-hosted/on-premises editions |
| Offline work | Depends on deployment and browser requirements | Desktop apps and browser access; not a local-first file vault |
| Pricing | Check the current Metakip plan | Cloud tiers listed at $10, $79, and $249 per month, with annual pricing available |

## Where Outline Is Better

### A Mature Team Wiki Workflow

Outline is built around collections, nested documents, search, comments, document history, and a navigation model designed for team knowledge bases. It is a strong fit for internal documentation, policies, onboarding, support knowledge, engineering references, and company wikis.

Metakip is intentionally smaller. It is better when the same pages need to hold project context, personal notes, research, and working knowledge before becoming formal documentation. Outline is better when the wiki workflow itself is the product.

### Real-Time Collaborative Editing And Review

Outline fully supports real-time collaborative editing. Its documentation says that up to 100 team members can edit the same document at once, with changes synchronized automatically and realtime cursors showing where other people are working.

Outline also supports comments on documents and selected text, document history, and review-oriented workflows. Metakip supports real-time coediting, collaborator presence, and connection status, but does not currently provide the same comment and wiki review surface.

### Collection And Document Permissions

Outline has a more granular permission model than Metakip. Its roles include Admin, Editor, Viewer, and Guest, with collection permissions and additional sharing on individual documents and their child documents. A private collection can remain restricted while a document subtree is shared with selected people or groups.

Metakip uses a simpler model of View, Edit, and Admin access for shared pages and folders. Choose Outline when collection-level governance, groups, guests, comments, and document-specific sharing are requirements. Choose Metakip when a smaller access model is easier to explain and maintain.

### Search And AI Answers

Outline provides full-text search with operators and AI answers based on workspace content. AI answers are restricted to the current user's permissions and include references to source documents. The feature is available in cloud-hosted and licensed editions and can be enabled by a workspace admin.

Metakip provides page links, folders, backlinks, API access, and documented AI assistant workflows. Choose Outline when in-product search answers and cited workspace context are important. Choose Metakip when assistants should work with a simpler page model through the CLI or API.

### Built-In MCP

Every current Outline workspace includes a built-in MCP server. Compatible AI assistants can search, read, create, and edit Outline documents, and the current MCP changelog also lists comment workflows. MCP can use OAuth or a scoped API key, can be disabled at the workspace level, and uses the workspace domain with `/mcp` for self-hosted installations.

Metakip also provides MCP support for connecting AI assistants to its page and folder model. Outline remains stronger when an assistant needs its broader document, collection, comment, and review workflows.

### Public Documentation And Publishing

Outline can publish individual documents and collections to the public internet, with child documents included in the published tree. This gives a team wiki a path to public documentation without a separate publishing product.

Metakip can deploy documentation and share pages, but its current product model is focused on shared pages and a self-hosted or hosted content layer rather than Outline's collection publishing workflow.

## Where Metakip Is Better

### A Smaller Markdown-Centered Content Layer

Metakip is built around pages, folders, links, backlinks, and markdown. The same authored content can be read through the browser, CLI, and API without requiring a wiki collection, rich editor configuration, or Outline-specific document structure.

Outline supports Markdown import and export, but its primary editor stores documents in its own rich content model. Choose Metakip when Markdown should remain the durable source format rather than one of several export formats.

### Working Knowledge Before Publication

Metakip is better when a research note, meeting note, product decision, incident record, or personal project page should live beside shared documentation in the same page and folder system.

Outline can contain drafts and private collections, but its strongest workflow is a governed team wiki. Choose Metakip when the boundary between personal notes, working knowledge, and shared documentation should be lighter.

### Direct Tool Access Without A Wiki-Specific API Model

Metakip provides a documented CLI and API for reading, editing, importing, exporting, and organizing pages and folders. The API is designed around the same content model people use in the browser.

Outline also has a fully featured RPC-style API with scoped API keys, expiration dates, and webhooks. It is the stronger choice for deep Outline integrations. Metakip is better when a simple page and folder API is enough and the integration should not depend on collections, document history, and wiki-specific objects.

### Self-Hosting And Deployment Control

Both products have self-hosting paths. Metakip's documentation provides a deployment and maintenance workflow for teams that want to run the application themselves. Outline provides self-hosted and on-premises editions, but the available roles and licensed features differ from Outline Cloud.

For example, Outline's documentation notes that the Guest role is not available in the self-hosted community edition, and AI answers are available only in cloud-hosted and licensed editions. Compare the exact edition, support, identity, storage, backup, and feature requirements before treating the products as equivalent self-hosted options.

## APIs, Automation, CLI, And MCP

### Outline's Current Integration Surface

Outline's official developer surface includes:

- A fully featured RPC-style API covering workspace data and actions.
- API keys that can be scoped to endpoints and restricted by expiration date.
- Webhooks for document, comment, user, and other workspace events.
- Authentication through providers such as Google, Microsoft, and Slack, with SSO options depending on edition and configuration.
- A built-in MCP server for connected AI assistants.

Outline does not document a separate official `outline` CLI. Developers can call the API with `curl`, SDKs, scripts, or automation platforms, and AI clients can connect through MCP. The official MCP setup itself can be configured from tools such as Claude Code, but that is not an Outline-specific CLI.

Metakip provides its own CLI, API, and MCP support today. Choose Outline when API, webhooks, and a broader wiki-oriented MCP surface are the primary automation requirements. Choose Metakip when the CLI and a smaller page-oriented MCP workflow are a better fit.

### Webhooks And Event-Driven Workflows

Outline webhooks send signed HTTP POST requests when selected workspace events occur. They can trigger workflows when documents are published, comments are created, users join, and other supported events happen. Failed deliveries are retried and can be disabled after repeated failures.

Metakip provides documented CLI and API workflows, but it should not be presented as having Outline's webhook system unless that feature ships separately. Use Metakip's API or a surrounding automation layer when an event-driven integration is required.

## Collaboration, Roles, And Sharing

Outline supports workspace roles, collection permissions, groups, and individual document sharing. Its current roles are:

- **Admin** manages the workspace, billing, integrations, users, and permissions.
- **Editor** can view, create, edit, and comment on documents available to them.
- **Viewer** can view and comment on shared documents without general editing access.
- **Guest** has access only to explicitly shared documents and is not available in the self-hosted community edition.

Collection permissions can grant View, View and Edit, Admin, or Workspace Admin access. Individual documents and child documents can also be shared with users or groups.

Metakip provides View, Edit, and Admin access for shared pages and folders, with real-time coediting and collaborator presence. It is easier to explain, but it does not currently match Outline's roles, groups, comments, or collection governance.

## Portability And Migration

Outline has unusually useful migration and export options for a hosted wiki:

- Individual documents can export as HTML, Markdown, or PDF.
- Collections can export as Markdown, HTML, or JSON.
- Workspace admins can export all collections, including private collections.
- JSON is recommended for moving content between Outline instances.
- Outline can import Notion and Confluence exports, Word documents, Markdown, JSON, HTML, and text files.
- Outline's API can support custom imports when an export format needs additional processing.

Outline warns that import fidelity cannot be guaranteed. JSON transfers between Outline instances preserve content and attachments, but workspace settings such as collection permissions, users, and groups are not imported automatically. Authorship may also be lost during a JSON import.

Before migrating to Metakip, inventory:

- Collections, nested documents, links, comments, drafts, and document history.
- Markdown, HTML, embeds, tables, images, attachments, and published trees.
- Workspace roles, groups, collection permissions, document shares, and public links.
- API keys, webhooks, MCP settings, integrations, and authentication providers.
- AI answers, source references, and any workflows that depend on Outline-specific objects.

Export a representative collection as Markdown or JSON, convert it to Metakip pages, preserve attachments, and verify titles, headings, lists, tables, images, links, and folder structure before planning a full migration. Metakip does not currently describe Outline as a first-class native import.

Moving from Metakip to Outline requires the opposite conversion. Export Markdown and attachments, recreate collections and nested documents, and separately configure roles, groups, sharing, webhooks, API keys, MCP, and public publishing.

## Offline Work And Hosting

Outline provides browser access and desktop applications for macOS and Windows. Its desktop app is a client for an Outline workspace, not a local-first folder of Markdown files. The primary content remains in the hosted or self-hosted Outline service, so do not assume that the desktop app provides Obsidian-style offline file ownership.

Metakip is also a browser-oriented service with a self-hosting option. Verify the deployment, browser, and connection requirements for the workflow you need. Metakip and Outline are both different from a local-first Markdown vault.

## Integrations And Ecosystem

Outline integrates with authentication providers and services around team documentation. The official documentation covers Google, Microsoft, and Slack authentication, GitHub link previews, Slack search integration, webhooks, APIs, and MCP. The exact integrations vary between Cloud, licensed, and community self-hosted editions.

Metakip is intentionally more client-neutral. It provides a page and folder model through the browser, CLI, and API, and it has documentation for AI assistant workflows. Choose Outline when you want an established wiki with a broad integration surface. Choose Metakip when the content layer should remain smaller and easier to move between tools.

## Pricing And Account Ownership

Outline's current pricing page lists these Cloud tiers, with annual pricing available:

- **Starter:** $10 per month for 1 to 10 team members.
- **Team:** $79 per month for 11 to 100 team members.
- **Business:** $249 per month for 101 to 200 team members.

Outline offers a 30-day trial. After the trial, the knowledge base becomes read-only until a payment method is added, and the workspace can be exported during that period. Larger teams and nonprofit or education discounts require checking current terms with Outline.

Outline also lists on-premises or self-hosted deployment. Verify whether the feature, role, support, and licensing requirements you need are included in the community edition or require a licensed deployment.

Metakip pricing and deployment costs should be evaluated separately from Outline Cloud pricing. A self-hosted Metakip deployment trades subscription simplicity for infrastructure responsibility.

## Who Should Choose Outline?

Outline is a strong choice if you:

- Need a polished team wiki with collections and nested documents.
- Need real-time coediting, comments, document history, and search.
- Need collection, group, document, guest, viewer, and editor permissions.
- Want to publish documents or collections to the public web.
- Need the Outline API, scoped API keys, webhooks, or built-in MCP.
- Want AI answers grounded in permission-filtered workspace content.
- Need Notion, Confluence, Word, Markdown, HTML, or JSON import options.
- Prefer a managed Cloud service or are prepared to operate a self-hosted edition.

## Who Should Choose Metakip?

Metakip is a strong choice if you:

- Need shared Markdown pages that people can edit in a browser in real time.
- Need View, Edit, and Admin access for shared pages and folders.
- Want pages, folders, links, and backlinks instead of a collection-first wiki.
- Need personal notes, research, project context, and documentation in one lighter system.
- Need a first-class CLI and a documented API for the content model.
- Want to import Markdown folders or an Obsidian vault.
- Need the option to self-host the application.

## Questions To Answer Before Switching

### Is Metakip An Outline Alternative?

Only for some workflows. Metakip can replace Outline as a home for shared documentation and working knowledge. It is not a feature-for-feature replacement for Outline's comments, collection permissions, groups, guest role, public collection publishing, AI answers, webhooks, or built-in MCP.

### Does Outline Support Real-Time Collaboration?

Yes. Outline supports real-time collaborative editing, realtime cursors, comments, and document history. Metakip also supports real-time coediting, but uses a smaller Markdown page model and View, Edit, and Admin access model.

### Does Outline Have An API?

Yes. Outline provides a fully featured RPC-style API with API keys, endpoint scopes, expiration dates, and access to workspace data. It also provides webhooks for event-driven integrations.

### Does Outline Have A CLI?

Outline does not document a separate official `outline` CLI. Use the API, webhooks, scripts, automation platforms, or the built-in MCP server for programmatic workflows.

### Does Outline Have MCP?

Yes. Each current Outline workspace includes a built-in MCP server. It supports AI assistants that can search, read, create, and edit documents, with OAuth or API-key authentication. MCP can be disabled by a workspace admin, and self-hosted installations use their own domain with `/mcp`.

### Does Outline Have AI Features?

Yes. Outline provides AI answers in cloud-hosted and licensed editions. Answers are restricted to the current user's permissions and include references to source documents. The built-in MCP server provides a separate way for compatible AI assistants to work with workspace content.

### Can I Import Outline Into Metakip?

Not as a first-class native import. Export a representative Outline collection as Markdown or JSON, convert it to Metakip pages, preserve attachments, and verify links and folder structure. Recreate permissions, users, groups, comments, history, webhooks, public publishing, and MCP settings separately.

### Is Outline Self-Hosted?

Yes. Outline offers Cloud and self-hosted or on-premises deployment options. The community self-hosted edition does not have every Cloud or licensed feature, so verify Guest access, AI answers, support, identity, backups, storage, and licensing before choosing it.

### Which Tool Has Better Permissions?

They solve different permission problems. Metakip provides View, Edit, and Admin access for shared pages and folders. Outline provides workspace roles, collection permissions, groups, document sharing, and public publishing. Choose based on whether a smaller page model or a governed team wiki is the better fit.

## Related Metakip Guides

- [Create A Page In Metakip](/getting-started/create-your-first-page/) for browser-based writing.
- [Markdown Support](/getting-started/markdown-support/) for syntax and page links.
- [Organize Metakip Pages And Folders](/getting-started/organize-pages-and-folders/) for shared knowledge structure.
- [Share A Metakip Page](/getting-started/share-a-page/) for View, Edit, and Admin access.
- [Metakip CLI](/agents/metakip-cli/) for terminal workflows.
- [API Reference](/api-reference/endpoints/) for automation and integrations.
- [Use Metakip With AI Assistants](/agents/use-metakip-with-ai-assistants/) for controlled AI assistant access.
- [Self-Host Metakip](/self-hosting/) for deployment and data ownership.

## Sources And Further Reading

### Outline Documentation

- [Outline Pricing](https://www.getoutline.com/pricing)
- [Outline API](https://docs.getoutline.com/s/guide/doc/api-1rEIXDfLF6)
- [Outline MCP](https://docs.getoutline.com/s/guide/doc/mcp-6j9jtENNKL)
- [MCP Changelog](https://www.getoutline.com/changelog/mcp)
- [Collaborative Editing](https://docs.getoutline.com/s/guide/doc/collaborative-editing-GjkoCop1B7)
- [Sharing Documents](https://docs.getoutline.com/s/guide/doc/sharing-LG2sGOLIpl)
- [Collections And Permissions](https://docs.getoutline.com/s/guide/doc/collections-l9o3LD22sV)
- [Users And Roles](https://docs.getoutline.com/s/guide/doc/users-roles-cwCxXP8R3V)
- [Search And AI Answers](https://docs.getoutline.com/s/guide/doc/search-ai-answers-NIKPvYrx06)
- [Export Data](https://docs.getoutline.com/s/guide/doc/export-Da6C7HqL8M)
- [Export Individual Documents](https://docs.getoutline.com/s/guide/doc/export-document-svbz5EcJZu)
- [Import Data](https://docs.getoutline.com/s/guide/doc/import-D2ZvLqz411)
- [Webhooks](https://docs.getoutline.com/s/guide/doc/webhooks-gB7HYhS6yq)
- [Authentication And Security](https://docs.getoutline.com/s/guide/doc/authentication-Wr4sfjvmL1)
- [Desktop App](https://docs.getoutline.com/s/guide/doc/desktop-app-yMRyanaHfs)
- [Outline GitHub Repository](https://github.com/outline/outline)

### Community Discussions

- [Reddit: Is Outline The Best Open Source Personal Wiki For Self-Hosting?](https://www.reddit.com/r/selfhosted/comments/1hygt0y/is_outline_the_best_open_source_personal_wiki_for/)
- [Reddit: Outline As An Open Source Self-Hosted Wiki](https://www.reddit.com/r/selfhosted/comments/ep7m78/outline_an_open_source_selfhosted_beautiful_wiki/)

## Verdict

Choose **Outline** for a mature team wiki with collections, granular permissions, comments, public publishing, AI answers, APIs, webhooks, and built-in MCP. Choose **Metakip** when shared project knowledge should remain a smaller, markdown-centered content layer with a first-class CLI, documented API, real-time coediting, and the option to self-host.
