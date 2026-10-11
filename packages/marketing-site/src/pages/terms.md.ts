import type { APIRoute } from 'astro';
import * as termsDocument from '../content/legal/terms.md';
import { legalMarkdownResponse } from '../data/legalDocument';

export const prerender = true;

export const GET: APIRoute = () => legalMarkdownResponse(termsDocument);
