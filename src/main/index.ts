import url from 'url';
import fs from 'fs';
import path from 'path';

// 打包后 menubar app 无终端，stderr/stdout 管道可能已关闭
// console.error 往关闭的管道写会抛 EPIPE → uncaught exception 崩溃
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});
// 兜底：任何未捕获异常都不弹 Electron 默认崩溃框
process.on('uncaughtException', (e) => {
  try { console.error('[uncaughtException]', e?.message); } catch {}
});
process.on('unhandledRejection', (e) => {
  try { console.error('[unhandledRejection]', e); } catch {}
});
import {
  app,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  clipboard,
  dialog,
  webContents,
  shell,
  BrowserWindow,
  Tray,
} from 'electron';
import OpenAI from 'openai';
import { createTray } from './tray';
import LocalStore from './store';
import { ProxyManager } from './proxy';
import { saveImage, saveJsonToCsv, saveString, readStringFile, readFile } from './io';
import {
  lockSingleInstance,
  checkEnvTool,
  sendMessageToRenderer,
  setNativeTheme,
  getOtherWindows,
  makeFakeUA,
  isSupportBlurBg,
  resolveHtmlPath,
  getPreloadPath,
  getAssetPath,
} from './util';
import HttpClient from './httpClient';
import * as Enums from '../renderer/utils/enums';

let openBackupFilePath = '';
let ua = '';
let fakeUA = '';
let proxyMode = '';
let openai: OpenAI;
let mainWindow: BrowserWindow | null = null;
let mainTray: Tray | null = null;

function createPlainWindow() {
  app.dock?.show();
  app.dock?.setIcon(getAssetPath('dockIcon.png'));

  // 顶部状态栏 tray 图标（只创建一次）
  if (!mainTray) {
    mainTray = createTray();
    mainTray.setToolTip('FoundFish 基鱼');
    mainTray.on('click', () => {
      // 点击 tray 图标聚焦或重建窗口
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      } else {
        // 窗口已销毁（如渲染进程崩溃），重建
        createWindowInstance();
      }
    });
  }

  const localStore = new LocalStore();
  const proxyManager = new ProxyManager();

  // 注册渲染进程需要的 IPC handlers（plain preview 模式跳过了 main() 里的注册）
  ipcMain.handle('is-support-blur-bg', () => isSupportBlurBg());
  ipcMain.handle('get-storage-config', (event: any, config: any) => localStore.get(config.type, config.key, config.init));
  ipcMain.handle('set-storage-config', (event: any, config: any) => localStore.set(config.type, config.key, config.value));
  ipcMain.handle('delete-storage-config', (event: any, config: any) => localStore.delete(config.type, config.key));
  ipcMain.handle('cover-storage-config', (event: any, config: any) => localStore.cover(config.type, config.value));
  ipcMain.handle('all-storage-config', (event: any, config: any) => localStore.getStore(config.type));
  ipcMain.handle('get-version', () => app.getVersion());
  ipcMain.handle('get-fakeUA', () => fakeUA);
  ipcMain.handle('get-should-use-dark-colors', () => nativeTheme.shouldUseDarkColors);
  ipcMain.handle('set-native-theme-source', (event: any, config: any) => setNativeTheme(config));
  ipcMain.handle('shell-openExternal', (event: any, config: any) => shell.openExternal(config));
  ipcMain.handle('show-message-box', (event: any, config: any) => dialog.showMessageBox(config));
  ipcMain.handle('show-save-dialog', (event: any, config: any) => dialog.showSaveDialog(config));
  ipcMain.handle('show-open-dialog', (event: any, config: any) => dialog.showOpenDialog(config));
  ipcMain.handle('app-quit', () => app.quit());
  ipcMain.handle('app-relaunch', () => { app.relaunch(); app.exit(); });
  ipcMain.handle('set-login-item-settings', (event: any, config: any) => app.setLoginItemSettings(config));
  ipcMain.handle('request', async (event: any, { url, config }: any) => {
    const httpClient = new HttpClient();
    httpClient.userAgent = fakeUA;
    httpClient.dispatcher = proxyManager.agent;
    return httpClient.request(url, config);
  });
  ipcMain.handle('io-saveImage', (event: any, { path, content }: any) => saveImage(path, content));
  ipcMain.handle('io-saveJsonToCsv', (event: any, { path, content }: any) => saveJsonToCsv(path, content));
  ipcMain.handle('io-saveString', (event: any, { path, content }: any) => saveString(path, content));
  ipcMain.handle('io-readStringFile', (event: any, { path }: any) => readStringFile(path));
  ipcMain.handle('io-readFile', (event: any, { path }: any) => readFile(path));
  ipcMain.handle('clipboard-readText', () => clipboard.readText());
  ipcMain.handle('clipboard-writeText', (event: any, text: any) => clipboard.writeText(text));
  ipcMain.handle('clipboard-writeImage', (event: any, dataUrl: any) => clipboard.writeImage(nativeImage.createFromDataURL(dataUrl)));
  ipcMain.handle('openai-chat', async (event: any, params: any) => {
    try {
      const res = await openai?.chat.completions.create(params);
      return res?.choices[0].message.content;
    } catch (err) {
      return `Error: ${err}`;
    }
  });
  ipcMain.handle('openai-update-config', (event: any, { apiKey, baseURL }: any) => {
    openai = new OpenAI({ apiKey, baseURL });
  });
  // stub handlers for menubar-specific features
  ipcMain.handle('show-current-window', () => {});
  ipcMain.handle('set-tray-content', () => {});
  ipcMain.handle('check-update', () => {});
  ipcMain.handle('set-menubar-visible', () => {});
  ipcMain.handle('set-opacity', () => {});
  ipcMain.handle('set-alwaysOnTop', () => {});
  ipcMain.handle('update-touchbar-zindex', () => {});
  ipcMain.handle('update-touchbar-wallet', () => {});
  ipcMain.handle('update-touchbar-tab', () => {});
  ipcMain.handle('update-touchbar-eye-status', () => {});
  ipcMain.handle('update-tray-context-menu-wallets', () => {});
  ipcMain.handle('set-visible-hotkey', () => {});
  ipcMain.handle('set-translate-hotkey', () => {});
  ipcMain.handle('open-child-window', () => {});
  ipcMain.handle('sync-multi-window-store', () => {});
  ipcMain.handle('registry-webview', () => {});
  ipcMain.handle('set-proxy', async (event: any, config: any) => {
    await event.sender.session.setProxy(config);
  });

  createWindowInstance();
}

