---
title: Create A Page In Metakip
description: Create a Metakip page, write markdown, add a page link, and confirm that your first piece of knowledge is saved.
---

Create a page for one useful piece of information, such as a launch checklist, meeting notes, or a project decision. The page title is separate from the markdown content.

## Before You Begin

Sign in to Metakip in your browser. You do not need to know markdown before you start. The editor accepts ordinary text and markdown syntax.

## Create A Page

1. Sign in to Metakip.
2. Choose **New page**.
3. Enter a title that describes the page.
4. Start writing in the editor.

The page opens with the title you entered. Metakip stores the title as page metadata and does not automatically add an H1 to the markdown body.

## Check That It Worked

Leave the page and open it again from the page list. Your title and content should still be present. If you wrote a long page, add headings so people can scan it later.

## Add A Page Link

Type `[[` and start writing the title of another page. Choose a result to insert a link.

You can also write a link directly:

```markdown
[[Project Plan]]
```

To show different text while linking to the same page, use an alias:

```markdown
[[Project Plan|the current plan]]
```

Links can point to a heading on a page:

```markdown
[[Project Plan#Risks]]
```

## Make The Page Useful

Start with the information someone will need later. Add headings when the page becomes long, link to related pages instead of duplicating context, and use a folder when several pages belong together.

See [Markdown Support](/getting-started/markdown-support/) for syntax supported by the editor and API. When you have several related pages, use [Organize Pages and Folders](/getting-started/organize-pages-and-folders/).

## If Something Goes Wrong

If **New page** is unavailable, confirm that you are signed in and that the browser has finished loading your pages. If the page title is correct but the content is missing after reopening it, reload the page and check your connection before writing more.
