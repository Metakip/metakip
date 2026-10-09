import type { RichText } from './richText';

export type MarketingLink =
  | { kind: 'app'; label: string }
  | { kind: 'internal'; label: string; path: string }
  | { kind: 'external'; label: string; url: string };

export interface MarketingSection {
  title: string;
  body: RichText;
  links: readonly MarketingLink[];
}

export interface MarketingSectionWithId extends MarketingSection {
  id: string;
}

export interface MarketingAppendix {
  title: string;
  body: string;
}

export interface MarketingPageDefinition {
  title: string;
  intro: readonly string[];
  closing: string;
  sections: readonly MarketingSection[];
  appendix: readonly MarketingAppendix[];
  footerTitle: string;
  footerLinks: readonly MarketingLink[];
}

export type MarketingHtmlPageDefinition = Omit<MarketingPageDefinition, 'sections' | 'appendix'> & {
  sections: readonly MarketingSectionWithId[];
};
