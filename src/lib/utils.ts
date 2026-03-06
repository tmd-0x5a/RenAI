import { convertFileSrc } from '@tauri-apps/api/core';

export function cn(...inputs: (string | undefined | null | false)[]) {
  return inputs.filter(Boolean).join(' ');
}

/**
 * 画像パス（Base64, HTTP, または絶対ファイルパス）を適切に表示可能な src に変換する
 */
export function getImageSrc(path: string | null | undefined): string {
  if (!path) return '';
  if (path.startsWith('data:') || path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  return convertFileSrc(path);
}
