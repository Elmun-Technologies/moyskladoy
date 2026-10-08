import { describe, expect, it } from 'vitest';
import { EskizClient } from '../src/eskiz.js';

function fakeEskizFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    let body: Record<string, unknown>;
    if (url.endsWith('/api/auth/login')) body = { data: { token: 'fake-access-token' } };
    else if (url.endsWith('/api/user/get-limit')) body = { data: { balance: 4321 } };
    else if (url.endsWith('/api/message/sms/send-batch')) body = { data: { id: 'fake-dispatch', status: ['accepted'] } };
    else if (url.endsWith('/api/message/sms/get-user-messages-by-dispatch')) body = { data: [{ user_sms_id: 'sms-1', status: 'DELIVRD', total_price: 95 }] };
    else throw new Error(`unexpected fake Eskiz URL: ${url}`);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetcher, calls };
}

describe('Eskiz adapter (fake fetch only)', () => {
  it('authenticates once, reads fake balance, sends batch, and parses delivery reports', async () => {
    const { fetcher, calls } = fakeEskizFetch();
    const client = new EskizClient({ email: 'fake@example.test', password: 'fake-password', baseUrl: 'https://mock.eskiz.uz', fetcher });

    expect((await client.balance()).balance).toBe(4321);
    const sent = await client.sendBatch([{ user_sms_id: 'sms-1', to: 998901234567, text: 'Test' }]);
    expect(sent).toEqual({ id: 'fake-dispatch', status: ['accepted'], message: undefined });
    const reports = await client.reportsByDispatch('fake-dispatch');
    expect(reports[0]).toMatchObject({ user_sms_id: 'sms-1', status: 'DELIVRD', total_price: 95 });

    const logins = calls.filter((call) => call.url.endsWith('/api/auth/login'));
    expect(logins).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith('/api/user/get-limit'))).toHaveLength(1);
    const send = calls.find((call) => call.url.endsWith('/api/message/sms/send-batch'))!;
    expect(new Headers(send.init.headers).get('authorization')).toBe('Bearer fake-access-token');
    expect(JSON.parse(String(send.init.body))).toMatchObject({ messages: [{ user_sms_id: 'sms-1', to: 998901234567 }] });
    const reportCall = calls.find((call) => call.url.endsWith('/api/message/sms/get-user-messages-by-dispatch'))!;
    expect(reportCall.init.body).toBeInstanceOf(FormData);
  });
});
