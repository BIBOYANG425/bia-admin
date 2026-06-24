// Sanitize a free-text search term before it is interpolated into a PostgREST
// `.or()` filter string. `.or()` is a comma/parenthesis-delimited grammar
// (e.g. "description.ilike.%x%,member_id.eq.y"), so raw user input containing
// ',' '(' ')' '*' '\' or '"' could inject extra filter conditions or break the
// filter. Strip those structural + escape characters; the %-wildcards added
// around the term still match. Letters/digits/CJK/space/'-'/'.' are kept (they
// are literal inside an ilike value).
export function sanitizeSearchTerm(s: string | null | undefined): string {
  return (s ?? "").replace(/[,()*\\"]/g, "").trim();
}
