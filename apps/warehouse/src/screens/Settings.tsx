import { useState } from 'react';
import { Button, Card, Field, Notice, PageTitle, inputClass } from '../components/ui';
import { api, errorMessage, type AppInfo } from '../lib/tauri';

export function Settings({ info, onChanged, onSignOut }: { info: AppInfo; onChanged: () => void; onSignOut?: () => void }) {
  const [url, setUrl] = useState(info.serverUrl);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const save = async () => {
    try {
      await api.setServerUrl(url);
      setMessage({ tone: 'success', text: 'Saved.' });
      onChanged();
    } catch (failure) {
      setMessage({ tone: 'error', text: errorMessage(failure) });
    }
  };

  return (
    <>
      <PageTitle title="Settings" />
      <div className="max-w-xl space-y-4">
        <Card title="Server">
          <div className="space-y-3">
            <Field label="MarketHub API address" hint="For example http://localhost:3000 or https://markethub.example.com">
              <input className={`${inputClass} font-mono`} value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
            {message && <Notice tone={message.tone}>{message.text}</Notice>}
            <Button onClick={() => void save()}>Save</Button>
          </div>
        </Card>
        {onSignOut && (
          <Card title="Account">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-600">{info.email ?? 'signed in'}</span>
              <Button variant="secondary" onClick={onSignOut}>
                Sign out
              </Button>
            </div>
          </Card>
        )}
        <p className="text-xs text-zinc-400">MarketHub Warehouse {info.version}</p>
      </div>
    </>
  );
}
