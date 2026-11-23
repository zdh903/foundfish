import { nativeImage } from 'electron';
import { getAssetPath } from './util';

export const trayIcon =
  process.platform === 'win32'
    ? getAssetPath('menu/trayIcon.ico')
    : nativeImage.createFromPath(getAssetPath('menu/trayIcon.png'));

export function generateIconFromPath(path: string) {
  return nativeImage.createFromPath(getAssetPath(path)).resize({ height: 18, width: 18 });
}

export function generateIconFromDataURL(dataURL: string) {
  return nativeImage.createFromDataURL(dataURL).resize({ height: 18, width: 18 });
}
