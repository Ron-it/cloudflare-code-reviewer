const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GoogleAuthEnv {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
}

interface Label {
  id: string;
  name: string;
}

interface MessagePart {
  mimeType: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: MessagePart[];
}

interface Message {
  id: string;
  snippet: string;
  payload: MessagePart;
}

export async function getAccessToken(env: GoogleAuthEnv): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  const { access_token } = await res.json<{ access_token: string }>();
  return access_token;
}

export function gmail(accessToken: string) {
  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Gmail ${init?.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`);
    return res.json<T>();
  };

  return {
    listLabels: () => call<{ labels: Label[] }>('/labels').then((r) => r.labels),
    createLabel: (name: string) =>
      call<Label>('/labels', {
        method: 'POST',
        body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
      }),
    listMessageIds: (q: string, maxResults: number) =>
      call<{ messages?: { id: string }[] }>(`/messages?${new URLSearchParams({ q, maxResults: `${maxResults}` })}`).then(
        (r) => (r.messages ?? []).map((m) => m.id)
      ),
    getMessage: (id: string) => call<Message>(`/messages/${id}?format=full`),
    addLabels: (id: string, addLabelIds: string[]) =>
      call<Message>(`/messages/${id}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds }) }),
  };
}

export type Gmail = ReturnType<typeof gmail>;

// What Clef actually sees for each message.
export interface Email {
  from: string;
  to: string;
  subject: string;
  fromMailingList: boolean;
  body: string;
}

const MAX_BODY_CHARS = 3000;

export function toEmail(message: Message): Email {
  const header = (name: string) =>
    message.payload.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
  const html = findPart(message.payload, 'text/html');

  return {
    from: header('from'),
    to: header('to'),
    subject: header('subject'),
    fromMailingList: header('list-unsubscribe') !== '' || header('precedence') === 'bulk',
    body: (findPart(message.payload, 'text/plain') ?? (html && stripHtml(html)) ?? message.snippet).slice(0, MAX_BODY_CHARS),
  };
}

function findPart(part: MessagePart, mimeType: string): string | undefined {
  if (part.mimeType === mimeType && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return undefined;
}

function decodeBase64Url(data: string): string {
  const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function stripHtml(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
