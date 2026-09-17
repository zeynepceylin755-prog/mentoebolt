import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReadinessIntro from './ReadinessIntro';

describe('ReadinessIntro', () => {
  it('offers a start path and a valid skip path without a score', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const onSkip = vi.fn();

    render(<ReadinessIntro onStart={onStart} onSkip={onSkip} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Önce seni biraz tanıyalım.' })).toBeInTheDocument();
    expect(screen.getByText('Yaklaşık 10 dakika')).toBeInTheDocument();
    expect(screen.queryByText(/100|%|not veriyoruz/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Şimdilik geç' }));
    expect(onSkip).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Başlayalım' }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
