export const navigationAccents = ["blue", "amber", "green", "violet"] as const;

export type NavigationAccent = (typeof navigationAccents)[number];

export interface NavigationItem {
  id: string;
  name: string;
  url: string;
  description: string;
  category: string;
  accent: NavigationAccent;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNavigationItem {
  name: string;
  url: string;
  description?: string;
  category?: string;
  accent?: NavigationAccent;
  position?: number;
}

export interface NavigationListResponse {
  items: NavigationItem[];
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
