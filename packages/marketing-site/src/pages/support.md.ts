import type { APIRoute } from 'astro';
import * as supportDocument from '../content/legal/support.md';
import { legalMarkdownResponse } from '../data/legalDocument';

export const prerender = true;

export const GET: APIRoute = () => legalMarkdownResponse(supportDocument);
