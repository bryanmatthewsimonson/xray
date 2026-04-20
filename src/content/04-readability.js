// Simplified Mozilla Readability. Ported verbatim from the userscript.
// Full library: https://github.com/mozilla/readability (MPL 2.0)

class Readability {
  constructor(doc, options = {}) {
    this._doc = doc;
    this._articleTitle = null;
    this._articleByline = null;
    this._articleDir = null;
    this._articleSiteName = null;
    this._attempts = [];

    this._options = {
      debug: false,
      maxElemsToParse: 0,
      nbTopCandidates: 5,
      charThreshold: 500,
      classesToPreserve: [],
      keepClasses: false,
      serializer: el => el.innerHTML,
      disableJSONLD: false,
      ...options
    };

    this._flags = {
      FLAG_STRIP_UNLIKELYS: 0x1,
      FLAG_WEIGHT_CLASSES: 0x2,
      FLAG_CLEAN_CONDITIONALLY: 0x4
    };

    this._defaultFlags = this._flags.FLAG_STRIP_UNLIKELYS |
                         this._flags.FLAG_WEIGHT_CLASSES |
                         this._flags.FLAG_CLEAN_CONDITIONALLY;
  }

  parse() {
    this._removeScripts(this._doc);

    const metadata = this._getArticleMetadata();
    this._articleTitle = metadata.title;

    const articleContent = this._grabArticle();
    if (!articleContent) return null;

    this._postProcessContent(articleContent);

    const textContent = articleContent.textContent;
    const length = textContent.length;

    return {
      title: this._articleTitle,
      byline: metadata.byline,
      dir: this._articleDir,
      content: articleContent.innerHTML,
      textContent,
      length,
      excerpt: metadata.excerpt,
      siteName: metadata.siteName
    };
  }

  _removeScripts(doc) {
    this._removeNodes(doc.getElementsByTagName('script'));
    this._removeNodes(doc.getElementsByTagName('noscript'));
    this._removeNodes(doc.getElementsByTagName('style'));
  }

  _removeNodes(nodeList) {
    for (let i = nodeList.length - 1; i >= 0; i--) {
      const node = nodeList[i];
      if (node.parentNode) node.parentNode.removeChild(node);
    }
  }

  _getArticleMetadata() {
    const metadata = { title: '', byline: '', excerpt: '', siteName: '' };

    const titleElement = this._doc.querySelector('title');
    if (titleElement) metadata.title = titleElement.textContent.trim();

    const ogTitle = this._doc.querySelector('meta[property="og:title"]');
    if (ogTitle) metadata.title = ogTitle.getAttribute('content') || metadata.title;

    const h1 = this._doc.querySelector('h1');
    if (h1 && !metadata.title) metadata.title = h1.textContent.trim();

    const authorMeta = this._doc.querySelector('meta[name="author"]') ||
                       this._doc.querySelector('meta[property="article:author"]');
    if (authorMeta) metadata.byline = authorMeta.getAttribute('content');

    const bylineElement = this._doc.querySelector('.byline, .author, [rel="author"]');
    if (bylineElement && !metadata.byline) metadata.byline = bylineElement.textContent.trim();

    const descMeta = this._doc.querySelector('meta[name="description"]') ||
                     this._doc.querySelector('meta[property="og:description"]');
    if (descMeta) metadata.excerpt = descMeta.getAttribute('content');

    const siteNameMeta = this._doc.querySelector('meta[property="og:site_name"]');
    if (siteNameMeta) metadata.siteName = siteNameMeta.getAttribute('content');

    return metadata;
  }

  _grabArticle() {
    const doc = this._doc;

    let articleElement = doc.querySelector('article') ||
                        doc.querySelector('[role="main"]') ||
                        doc.querySelector('.post-content') ||
                        doc.querySelector('.article-content') ||
                        doc.querySelector('.entry-content') ||
                        doc.querySelector('.content') ||
                        doc.querySelector('main');

    if (!articleElement) {
      const paragraphs = doc.querySelectorAll('p');
      let maxLength = 0;
      let bestParent = null;

      paragraphs.forEach(p => {
        const parent = p.parentElement;
        if (parent) {
          const text = parent.textContent || '';
          if (text.length > maxLength) {
            maxLength = text.length;
            bestParent = parent;
          }
        }
      });

      articleElement = bestParent || doc.body;
    }

    const clone = articleElement.cloneNode(true);
    const container = doc.createElement('div');
    container.appendChild(clone);
    return container;
  }

  _postProcessContent(articleContent) {
    this._cleanStyles(articleContent);

    const allElements = articleContent.querySelectorAll('*');
    allElements.forEach(el => {
      if (el.tagName !== 'IMG' && el.tagName !== 'BR' &&
          el.tagName !== 'HR' && !el.textContent.trim() &&
          !el.querySelector('img')) {
        el.remove();
      }
    });

    const unwanted = ['nav', 'aside', 'footer', 'header', '.sidebar', '.comments', '.advertisement', '.ad', '.social-share'];
    unwanted.forEach(selector => {
      try {
        const elements = articleContent.querySelectorAll(selector);
        elements.forEach(el => el.remove());
      } catch (_) { /* invalid selector, skip */ }
    });
  }

  _cleanStyles(element) {
    element.removeAttribute('style');
    element.removeAttribute('class');
    element.removeAttribute('id');
    Array.from(element.children).forEach(child => this._cleanStyles(child));
  }
}
