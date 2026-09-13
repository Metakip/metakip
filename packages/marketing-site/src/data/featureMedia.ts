import browserPageDarkImage from '../assets/browser-page-dark.png';
import browserPageLightImage from '../assets/browser-page-light.png';
import inviteAccessDarkImage from '../assets/invite-access-dark.png';
import inviteAccessLightImage from '../assets/invite-access-light.png';
import obsidianImportDarkImage from '../assets/obsidian-import-dark.png';
import obsidianImportLightImage from '../assets/obsidian-import-light.png';
import terminalPageDarkImage from '../assets/terminal-page-dark.png';
import terminalPageLightImage from '../assets/terminal-page-light.png';
import workspaceExportDarkImage from '../assets/workspace-export-dark.png';
import workspaceExportLightImage from '../assets/workspace-export-light.png';

export const FEATURE_IMAGES = {
  'obsidian-import': {
    dark: obsidianImportDarkImage,
    light: obsidianImportLightImage,
    alt: 'The Metakip dialog for importing an Obsidian vault.',
  },
  'workspace-export': {
    dark: workspaceExportDarkImage,
    light: workspaceExportLightImage,
    alt: 'The Metakip workspace menu with the export option selected.',
  },
  'invite-access': {
    dark: inviteAccessDarkImage,
    light: inviteAccessLightImage,
    alt: 'The Metakip sharing panel for granting and restricting page access.',
  },
  'browser-page': {
    dark: browserPageDarkImage,
    light: browserPageLightImage,
    alt: 'A Metakip page open in the browser.',
  },
  'terminal-page': {
    dark: terminalPageDarkImage,
    light: terminalPageLightImage,
    alt: 'The same Metakip page being edited from a terminal.',
  },
} as const;

export type FeatureImageId = keyof typeof FEATURE_IMAGES;
