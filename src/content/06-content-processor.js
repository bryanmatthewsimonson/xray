// Article extraction, metadata parsing, HTML->Markdown conversion, and
// image embedding. The userscript used GM_xmlhttpRequest to fetch
// cross-origin images; we use fetch + host_permissions instead.

var ContentProcessor = {
  extractArticle: () => {
    const documentClone = document.cloneNode(true);
    const reader = new Readability(documentClone);
    const article = reader.parse();

    if (!article || article.length < CONFIG.extraction.minContentLength) {
      Utils.log('Readability extraction failed or content too short');
      return null;
    }

    article.url = Utils.normalizeUrl(window.location.href);
    article.domain = Utils.getDomain(window.location.href);
    article.extractedAt = Math.floor(Date.now() / 1000);
    article.publishedAt = ContentProcessor.extractPublishedDate();
    article.featuredImage = ContentProcessor.extractFeaturedImage();

    Utils.log('Article extracted:', article.title);
    return article;
  },

  extractPublishedDate: () => {
    const selectors = [
      'meta[property="article:published_time"]',
      'meta[name="publication_date"]',
      'meta[name="date"]',
      'time[datetime]',
      '.published-date',
      '.post-date'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const date = element.getAttribute('content') ||
                     element.getAttribute('datetime') ||
                     element.textContent;
        if (date) {
          try { return Math.floor(new Date(date).getTime() / 1000); }
          catch (_) { continue; }
        }
      }
    }
    return null;
  },

  extractFeaturedImage: () => {
    const selectors = [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'article img',
      '.featured-image img',
      '.post-thumbnail img'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const src = element.getAttribute('content') || element.getAttribute('src');
        if (src) {
          try { return new URL(src, window.location.href).href; }
          catch (_) { continue; }
        }
      }
    }
    return null;
  },

  htmlToMarkdown: (html) => {
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      emDelimiter: '*'
    });

    turndownService.addRule('figure', {
      filter: 'figure',
      replacement: (content, node) => {
        const img = node.querySelector('img');
        const figcaption = node.querySelector('figcaption');
        if (img) {
          const alt = img.getAttribute('alt') || '';
          const src = img.getAttribute('src') || '';
          const caption = figcaption ? figcaption.textContent.trim() : '';
          let result = `![${alt}](${src})`;
          if (caption) result += `\n*${caption}*`;
          return '\n\n' + result + '\n\n';
        }
        return content;
      }
    });

    return turndownService.turndown(html);
  },

  extractMedia: (html) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const images = Array.from(doc.querySelectorAll('img')).map(img => ({
      type: 'image', src: img.src, alt: img.alt || '', title: img.title || ''
    }));
    const videos = Array.from(doc.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]')).map(v => ({
      type: 'video',
      src: v.src || (v.querySelector('source') ? v.querySelector('source').src : ''),
      platform: v.src && v.src.includes('youtube') ? 'youtube' :
                v.src && v.src.includes('vimeo')   ? 'vimeo'   : 'native'
    }));
    return { images, videos };
  },

  // Convert image URL to base64 data URL. MV3 fetch + host_permissions
  // replaces the userscript's GM_xmlhttpRequest. Falls back to the
  // original URL on any failure so the article still renders.
  imageToBase64: async (imageUrl) => {
    try {
      const absoluteUrl = new URL(imageUrl, window.location.href).href;
      Utils.log('Converting image to base64:', absoluteUrl);
      const { buffer, type } = await Utils.fetchBinary(absoluteUrl, { timeout: 30000 });
      const dataUrl = Utils.bufferToDataUrl(buffer, type);
      Utils.log('Image converted to base64, length:', dataUrl.length);
      return dataUrl;
    } catch (e) {
      Utils.error('Failed to fetch image for embed:', imageUrl, e);
      return imageUrl;
    }
  },

  embedImagesInMarkdown: async (markdown, progressCallback) => {
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const matches = [...markdown.matchAll(imageRegex)];
    if (matches.length === 0) return markdown;

    Utils.log('Found', matches.length, 'images to embed');
    let result = markdown;

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const [fullMatch, alt, url] = match;

      if (progressCallback) progressCallback(i + 1, matches.length);
      if (url.startsWith('data:')) continue;

      const base64 = await ContentProcessor.imageToBase64(url);
      if (base64 && base64.startsWith('data:')) {
        result = result.replace(fullMatch, `![${alt}](${base64})`);
        Utils.log('Embedded image', i + 1, '/', matches.length);
      }
    }

    return result;
  }
};
