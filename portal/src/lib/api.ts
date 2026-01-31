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

  getConnections: () => request<Connection[]>('/portal/api/connections'),

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
};
