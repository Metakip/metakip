import { parseEditorHeadingSyntax } from './headingSyntax';

type Request = { generation: number; markdown: string };

self.onmessage = (event: MessageEvent<Request>) => {
  const { generation, markdown } = event.data;
  self.postMessage({ generation, headings: parseEditorHeadingSyntax(markdown) });
};
