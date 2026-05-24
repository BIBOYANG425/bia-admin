import DOMPurify from "isomorphic-dompurify";

// Permissive allowlist: dropped HTML files include their own design (style
// tags, classes, layout markup, images). We allow those through and then
// render the result inside a sandboxed iframe so the article's CSS can't
// affect uscbia.com's chrome. The iframe also blocks scripts, so this
// sanitize layer is belt-and-suspenders — its job is to strip the worst
// XSS vectors before storage.
const ALLOWED_TAGS = [
  // headings + text
  "h1","h2","h3","h4","h5","h6",
  "p","br","hr","span","div","a",
  "b","i","em","strong","u","s","del","ins","mark","sub","sup","small",
  "abbr","cite","kbd","code","pre","samp","var","time","q","wbr",
  // lists
  "ul","ol","li","dl","dt","dd",
  // quotes
  "blockquote",
  // tables
  "table","caption","thead","tbody","tfoot","tr","th","td","col","colgroup",
  // layout / sectioning
  "header","footer","section","article","aside","main","nav",
  "figure","figcaption","details","summary",
  // media
  "img","picture","source","video","audio","track",
  // styling
  "style",
];

const ALLOWED_ATTR = [
  // global / styling
  "class","id","style","lang","dir","title","role",
  // links
  "href","target","rel",
  // images / media
  "src","alt","srcset","sizes","width","height","loading","decoding","fetchpriority",
  "controls","poster","preload","muted","autoplay","loop","playsinline",
  // tables / lists
  "colspan","rowspan","scope","span","start","reversed","type","value",
  // misc
  "open","datetime","name",
  // aria
  "aria-label","aria-labelledby","aria-describedby","aria-hidden",
];

// Things we still strip regardless of what the article contains.
const FORBID_TAGS = [
  "script","iframe","object","embed",
  "form","input","textarea","select","button",
  "meta","base","link",
];

export function sanitizeArticleHtml(input: string): string {
  if (!input) return "";

  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS,
    // DOMPurify treats <style> as belonging in <head>; when parsing a fragment
    // it strips style elements that appear in body. FORCE_BODY tells the
    // parser to keep body-positioned <style> tags intact so articles can ship
    // their own CSS. The iframe sandbox is the real defense against CSS-based
    // attacks; sanitize here only catches the most obvious XSS vectors.
    FORCE_BODY: true,
    ADD_TAGS: ["style"],
    // Empty array overrides the default content-stripping for <style>.
    FORBID_CONTENTS: [],
    ALLOW_DATA_ATTR: true,
    // Allow http(s), data: (for inline assets), mailto:, tel:, anchors, and
    // root-relative URLs. Implicit drop of javascript: and other schemes.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data):|\/|#)/i,
  }).trim();
}