function createWindowInstance() {
  // 如果已有旧窗口，先清理
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }

  const window = new BrowserWindow({
    width: 360,
    height: 760,
    minHeight: 400,
    minWidth: 300,
    show: true,
    icon: getAssetPath('dockIcon.png'),
    webPreferences: {
      webviewTag: true,
      devTools: !app.isPackaged,
      preload: getPreloadPath(),
      spellcheck: false,
      scrollBounce: true,
    },
  });

  // 渲染进程崩溃/被杀后自动重建
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[render-process-gone] reason:', details.reason, 'exitCode:', details.exitCode);
    // render-process-gone 后窗口处于半死状态，标记销毁以便 tray 点击时重建
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
    mainWindow = null;
    // 自动重建（用户不用手动操作）
    createWindowInstance();
  });

  // 生成 fakeUA
  ua = window.webContents.getUserAgent();
  fakeUA = makeFakeUA(ua);
  window.webContents.setUserAgent(fakeUA);
  window.webContents.session.setUserAgent(fakeUA);

  window.show();
  window.focus();
  window.loadURL(resolveHtmlPath());

  mainWindow = window;
}

// FIXME: 部分库缺少对ESM的支持
global.__filename = url.fileURLToPath(import.meta.url);
global.__dirname = url.fileURLToPath(new URL('.', import.meta.url));

async function init() {
  // 单例
  lockSingleInstance();
  await app.whenReady();
  await checkEnvTool();
  appEmits();
  main();
}

function appEmits() {
  // app 相关监听
  app.on('window-all-closed', () => {
    // Respect the OSX convention of having the application in memory even
    // after all windows have been closed
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
  app.on('browser-window-focus', () => {
    if (app.isPackaged) {
      globalShortcut.register('CommandOrControl+Shift+R', () => {});
      globalShortcut.register('CommandOrControl+R', () => {});
      globalShortcut.register('F5', () => {});
    }
  });
  app.on('browser-window-blur', () => {
    if (app.isPackaged) {
      globalShortcut.unregister('CommandOrControl+R');
      globalShortcut.unregister('F5');
      globalShortcut.unregister('CommandOrControl+Shift+R');
    }
  });
  app.on('second-instance', (event, argv, cwd) => {
    // 再次双击图标启动时：聚焦/还原已有窗口
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } else if (!app.dock?.isVisible?.()) {
      // 无窗口（如被关闭/崩溃后）：重建，保证点图标必有响应
      createWindowInstance();
    }
  });
  // macOS 关窗后点 Dock 图标：重新显示窗口（否则应用活着但永远唤不醒）
  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindowInstance();
    }
  });
  app.on('open-file', (even, path: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      sendMessageToRenderer(mainWindow, 'open-backup-file', path);
    } else {
      openBackupFilePath = path;
    }
  });
  app.on('will-quit', () => {
    // Unregister all shortcuts.
    globalShortcut.unregisterAll();
  });
}

function main() {
  // 独立窗口模式（menubar 模式已停用并移除，历史实现见 git 历史 src/main/menubar.ts）
  createPlainWindow();
}

init().catch((e) => {
  console.log(e);
  // 单实例锁失败等启动期异常：静默退出，避免无窗口僵尸进程占住锁
  if (String(e?.message || e).includes('single-instance-lock-failed')) {
    app.exit(0);
  }
});
