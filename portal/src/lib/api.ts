export interface User {
  id: string;
  email: string;
  role: string;
}

export interface Connection {
  conversationKey: string;
  state: 'paired' | 'blocked' | 'active';
  lastSeenAt: string;
}

export interface UnpairResponse {
  success: boolean;
}

export interface BlockResponse {
  success: boolean;
  state: 'blocked' | 'paired';
}

export interface PairingCode {
  code: string;
  expiresAt: string;
}

export interface TokenResponse {
  token: string;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationKey: string;
  direction: 'inbound' | 'outbound';
  content: string;
  createdAt: string;
}

export interface MessagesResponse {
  messages: Message[];
  total: number;
  hasMore: boolean;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.text();
    try {
      const json = JSON.parse(error);
      throw new Error(json.error || json.message || 'An error occurred');
    } catch (e) {
      throw new Error(error || 'An error occurred');
    }
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return {} as T;
  }

  return res.json();
}

export const api = {
  signup: (data: { email: string; password: string }) =>
    request<User>('/portal/api/signup', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: { email: string; password: string }) =>
    request<User>('/portal/api/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  logout: () =>
    request<void>('/portal/api/logout', {
      method: 'POST',
    }),

  me: () => request<User>('/portal/api/me'),

  generatePairingCode: (expirySeconds?: number) =>
    request<PairingCode>('/portal/api/pairing/generate', {
      method: 'POST',
      body: JSON.stringify({ expirySeconds }),
    }),

getConnections: () => request<{ connections: Connection[]; total: number }>('/portal/api/connections'),

  unpairConnection: (conversationKey: string) =>
    request<UnpairResponse>(`/portal/api/connections/${encodeURIComponent(conversationKey)}/unpair`, {
      method: 'POST',
    }),

  blockConnection: (conversationKey: string) =>
    request<BlockResponse>(`/portal/api/connections/${encodeURIComponent(conversationKey)}/block`, {
      method: 'PATCH',
    }),

  getToken: () => request<TokenResponse>('/portal/api/token'),

  regenerateToken: () =>
    request<TokenResponse>('/portal/api/token/regenerate', {
      method: 'POST',
    }),

  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    request<void>('/portal/api/password', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteAccount: (password: string) =>
    request<void>('/portal/api/account', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    }),

  getMessages: (params?: { type?: 'inbound' | 'outbound'; limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.type) searchParams.set('type', params.type);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const query = searchParams.toString();
    return request<MessagesResponse>(`/portal/api/messages${query ? `?${query}` : ''}`);
  },
};
