import { mockIPC } from '@tauri-apps/api/mocks';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Order, ScanView } from '../lib/tauri';
import { OrderPick } from './OrderPick';

vi.mock('../lib/sound', () => ({ beep: vi.fn() }));

const order = (scanned: number): Order => ({
  id: 7,
  marketplace: 'otto',
  externalId: 'OTTO-7',
  customerName: 'Mia Fischer',
  placedAt: '2026-11-25T08:00:00Z',
  lines: [{ productId: 1, sku: 'TAB-A', title: 'Oak table', ean: '4006381333931', location: 'A-01-1', quantity: 2, scanned }],
  units: 2,
  scannedUnits: scanned,
  complete: scanned >= 2,
});

function backend(outcomes: ScanView[]) {
  const calls: { cmd: string; args: unknown }[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    switch (cmd) {
      case 'picking_order':
        return order(0);
      case 'scan_code':
        return outcomes.shift();
      case 'ship_order':
        return { id: 'op-1', label: 'Ship order OTTO-7', status: 'pending', attempts: 0, lastError: null, createdAt: 0, nextAttemptAt: 0 };
      case 'sync_now':
        return null;
      case 'sync_status':
        return { pending: 1, conflicts: 0, online: false, signedIn: true, lastError: null };
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  });
  return calls;
}

describe('OrderPick', () => {
  it('shows the walk list with locations and blocks shipping until everything is scanned', async () => {
    backend([]);
    render(<OrderPick orderId={7} onBack={vi.fn()} onShipped={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'OTTO-7' })).toBeInTheDocument();
    expect(screen.getByText('A-01-1')).toBeInTheDocument();
    expect(screen.getByText('0/2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ship' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Print label' })).toBeDisabled();
  });

  it('sends each scan to Rust and shows the result', async () => {
    const calls = backend([
      { outcome: { result: 'matched', sku: 'TAB-A', title: 'Oak table', scanned: 1, needed: 2 }, order: order(1) },
      { outcome: { result: 'notInOrder' }, order: order(1) },
    ]);
    render(<OrderPick orderId={7} onBack={vi.fn()} onShipped={vi.fn()} />);
    const input = await screen.findByLabelText('Barcode');

    await userEvent.type(input, '4006381333931{Enter}');
    expect(await screen.findByText('Oak table: 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(input).toHaveValue('');

    await userEvent.type(input, '4000000000006{Enter}');
    expect(await screen.findByText('This item is not in the order. Check the shelf.')).toBeInTheDocument();
    expect(calls.filter((c) => c.cmd === 'scan_code').map((c) => c.args)).toEqual([
      { orderId: 7, code: '4006381333931' },
      { orderId: 7, code: '4000000000006' },
    ]);
  });

  it('ships a picked order and says it is queued when offline', async () => {
    backend([{ outcome: { result: 'matched', sku: 'TAB-A', title: 'Oak table', scanned: 2, needed: 2 }, order: order(2) }]);
    const onShipped = vi.fn();
    render(<OrderPick orderId={7} onBack={vi.fn()} onShipped={onShipped} />);

    await userEvent.type(await screen.findByLabelText('Barcode'), '4006381333931{Enter}');
    expect(await screen.findByText('All items picked. Print the label and ship.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ship' }));
    expect(onShipped).toHaveBeenCalledWith('OTTO-7', true);
  });
});
