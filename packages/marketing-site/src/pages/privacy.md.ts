import type { APIRoute } from 'astro';
import * as privacyDocument from '../content/legal/privacy.md';
import { legalMarkdownResponse } from '../data/legalDocument';

export const prerender = true;

export const GET: APIRoute = () => legalMarkdownResponse(privacyDocument);
