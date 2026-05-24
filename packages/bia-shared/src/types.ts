export type Role = "super_admin" | "editor" | "viewer";

export interface AdminUser {
  id: string;            // FK to auth.users.id
  email: string;
  role: Role;
  created_at: string;
}

export interface AdminInvitation {
  id: string;
  email: string;
  role: Role;
  invited_by: string | null;
  accepted_at: string | null;
  created_at: string;
}

export const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  super_admin: 3,
};

export function roleAtLeast(have: Role, need: Role): boolean {
  return ROLE_RANK[have] >= ROLE_RANK[need];
}

export type ArticleStatus = "draft" | "in_review" | "published" | "unpublished";
export type ArticleLanguage = "en" | "zh";

export interface Article {
  id: string;
  slug: string;
  title: string;
  html_clean: string;
  excerpt: string | null;
  cover_image_url: string | null;
  language: ArticleLanguage;
  tags: string[];
  author_id: string;
  status: ArticleStatus;
  submitted_at: string | null;
  submitted_by: string | null;
  published_at: string | null;
  published_by: string | null;
  unpublished_at: string | null;
  unpublished_by: string | null;
  created_at: string;
  updated_at: string;
}
