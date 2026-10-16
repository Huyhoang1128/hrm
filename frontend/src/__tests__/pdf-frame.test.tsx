import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import PdfFrame, { canShowPdfInline } from '../components/Common/PdfFrame';

const setPdfViewer = (enabled: boolean | undefined) => {
  Object.defineProperty(window.navigator, 'pdfViewerEnabled', { value: enabled, configurable: true });
};

afterEach(() => {
  cleanup();
  setPdfViewer(undefined);
});

describe('PdfFrame', () => {
  it('renders an iframe when the browser can show PDFs inline', () => {
    setPdfViewer(true);
    const { container } = render(<PdfFrame src="https://example.com/a.pdf" title="Tài liệu" />);
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('https://example.com/a.pdf');
  });

  it('falls back to an open link when there is no inline PDF viewer', () => {
    setPdfViewer(false);
    expect(canShowPdfInline()).toBe(false);
    const onLoad = vi.fn();
    const { container } = render(<PdfFrame src="https://example.com/a.pdf" title="Tài liệu" onLoad={onLoad} />);
    expect(container.querySelector('iframe')).toBeNull();
    const link = screen.getByRole('link', { name: /Mở tài liệu/ });
    expect(link.getAttribute('target')).toBe('_blank');
    link.click();
    expect(onLoad).toHaveBeenCalled();
  });

  it('offers a download for Word/Excel files even with a PDF viewer', () => {
    setPdfViewer(true);
    const { container } = render(<PdfFrame src="https://example.com/cv.docx?sig=1" title="CV" />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('link', { name: /Tải tài liệu về/ })).toBeTruthy();
  });

  it('uses a download link for blob: sources', () => {
    setPdfViewer(false);
    render(<PdfFrame src="blob:https://example.com/123" title="Xem trước" downloadName="hop-dong.pdf" />);
    expect(screen.getByRole('link').getAttribute('download')).toBe('hop-dong.pdf');
  });
});
