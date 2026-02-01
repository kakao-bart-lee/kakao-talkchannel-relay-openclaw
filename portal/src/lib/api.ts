export interface User {
  id: string;
  email: string;
  accountId: string;
  createdAt: string;
}

interface MeResponse {
  user: User;
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

export interface OAuthProvider {
  provider: string;
  email: string | null;
  linkedAt: string;
}

export interface OAuthProvidersResponse {
  providers: OAuthProvider[];
}

interface RequestOptions extends RequestInit {
  silent401?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { silent401, ...fetchOptions } = options;

  const res = await fetch(path, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...fetchOptions.headers,
    },
  });

  if (!res.ok) {
    // 인증 확인 요청에서 401은 예상된 상황이므로 조용히 null 반환
    if (silent401 && res.status === 401) {
      return null as T;
    }

    let errorMessage = 'An error occurred';
    try {
      const text = await res.text();
      const json = JSON.parse(text);
      errorMessage = json.error || json.message || errorMessage;
    } catch {
      // JSON 파싱 실패 시 기본 메시지 사용 (raw 텍스트 노출 방지)
    }
    throw new Error(errorMessage);
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return {} as T;
  }

  return res.json();
}

export const api = {
  logout: () =>
    request<void>('/portal/api/logout', {
      method: 'POST',
    }),

  me: () => request<MeResponse | null>('/portal/api/me', { silent401: true }).then(res => res?.user ?? null),

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

  deleteAccount: () =>
    request<void>('/portal/api/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirm: 'DELETE' }),
    }),

  getMessages: (params?: { type?: 'inbound' | 'outbound'; limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.type) searchParams.set('type', params.type);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const query = searchParams.toString();
    return request<MessagesResponse>(`/portal/api/messages${query ? `?${query}` : ''}`);
  },

  // OAuth endpoints
  getLinkedProviders: () =>
    request<OAuthProvidersResponse>('/portal/api/oauth/providers'),

  unlinkProvider: (provider: string) =>
    request<{ success: boolean }>(`/portal/api/oauth/unlink/${encodeURIComponent(provider)}`, {
      method: 'DELETE',
    }),
};
