import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import CancelDialog from './CancelDialog';
import { jsonResponse, renderApp } from '../test/utils';

afterEach(() => vi.restoreAllMocks());

function mockPreview(p: { lateCancel: boolean; classReturned: boolean; hoursUntilStart: number }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    if (String(url).includes('cancel-preview')) return jsonResponse(p);
    return jsonResponse({ id: 'b1', status: p.lateCancel ? 'LATE_CANCELLED' : 'CANCELLED' });
  });
}

describe('CancelDialog', () => {
  it('AC-16: >= 6h says the class is returned', async () => {
    mockPreview({ lateCancel: false, classReturned: true, hoursUntilStart: 30 });
    renderApp(<CancelDialog bookingId="b1" label="Хатха" onClose={() => undefined} onDone={() => undefined} />);
    expect(await screen.findByTestId('returned-note')).toHaveTextContent('Часът ще бъде върнат на вашата карта.');
    expect(screen.queryByTestId('late-warning')).toBeNull();
  });

  it('AC-17: < 6h shows a loud warning that the class is NOT returned', async () => {
    mockPreview({ lateCancel: true, classReturned: false, hoursUntilStart: 3 });
    const done = vi.fn();
    renderApp(<CancelDialog bookingId="b1" label="Хатха" onClose={() => undefined} onDone={done} />);
    const warn = await screen.findByTestId('late-warning');
    expect(warn).toHaveTextContent('НЯМА да бъде върнат');
    expect(warn).toHaveAttribute('role', 'alert');
    await userEvent.click(screen.getByRole('button', { name: /губя часа/ }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(done.mock.calls[0][0].status).toBe('LATE_CANCELLED');
  });

  it('AC-18: promoted-late (< 6h but returned) says the class is returned', async () => {
    mockPreview({ lateCancel: false, classReturned: true, hoursUntilStart: 2 });
    renderApp(<CancelDialog bookingId="b1" label="x" onClose={() => undefined} onDone={() => undefined} />);
    expect(await screen.findByTestId('returned-note')).toHaveTextContent('късно от списъка');
  });

  it('shows a translated error when the class already started', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => jsonResponse({ error: { code: 'SESSION_STARTED', message: 'x' } }, 409));
    renderApp(<CancelDialog bookingId="b1" label="x" onClose={() => undefined} onDone={() => undefined} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Часът вече е започнал.');
  });
});
