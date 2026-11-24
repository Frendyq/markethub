import { mockIPC } from '@tauri-apps/api/mocks';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OutboxItem } from '../lib/tauri';
import { Queue } from './Queue';

const conflict: OutboxItem = {
  id: 'op-1',
  label: 'Ship order OTTO-7',
  status: 'conflict',
  attempts: 1,
  lastError: 'Order 7 is SHIPPED, expected RESERVED',
  createdAt: Date.UTC(2026, 10, 25, 9, 0),
  nextAttemptAt: 0,
};

describe('Queue', () => {
  it('shows refused operations with the reason and lets a person retry or discard them', async () => {
    let items: OutboxItem[] = [conflict, { ...conflict, id: 'op-2', label: 'Receive 4 × TAB-A', status: 'pending', attempts: 0, lastError: null }];
    const commands: string[] = [];
    mockIPC((cmd, args) => {
      commands.push(cmd);
      if (cmd === 'outbox') return items;
      if (cmd === 'discard_operation') {
        items = items.filter((i) => i.id !== (args as { id: string }).id);
        return true;
      }
      if (cmd === 'retry_operation') return true;
      throw new Error(cmd);
    });

    render(<Queue status={{ pending: 1, conflicts: 1, online: false, signedIn: true, lastError: null }} />);

    expect(await screen.findByText('Ship order OTTO-7')).toBeInTheDocument();
    expect(screen.getByText('Order 7 is SHIPPED, expected RESERVED')).toBeInTheDocument();
    expect(screen.getByText('refused by the server')).toBeInTheDocument();
    expect(screen.getByText('waiting')).toBeInTheDocument();
    expect(screen.getByText(/No connection/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(commands).toContain('retry_operation');

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(await screen.findByText('Receive 4 × TAB-A')).toBeInTheDocument();
    expect(screen.queryByText('Ship order OTTO-7')).not.toBeInTheDocument();
  });

  it('says when everything is sent', async () => {
    mockIPC((cmd) => (cmd === 'outbox' ? [] : null));
    render(<Queue status={{ pending: 0, conflicts: 0, online: true, signedIn: true, lastError: null }} />);
    expect(await screen.findByText('Everything is sent.')).toBeInTheDocument();
  });
});
