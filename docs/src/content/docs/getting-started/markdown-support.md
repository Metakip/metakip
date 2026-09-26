---
title: Markdown Support In Metakip
description: See which markdown syntax Metakip supports, how page links and frontmatter work, and which features remain partial.
---

Metakip uses markdown for page content, with a few product-specific extensions. The same authored markdown can be read through the browser, CLI, and API.

## Supported Markdown

| Syntax | Status | Example |
| --- | --- | --- |
| Headings | Supported | `## Project Notes` |
| Bold and italic text | Supported | `**bold**` and `*italic*` |
| Strikethrough | Supported | `~~removed text~~` |
| Inline code | Supported | ``npm run dev`` |
| Links | Supported | `[Metakip](https://metakip.com)` |
| Images | Supported | `![Alt text](https://example.com/image.png)` |
| Bulleted and numbered lists | Supported | `- One` and `1. One` |
| Task lists | Supported | `- [ ] Todo` and `- [x] Done` |
| Blockquotes | Supported | `> A quoted line` |
| Fenced code blocks | Supported | Triple backticks with an optional language |
| Tables | Supported | GitHub Flavored Markdown tables |
| Horizontal rules | Supported | `---` |
| Inline math | Supported | `$E=mc^2$` |
| Block math | Supported | A `$$` block rendered as LaTeX math |
| Page links | Supported | `[[Project Notes]]` |
| Page links with labels | Supported | `[[Project Notes | Read the notes]]` |
| Page links to headings | Supported | `[[Project Notes#Decisions]]` |
| Inline tags | Supported | `#research` |

## Page Links

Use double brackets when one Metakip page should link to another:

```markdown
[[Project Notes]]
[[Project Notes | Read the notes]]
[[Project Notes#Decisions]]
```

The editor suggests matching pages while you type. The double-bracket syntax is the underlying markdown form.

Use page links when a page refers to information that already exists elsewhere. This keeps the source page shorter and gives readers a path to the related context.

## Images

Use ordinary Markdown for an image that is already hosted and available to every intended reader:

```markdown
![System diagram](https://example.com/system-diagram.png)
```

Images pasted, dropped, or selected in the browser are uploaded as private managed attachments.
API and CLI clients can also upload managed JPEG, PNG, GIF, and WebP files to an editable page.
Base64 data image URLs are accepted by Markdown, but they are discouraged because they make the
collaborative page document much larger and bypass attachment caching and cleanup.

## Callouts Are Partially Supported

The editor recognizes `NOTE`, `TIP`, `WARNING`, `DANGER`, `INFO`, and `EXAMPLE` callouts:

```markdown
> [!NOTE]
> Keep this detail in mind.
```

Support is currently partial. If you import or create a page through the API or CLI, verify how the callout renders in the browser before relying on it. GitHub callout types such as `IMPORTANT` and `CAUTION` are not currently recognized as Metakip callout types.

## Frontmatter

A page can begin with YAML frontmatter for page properties and an icon:

```yaml
---
icon: lightbulb
tags:
  - project
  - planning
status: active
---
```

Frontmatter is metadata, not visible page content. A page title is separate metadata, so do not add a duplicate H1 just to set the page title.

## Not Currently Rendered

| Syntax | Current behavior |
| --- | --- |
| Mermaid diagrams | A fenced `mermaid` block stays a code block. |
| Raw HTML | HTML is not a supported page layout language. |
| Footnotes | No dedicated footnote rendering is available. |
| `IMPORTANT` and `CAUTION` callouts | Treated as ordinary quote content. |
| Arbitrary custom directives | No directive syntax is defined. |
| Embedded third-party widgets | Use a normal link instead. |

For portable content, prefer headings, paragraphs, lists, links, images, tables, code blocks, and ordinary blockquotes.

## Related Guides

- [Create A Page In Metakip](/getting-started/create-your-first-page/) shows page titles and page links in a first page.
- [Bring Your Notes to Metakip](/getting-started/bring-your-notes/) explains what to check after an import.
- [Metakip CLI](/agents/metakip-cli/) shows how to import and export markdown from a terminal.
