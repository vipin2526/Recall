import { describe, expect, it } from 'vitest';
import { extractText } from '@/lib/ai/document';

describe('capture URL safety', () => {
  it('rejects loopback hostnames before fetching', async () => {
    await expect(
      extractText({ kind: 'url', url: 'http://localhost:3000/notes' }),
    ).rejects.toMatchObject({ code: 'blocked_url' });
  });

  it('rejects private IP literals', async () => {
    await expect(
      extractText({ kind: 'url', url: 'http://169.254.169.254/latest/meta-data' }),
    ).rejects.toMatchObject({ code: 'blocked_url' });
    await expect(
      extractText({ kind: 'url', url: 'http://192.168.1.10/admin' }),
    ).rejects.toMatchObject({ code: 'blocked_url' });
  });

  it('rejects non-http protocols', async () => {
    await expect(
      extractText({ kind: 'url', url: 'file:///etc/passwd' }),
    ).rejects.toMatchObject({ code: 'bad_url' });
  });
});
