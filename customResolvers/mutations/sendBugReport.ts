import { sendEmail } from "../../services/mail/index.js";

type Args = {
  contactEmail: string;
  username?: string;
  text: string;
  subject: string;
};

/**
 * Converts markdown text to HTML
 * @param text The markdown text to convert
 * @returns HTML formatted text
 */
const convertMarkdownToHtml = (text: string): string => {
  let html = text;

  // Convert code blocks first (to avoid interfering with other patterns): ```code```
  html = html.replace(/```([\s\S]*?)```/g, '<pre style="background-color: #f4f4f4; padding: 10px; border-radius: 4px; overflow-x: auto;"><code>$1</code></pre>');

  // Convert inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code style="background-color: #f4f4f4; padding: 2px 4px; border-radius: 2px;">$1</code>');

  // Convert images: ![alt text](url) - do this before links
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, 
    '<img src="$2" alt="$1" style="max-width: 100%; height: auto; display: block; margin: 10px 0;" />');

  // Convert links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Convert headers
  html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');

  // Convert bold: **text** or __text__
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');

  // Convert italic: *text* or _text_ (simple patterns to avoid conflicts)
  html = html.replace(/\b\*([^*\n]+)\*\b/g, '<em>$1</em>');
  html = html.replace(/\b_([^_\n]+)_\b/g, '<em>$1</em>');

  // Convert blockquotes: > text (do this before line breaks)
  html = html.replace(/^> (.*)$/gm, '<blockquote style="border-left: 4px solid #ddd; margin: 0; padding-left: 16px; color: #666;">$1</blockquote>');

  // Convert unordered lists: - item or * item
  html = html.replace(/^[-*] (.*)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');

  // Convert ordered lists: 1. item
  html = html.replace(/^\d+\. (.*)$/gm, '<li>$1</li>');

  // Convert line breaks last (so they don't interfere with other patterns)
  html = html.replace(/\n/g, '<br>');

  return html;
};

/**
 * Main resolver for sending bug reports
 */
const getSendBugReportResolver = () => {
  return async (_parent: any, args: Args, _context: any, _resolveInfo: any) => {
    const { contactEmail, username, text, subject } = args;

    try {
      if (!process.env.SUPPORT_EMAIL) {
        throw new Error("SUPPORT_EMAIL is not set");
      }

      // Create email content for the bug report
      const plainText = `
Bug Report

Subject: ${subject}
From: ${contactEmail}
${username ? `Username: ${username}` : ''}

Message:
${text}
`;

      // Convert markdown message to HTML
      const htmlMessage = convertMarkdownToHtml(text);
      console.log("Original text:", text);
      console.log("Converted HTML:", htmlMessage);

      // Create HTML version with formatted content
      const html = `
<h2>Bug Report</h2>
<p><strong>Subject:</strong> ${subject}</p>
<p><strong>From:</strong> ${contactEmail}</p>
${username ? `<p><strong>Username:</strong> ${username}</p>` : ''}
<hr>
<h3>Message:</h3>
<div>${htmlMessage}</div>
`;

      // Send the email to support
      const emailSent = await sendEmail({
        to: process.env.SUPPORT_EMAIL,
        subject: `Bug Report: ${subject}`,
        text: plainText,
        html: html,
        replyTo: contactEmail,
      }, {
        throwOnError: true,
        throwOnMissingFrom: true,
      });

      console.log("Sending bug report email to", process.env.SUPPORT_EMAIL);
      return emailSent;
    } catch (e: any) {
      console.error("Error sending bug report email:", e);
      throw new Error(
        `An error occurred while sending the bug report: ${e?.message}`
      );
    }
  };
};

export default getSendBugReportResolver;
