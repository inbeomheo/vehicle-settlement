import { execFileSync } from 'node:child_process';

// Poppler reads the generated PDF itself, including embedded Korean fonts.
// Missing/broken extraction must fail the test instead of silently skipping assertions.
export function extractPdfText(pdf: Buffer) {
  return execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', '-', '-'], {
    input: pdf,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 10000,
  });
}
