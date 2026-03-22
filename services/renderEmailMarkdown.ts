import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

export const renderEmailMarkdownToHtml = (value: string): string => {
  return markdown.render(value);
};
