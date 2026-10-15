// ==========================================
// FILE: src/utils/clipboard.ts
// ==========================================

export const copyToClipboard = async (text: string): Promise<void> => {
  try {
    // Modern API
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return;
    }
    
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    
    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);
    
    if (!successful) {
      throw new Error('Copy command failed');
    }
  } catch (err) {
    console.error('Failed to copy:', err);
    throw err;
  }
};