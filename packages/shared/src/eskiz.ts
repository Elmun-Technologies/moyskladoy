export interface EskizBatchMessage {
  user_sms_id: string;
  to: number;
  text: string;
}

export interface EskizSendResult {
  id: string;
  message?: string;
  status?: string[];
}

export interface EskizReportItem {
  user_sms_id?: string;
  request_id?: string;
  message_id?: string;
  phone_number?: string;
  status?: string;
  status_date?: string;
  price?: number;
  total_price?: number;
}

export interface EskizOptions {
  email: string;
  password: string;
  baseUrl?: string;
  from?: string;
  fetcher?: typeof fetch;
}

/**
 * Eskiz SMS API v1 adapter. API calls are isolated here so worker/API tests can
 * inject a fake fetcher. Login uses multipart form data; send-batch uses the
 * documented JSON body (`messages: [{ user_sms_id, to, text }]`).
 */
export class EskizClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly opts: EskizOptions) {
    this.baseUrl = (opts.baseUrl ?? 'https://notify.eskiz.uz').replace(/\/$/, '');
    this.fetcher = opts.fetcher ?? fetch;
  }

  private async readJson(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    let body: unknown;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 200) }; }
    if (!response.ok) {
      const detail = body && typeof body === 'object' && 'message' in body ? String((body as { message?: unknown }).message ?? '') : '';
      throw new Error(`eskiz_http_${response.status}${detail ? ':' + detail.slice(0, 120) : ''}`);
    }
    return body && typeof body === 'object' ? body as Record<string, unknown> : {};
  }

  private async login(): Promise<string> {
    const form = new FormData();
    form.set('email', this.opts.email);
    form.set('password', this.opts.password);
    const body = await this.readJson(await this.fetcher(`${this.baseUrl}/api/auth/login`, { method: 'POST', body: form }));
    const data = body.data as Record<string, unknown> | undefined;
    const token = data?.token;
    if (typeof token !== 'string' || !token) throw new Error('eskiz_auth_missing_token');
    this.token = token;
    // Official API token lifetime is 30 days; refresh a day early.
    this.tokenExpiresAt = Date.now() + 29 * 86_400_000;
    return token;
  }

  private async authToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    return this.login();
  }

  private async request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    let token = await this.authToken();
    let response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers: { ...(init.headers as Record<string, string> ?? {}), Authorization: `Bearer ${token}` } });
    if (response.status === 401) {
      this.token = null;
      token = await this.login();
      response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers: { ...(init.headers as Record<string, string> ?? {}), Authorization: `Bearer ${token}` } });
    }
    return this.readJson(response);
  }

  async balance(): Promise<{ balance: number | null; raw: Record<string, unknown> }> {
    const raw = await this.request('/api/user/get-limit');
    const data = (raw.data && typeof raw.data === 'object' ? raw.data : raw) as Record<string, unknown>;
    const value = data.balance ?? data.limit ?? raw.balance ?? raw.limit;
    return { balance: value === undefined || value === null || !Number.isFinite(Number(value)) ? null : Number(value), raw };
  }

  async sendBatch(messages: EskizBatchMessage[]): Promise<EskizSendResult> {
    if (messages.length < 1 || messages.length > 5000) throw new Error('eskiz_batch_size_out_of_range');
    const result = await this.request('/api/message/sms/send-batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.opts.from ?? '4546', messages }),
    });
    const data = (result.data && typeof result.data === 'object' ? result.data : result) as Record<string, unknown>;
    const id = data.id ?? result.id;
    if (id === undefined || id === null) throw new Error('eskiz_send_missing_dispatch_id');
    return { id: String(id), message: typeof data.message === 'string' ? data.message : undefined, status: Array.isArray(data.status) ? data.status.map(String) : undefined };
  }

  async reportsByDispatch(dispatchId: string): Promise<EskizReportItem[]> {
    const form = new FormData();
    form.set('dispatch_id', dispatchId);
    const result = await this.request('/api/message/sms/get-user-messages-by-dispatch', { method: 'POST', body: form });
    const data = result.data;
    const rows = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).data) ? (data as Record<string, unknown>).data as unknown[] : [];
    return rows.filter((row): row is EskizReportItem => !!row && typeof row === 'object').map((row) => ({
      user_sms_id: typeof row.user_sms_id === 'string' ? row.user_sms_id : undefined,
      request_id: typeof row.request_id === 'string' ? row.request_id : undefined,
      message_id: typeof row.message_id === 'string' ? row.message_id : undefined,
      phone_number: typeof row.phone_number === 'string' ? row.phone_number : undefined,
      status: typeof row.status === 'string' ? row.status : undefined,
      status_date: typeof row.status_date === 'string' ? row.status_date : undefined,
      price: Number.isFinite(Number(row.price)) ? Number(row.price) : undefined,
      total_price: Number.isFinite(Number(row.total_price)) ? Number(row.total_price) : undefined,
    }));
  }
}
