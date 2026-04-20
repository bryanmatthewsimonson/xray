// Simplified Turndown HTML->Markdown converter. Ported verbatim from the
// userscript. Based on https://github.com/mixmark-io/turndown (MIT).

class TurndownService {
  constructor(options = {}) {
    this.options = {
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      fence: '```',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined',
      linkReferenceStyle: 'full',
      ...options
    };

    this.rules = this._defaultRules();
    this.customRules = [];
  }

  _defaultRules() {
    return {
      paragraph: {
        filter: 'p',
        replacement: (content) => '\n\n' + content + '\n\n'
      },
      lineBreak: {
        filter: 'br',
        replacement: () => '\n'
      },
      heading: {
        filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
        replacement: (content, node) => {
          const level = parseInt(node.tagName.charAt(1));
          const prefix = '#'.repeat(level);
          return '\n\n' + prefix + ' ' + content + '\n\n';
        }
      },
      blockquote: {
        filter: 'blockquote',
        replacement: (content) => {
          const lines = content.trim().split('\n');
          return '\n\n' + lines.map(line => '> ' + line).join('\n') + '\n\n';
        }
      },
      list: {
        filter: ['ul', 'ol'],
        replacement: (content, node) => {
          const isOrdered = node.tagName === 'OL';
          const items = Array.from(node.children);
          let result = '\n\n';
          items.forEach((item, index) => {
            const prefix = isOrdered ? `${index + 1}. ` : `${this.options.bulletListMarker} `;
            const itemContent = this._processNode(item).trim();
            result += prefix + itemContent + '\n';
          });
          return result + '\n';
        }
      },
      listItem: {
        filter: 'li',
        replacement: (content) => content
      },
      horizontalRule: {
        filter: 'hr',
        replacement: () => '\n\n' + this.options.hr + '\n\n'
      },
      emphasis: {
        filter: ['em', 'i'],
        replacement: (content) => this.options.emDelimiter + content + this.options.emDelimiter
      },
      strong: {
        filter: ['strong', 'b'],
        replacement: (content) => this.options.strongDelimiter + content + this.options.strongDelimiter
      },
      code: {
        filter: 'code',
        replacement: (content, node) => {
          if (node.parentNode && node.parentNode.tagName === 'PRE') return content;
          return '`' + content + '`';
        }
      },
      pre: {
        filter: 'pre',
        replacement: (content) => {
          return '\n\n' + this.options.fence + '\n' + content + '\n' + this.options.fence + '\n\n';
        }
      },
      link: {
        filter: 'a',
        replacement: (content, node) => {
          const href = node.getAttribute('href');
          const title = node.getAttribute('title');
          if (!href) return content;
          let titlePart = title ? ` "${title}"` : '';
          return `[${content}](${href}${titlePart})`;
        }
      },
      image: {
        filter: 'img',
        replacement: (content, node) => {
          const alt = node.getAttribute('alt') || '';
          const src = node.getAttribute('src') || '';
          const title = node.getAttribute('title');
          if (!src) return '';
          let titlePart = title ? ` "${title}"` : '';
          return `![${alt}](${src}${titlePart})`;
        }
      }
    };
  }

  addRule(name, rule) {
    this.customRules.push({ name, ...rule });
  }

  turndown(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let markdown = this._processNode(doc.body);
    markdown = markdown
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+|\s+$/g, '')
      .trim();
    return markdown;
  }

  _processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.replace(/\s+/g, ' ');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    let content = Array.from(node.childNodes)
      .map(child => this._processNode(child))
      .join('');

    for (const rule of this.customRules) {
      if (this._matchesFilter(node, rule.filter)) {
        return rule.replacement(content, node);
      }
    }
    for (const [, rule] of Object.entries(this.rules)) {
      if (this._matchesFilter(node, rule.filter)) {
        return rule.replacement(content, node);
      }
    }
    return content;
  }

  _matchesFilter(node, filter) {
    if (typeof filter === 'string') return node.tagName.toLowerCase() === filter.toLowerCase();
    if (Array.isArray(filter)) return filter.some(f => node.tagName.toLowerCase() === f.toLowerCase());
    if (typeof filter === 'function') return filter(node);
    return false;
  }
}
