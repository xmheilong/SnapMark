/**
 * MIT License
 * 
 * Copyright (c) 2026 game1024
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";
import "@excalidraw/excalidraw/css/app.scss";
import "@excalidraw/excalidraw/css/styles.scss";
import "@excalidraw/excalidraw/fonts/fonts.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from '@tauri-apps/api/core';
import { clickRippleAnimate, clickFirework, clickSpiral, clickCircleStroke, clickRectStroke } from "./animation/mouse";
import { type } from '@tauri-apps/plugin-os';
import { Excalidraw } from "@excalidraw/excalidraw";
import { useMouseSettings } from "../../hooks/useMouseSettings";
import { useKeyboardSettings } from "../../hooks/useKeyboardSettings";
import { useDrawingSettings } from "../../hooks/useDrawingSettings";
import { KeyLabel, MODIFIER_KEY_LIST, IGNORE_KEY_LIST, MOUSE_CLICK_KEYS } from "../../types/ModifierKey";
import { Alert, Snackbar, Zoom } from "@mui/material";
import i18n from "../../i18n";

interface ScreenInfo {
    screens: Array<{
        index: number;
        width: number;
        height: number;
        x: number;
        y: number;
        is_primary: boolean;
    }>;
    total_width: number;
    total_height: number;
}

interface Selection {
    x: number;
    y: number;
    width: number;
    height: number;
}

function App() {
  // 从 store 加载鼠标设置
  const { mouseSettings, } = useMouseSettings();

  const { keyboardSettings, } = useKeyboardSettings();
  const { drawingSettings, } = useDrawingSettings();

  // 存储鼠标穿透状态
  const [ignoreCursorEvents, setIgnoreCursorEvents] = useState(true);

  // 语言状态
  const [locale, setLocale] = useState<string>(i18n.language || 'zh-CN');

  // 记录键盘状态
  const [keyboardPanel, setKeyboardPanel] = useState<{
    keys: string[];
    modifierKeys: string[];
    offsetX: number;
    offsetY: number;
    scale: number;
  }>({
    keys: [],
    modifierKeys: [],
    offsetX: 0,
    offsetY: 0,
    scale: 1.0
  })

  useEffect(() => {
    if (keyboardSettings?.preview) {
      setKeyboardPanel(prev => ({
        ...prev,
        keys: ['实时预览'],
        offsetX: keyboardSettings.offsetX ?? 0,
        offsetY: keyboardSettings.offsetY ?? 0,
        scale: keyboardSettings.scale ?? 1.0,
      }));
    } else {
      setKeyboardPanel(prev => ({
        ...prev,
        keys: [],
        offsetX: keyboardSettings?.offsetX ?? 0,
        offsetY: keyboardSettings?.offsetY ?? 0,
        scale: keyboardSettings?.scale ?? 1.0,
      }));
    }
  }, [keyboardSettings]);

  // 监听来自主窗口的语言变化事件
  useEffect(() => {
    const setupListener = async () => {
      const appWindow = getCurrentWindow();
      
      const unlisten = await appWindow.listen<{ language: string }>('language-updated', (event) => {
        console.log('Received language-updated event:', event.payload.language);
        const newLanguage = event.payload.language;
        setLocale(newLanguage);
        // 更新 i18n 实例
        i18n.changeLanguage(newLanguage);
      });

      return unlisten;
    };

    const unlistenPromise = setupListener();

    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, []);

  // 组件挂载时初始化窗口设置
  useEffect(() => {
    // 设置窗口焦点和忽略鼠标事件
    // 只能在渲染进程调用，确保整个窗口创建完后再忽略鼠标事件，否则会导致留有窗口边框残影
    // 注意：setIgnoreCursorEvents(true) 会导致窗口无法获得焦点
    // 如果需要忽略鼠标事件，将无法实现自动重新获取焦点
    const showWindow = async () => {
      const appWindow = await getCurrentWindow();
      await appWindow.setFocusable(false);
      await appWindow.setIgnoreCursorEvents(ignoreCursorEvents);
    }
    showWindow();
  }, []);

  // 监听全局快捷键切换鼠标穿透
  useEffect(() => {
    const setupListener = async () => {
      const appWindow = getCurrentWindow();
      const label = appWindow.label;
      console.log(`[${label}] 设置事件监听器`);

      // 使用 appWindow.listen 只监听发送给当前窗口的事件
      const unlisten = await appWindow.listen('toggle-cursor-events', async (event) => {
        console.log(event)
        console.log(`[${label}] 收到 toggle-cursor-events 事件, 当前状态: ${ignoreCursorEvents}`);
        const newState = !ignoreCursorEvents;

        setIgnoreCursorEvents(newState);
        if (newState == false) {
          setSnackbar({ open: true, message: '进入绘制模式' });
          setKeyboardPanel(prev => ({ ...prev, modifierKeys: [], keys: [] }));
          await appWindow.setFocusable(true)
          await appWindow.setIgnoreCursorEvents(newState);
          await appWindow.setFocus();

        } else {
          //setSnackbar({ open: true, message: '退出绘制模式' });
          // 解决MacOS退出绘制模式，光标样式没有立即恢复的问题
          // 使窗口无法获得焦点, 退出绘图模式后能立马捕获键盘事件
          setKeyboardPanel(prev => ({ ...prev, modifierKeys: [], keys: [] }));
          await appWindow.setFocusable(false);
          await appWindow.hide();
          await appWindow.show();
          await appWindow.setIgnoreCursorEvents(newState);
        }
      });
      return unlisten;
    };

    const unlistenPromise = setupListener();
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, [ignoreCursorEvents]);

  // 监听窗口可见性的变化
  useEffect(() => {
    const showWindow = async () => {
      const appWindow = await getCurrentWindow();
      const isVisible = await appWindow.isVisible();

      if (!isVisible) {
        await appWindow.show();
        await appWindow.unminimize();
        await appWindow.setAlwaysOnBottom(false);
        await appWindow.setAlwaysOnTop(true);
      }
    }

    const interval = setInterval(() => {
      showWindow();
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // 如果未启用点击特效，不添加监听器
    if (!mouseSettings.enableClickEffect) {
      return;
    }

    // 根据配置选择点击特效
    const effectMap = {
      ripple: clickRippleAnimate,
      firework: clickFirework,
      spiral: clickSpiral,
      circleStroke: clickCircleStroke,
      rectStroke: clickRectStroke,
    };

    const onClick = (e: MouseEvent) => {
      const effect = effectMap[mouseSettings.clickEffectType || 'ripple'];
      effect(e, mouseSettings);
    };

    const parent = document.querySelector('body');
    parent?.addEventListener('click', onClick, true);

    return () => {
      parent?.removeEventListener('click', onClick, true);
    }
  }, [mouseSettings]);

  useEffect(() => {
    // 监听来自 Rust 的全局鼠标事件
    const setupListener = async () => {
      const appWindow = getCurrentWindow();

      const unlistenRefreshMonitors = await appWindow.listen('refresh-monitors', async (event) => {
        console.log('refresh-monitors event received:', event);
        setKeyboardPanel(prev => ({ ...prev, modifierKeys: [], keys: [] }));
      });

      // 监听鼠标点击事件
      // 如果鼠标穿透关闭,不处理点击事件
      const unlistenMouseDown = await appWindow.listen<{ x: number, y: number }>('mouse-click', async (event) => {
        if (!ignoreCursorEvents) {
          return;
        }
        console.log('mouse-click event received:', event);
        const [innerPosition, outerPosition, innerSize, outerSize, scaleFactor] = await Promise.all([
          appWindow.innerPosition(),
          appWindow.outerPosition(),
          appWindow.innerSize(),
          appWindow.outerSize(),
          appWindow.scaleFactor()
        ]);

        console.log('Window Inner position:', innerPosition);
        console.log('Window Outer position:', outerPosition);
        console.log('Inner size:', innerSize);
        console.log('Outer size:', outerSize);
        console.log('Scale factor:', scaleFactor);
        try {
          console.log('rdev mouse-down payload:', { x: event.payload.x, y: event.payload.y });

          // 跨平台坐标转换
          // macOS: 窗口坐标返回的是逻辑像素，需要除以缩放因子转成物理像素，再和rev鼠标计算
          // Windows/Linux: 窗口坐标返回的是物理像素，可以和rev鼠标直接计算，然后除以缩放因子
          const osType = await type();
          console.log('OS Type:', osType);

          let windowX = 0;
          let windowY = 0;

          switch (osType) {
            case 'macos':
              windowX = Math.round(event.payload.x - outerPosition.x / scaleFactor);
              windowY = Math.round(event.payload.y - outerPosition.y / scaleFactor);
              break;
            case 'linux':
              windowX = Math.round((event.payload.x - innerPosition.x) / scaleFactor);
              windowY = Math.round((event.payload.y - innerPosition.y) / scaleFactor);
              break;
            default:
              console.log('Scale factor:', scaleFactor);
              // Windows and others
              windowX = Math.round((event.payload.x - innerPosition.x) / scaleFactor);
              windowY = Math.round((event.payload.y - innerPosition.y) / scaleFactor);
              break;
          }

          console.log('Converted coordinates:', { windowX, windowY });

          // 构造并分发鼠标事件到 WebView
          const mouseEvent = new MouseEvent('click', {
            clientX: windowX,
            clientY: windowY,
            bubbles: true,
            cancelable: true,
          });
          document.elementFromPoint(windowX, windowY)?.dispatchEvent(mouseEvent);

        } catch (error) {
          console.error('Error handling mouse-click event:', error);
        }
      });

      if (!keyboardSettings.enableKeyboardEcho) {
        setKeyboardPanel(prev => ({ ...prev, modifierKeys: [], keys: [] }));
        return [unlistenMouseDown];
      }

      // 监听键盘按下事件
      const unlistenKeyPress = await appWindow.listen<{ key: string }>('key-press', async (event) => {
        console.log(keyboardSettings.enableKeyboardEcho)
        console.log('key-press event received:', event);
        const isFocused = await appWindow.isFocused();
        if (isFocused) {
          return;
        }

        if (IGNORE_KEY_LIST.includes(event.payload.key)) {
          return;
        }

        if (event.payload.key.includes('Unknown')) {
          return;
        }

        if (!keyboardSettings.enableClickEcho && MOUSE_CLICK_KEYS.includes(event.payload.key)) {
          return;
        }

        // 这里可以根据需要处理键盘事件
        if (MODIFIER_KEY_LIST.includes(event.payload.key)) {
          const keyName = await KeyLabel(event.payload.key);

          setKeyboardPanel(prev => {
            if (!prev.modifierKeys.includes(keyName)) {
              return { ...prev, modifierKeys: [...prev.modifierKeys, keyName] };
            }
            return prev;
          });
        } else {
          const keyName = await KeyLabel(event.payload.key);
          setKeyboardPanel(prev => {
            if (!prev.keys.includes(keyName)) {
              return { ...prev, keys: [...prev.keys, keyName] };
            }
            return prev;
          });
        }
      });

      // 监听键盘释放事件
      const unlistenKeyRelease = await appWindow.listen<{ key: string }>('key-release', async (event) => {
        console.log('key-release event received:', event);
        // 这里可以根据需要处理键盘释放事件

        if (MODIFIER_KEY_LIST.includes(event.payload.key)) {
          const keyName = await KeyLabel(event.payload.key);
          setKeyboardPanel(prev => ({ ...prev, modifierKeys: prev.modifierKeys.filter(k => k !== keyName) }));
        } else {
          const keyName = await KeyLabel(event.payload.key);
          setKeyboardPanel(prev => ({ ...prev, keys: prev.keys.filter(k => k !== keyName) }));
        }
      });

      return [unlistenRefreshMonitors, unlistenMouseDown, unlistenKeyPress, unlistenKeyRelease];
    };

    const unlistenPromise = setupListener();

    // 组件卸载时清理
    return () => {
      unlistenPromise.then(unlisteners => {
        unlisteners.forEach(unlisten => unlisten());
      });
    };
  }, [ignoreCursorEvents, mouseSettings, keyboardSettings]);

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string }>({ open: false, message: '' });

  const [isScreenshotMode, setIsScreenshotMode] = useState(false);
  const [screenInfo, setScreenInfo] = useState<ScreenInfo | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const excalidrawAPIRef = useRef<any>(null);
  const ignoreCursorEventsRef = useRef(ignoreCursorEvents);
  ignoreCursorEventsRef.current = ignoreCursorEvents;

  const getDefaultSelection = useCallback((): Selection => {
    if (!screenInfo) {
        return { x: 0, y: 0, width: 1920, height: 1080 };
    }
    const primaryScreen = screenInfo.screens.find(s => s.is_primary) || screenInfo.screens[0];
    return {
        x: primaryScreen.x,
        y: primaryScreen.y,
        width: primaryScreen.width,
        height: primaryScreen.height,
    };
  }, [screenInfo]);

  // 监听全局快捷键触发的工具栏可见性切换事件
  useEffect(() => {
    const setupListener = async () => {
      const appWindow = getCurrentWindow();
      const unlisten = await appWindow.listen('toolbar-visibility-toggled', () => {
        const api = excalidrawAPIRef.current;
        if (!api) return;
        const currentState = api.getAppState();
        const newVisible = !currentState.toolbarVisible;
        api.updateScene({ appState: { toolbarVisible: newVisible } });
        setSnackbar({
          open: true,
          message: newVisible
            ? i18n.t('drawing.messages.toolbarShown', { shortcut: drawingSettings.toolbarShortcut })
            : i18n.t('drawing.messages.toolbarHidden', { shortcut: drawingSettings.toolbarShortcut }),
        });
      });
      return unlisten;
    };
    const unlistenPromise = setupListener();
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, [drawingSettings.toolbarShortcut]);

  useEffect(() => {
    const loadScreenInfo = async () => {
        try {
            const info = await invoke<ScreenInfo>('get_screen_info');
            setScreenInfo(info);
        } catch (error) {
            console.error('Failed to get screen info:', error);
        }
    };
    loadScreenInfo();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isScreenshotMode) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      if (e.key === 'Escape') {
          setIsScreenshotMode(false);
      } else if (e.key === 'Enter') {
          handleCapture();
      }
    };

    const handleScreenshotTrigger = async () => {
      if (!screenInfo) {
        const info = await invoke<ScreenInfo>('get_screen_info');
        setScreenInfo(info);
        setSelection(getDefaultSelection());
      } else {
        setSelection(getDefaultSelection());
      }
      setIsScreenshotMode(true);
      setSnackbar({ open: true, message: i18n.t('drawing.messages.screenshotStarted') });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('screenshot-trigger', handleScreenshotTrigger);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('screenshot-trigger', handleScreenshotTrigger);
    };
  }, [isScreenshotMode, screenInfo]);

  useEffect(() => {
    const updateWindowSettings = async () => {
        const appWindow = await getCurrentWindow();
        const api = excalidrawAPIRef.current;
        
        if (isScreenshotMode) {
            await appWindow.setFocusable(true);
            await appWindow.setIgnoreCursorEvents(false);
            await appWindow.setFocus();
            
            if (api) {
                api.updateScene({ appState: { toolbarVisible: false } });
            }
        } else {
            await appWindow.setFocusable(ignoreCursorEvents === false);
            await appWindow.setIgnoreCursorEvents(ignoreCursorEvents);
            
            if (api) {
                api.updateScene({ appState: { toolbarVisible: true } });
            }
        }
    };
    
    updateWindowSettings();
  }, [isScreenshotMode, ignoreCursorEvents]);

  useEffect(() => {
    if (!isScreenshotMode) return;
    
    const canvas = canvasRef.current;
    if (!canvas || !selection) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);

    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, width, height);

    ctx.clearRect(selection.x, selection.y, selection.width, selection.height);

    const COLOR = '#4ecdc4';
    const BORDER_WIDTH = 2;
    
    ctx.strokeStyle = COLOR;
    ctx.lineWidth = BORDER_WIDTH;
    
    if (isFlashing) {
        ctx.shadowColor = COLOR;
        ctx.shadowBlur = 20;
    }
    
    ctx.strokeRect(
        selection.x + BORDER_WIDTH / 2,
        selection.y + BORDER_WIDTH / 2,
        selection.width - BORDER_WIDTH,
        selection.height - BORDER_WIDTH
    );
    
    ctx.shadowBlur = 0;

    const cornerSize = 12;
    ctx.fillStyle = COLOR;
    
    ctx.fillRect(selection.x - cornerSize / 2, selection.y - cornerSize / 2, cornerSize, cornerSize);
    ctx.fillRect(selection.x + selection.width - cornerSize / 2, selection.y - cornerSize / 2, cornerSize, cornerSize);
    ctx.fillRect(selection.x - cornerSize / 2, selection.y + selection.height - cornerSize / 2, cornerSize, cornerSize);
    ctx.fillRect(selection.x + selection.width - cornerSize / 2, selection.y + selection.height - cornerSize / 2, cornerSize, cornerSize);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    const sizeText = `${selection.width} × ${selection.height}`;
    const textX = selection.x + 8;
    const textY = selection.y + 8;
    
    const metrics = ctx.measureText(sizeText);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(textX - 4, textY - 4, metrics.width + 8, 24);
    
    ctx.fillStyle = '#ffffff';
    ctx.fillText(sizeText, textX, textY);
  }, [isScreenshotMode, selection, isFlashing]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isScreenshotMode || e.button !== 0) return;
    
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsDragging(true);
    setDragStart({ x, y });
    setSelection({ x, y, width: 0, height: 0 });
  }, [isScreenshotMode]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isScreenshotMode || !isDragging || !dragStart) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const width = Math.abs(x - dragStart.x);
    const height = Math.abs(y - dragStart.y);
    const MIN_SIZE = 10;
    
    if (width >= MIN_SIZE && height >= MIN_SIZE) {
        setSelection({
            x: Math.min(x, dragStart.x),
            y: Math.min(y, dragStart.y),
            width,
            height,
        });
    }
  }, [isScreenshotMode, isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    if (!isScreenshotMode || !isDragging) return;
    setIsDragging(false);
    setDragStart(null);

    const MIN_SIZE = 10;
    if (selection && selection.width >= MIN_SIZE && selection.height >= MIN_SIZE) {
        handleCapture();
    }
  }, [isScreenshotMode, isDragging, selection]);

  const handleCapture = useCallback(async () => {
    if (!selection) return;

    try {
        setIsCapturing(true);
        
        await new Promise(resolve => setTimeout(resolve, 50));

        const appWindow = await getCurrentWindow();
        const windowPosition = await appWindow.innerPosition();
        const scaleFactor = await appWindow.scaleFactor();
        
        const physicalX = Math.round(selection.x * scaleFactor + windowPosition.x);
        const physicalY = Math.round(selection.y * scaleFactor + windowPosition.y);
        const physicalWidth = Math.round(selection.width * scaleFactor);
        const physicalHeight = Math.round(selection.height * scaleFactor);

        console.log(`Window position: (${windowPosition.x}, ${windowPosition.y})`);
        console.log(`Scale factor: ${scaleFactor}`);
        console.log(`Selection (logical): (${selection.x}, ${selection.y}) ${selection.width}×${selection.height}`);
        console.log(`Capture (physical): (${physicalX}, ${physicalY}) ${physicalWidth}×${physicalHeight}`);

        await invoke('capture_and_copy_to_clipboard', {
            x: physicalX,
            y: physicalY,
            width: physicalWidth,
            height: physicalHeight,
        });

        setIsCapturing(false);
        setIsFlashing(true);
        setTimeout(() => setIsFlashing(false), 200);
        
        setSnackbar({ open: true, message: '截图已复制到剪贴板' });
        setIsScreenshotMode(false);

    } catch (error) {
        setIsCapturing(false);
        console.error('Capture failed:', error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log('Full error:', error);
        setSnackbar({ open: true, message: `截图失败: ${errorMsg}` });
        setIsScreenshotMode(false);
    }
  }, [selection]);

  return (
    <>
      <Snackbar
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        open={snackbar.open}
        autoHideDuration={1500}
        onClose={() => setSnackbar({ open: false, message: '' })}
        message={snackbar.message}
        slots={{ transition: Zoom }}
      >
        <Alert
          onClose={() => setSnackbar({ open: false, message: '' })}
          severity="info"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

      

      <div
        style={{
          width: '100vw',
          display: 'flex',
          justifyContent: 'center',
          position: 'absolute',
          fontFamily: 'Fira Code',
          bottom: '5rem',
          right: '2rem',
          transition: 'opacity 0.5s',
          pointerEvents: 'none',
          zIndex: 999999
        }}>

        {/* 键盘按键信息显示区域 */}
        <div
          style={{
            padding: '0.5rem 1rem',
            color: keyboardSettings.fgColor || 'rgba(190,255,255,1.0)',
            borderRadius: '0.5rem',
            backgroundColor: keyboardSettings.bgColor || 'rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.2rem',
            transform: `translate(${keyboardPanel.offsetX}em, ${-keyboardPanel.offsetY}em) scale(${keyboardPanel.scale || 1.0})`,
            opacity: keyboardPanel.modifierKeys.length > 0 || keyboardPanel.keys.length > 0 ? 1 : 0.0,
          }}>

          <div
            style={{
              fontFamily: 'Fira Code',
              fontSize: '3rem', 
              fontWeight: 'bold'
            }}>
            {keyboardPanel.modifierKeys.length > 0 || keyboardPanel.keys.length > 0 ? `[ ${[...keyboardPanel.modifierKeys, ...keyboardPanel.keys].join('+')} ]` : ''}
          </div>

        </div>
      </div>

      <main style={{
        height: '100vh',
        display: 'block',
        background: 'transparent',
        opacity: ignoreCursorEvents ? 0.0 : 1,
        position: 'relative',
      }}>
        {/* 遮罩层：阻止 ignoreCursorEvents 时的事件穿透到 Excalidraw */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: ignoreCursorEvents ? 'auto' : 'none',
          zIndex: 999999,
        }} />

        {<Excalidraw
          excalidrawAPI={(api: any) => {
            excalidrawAPIRef.current = api;
          }}
          langCode={
            locale === 'zh-CN' ? 'zh-CN' :
            locale === 'ja-JP' ? 'ja-JP' :
            locale === 'ko-KR' ? 'ko-KR' :
            locale === 'fr-FR' ? 'fr-FR' :
            locale === 'de-DE' ? 'de-DE' :
            locale === 'es-ES' ? 'es-ES' :
            'en'
          }
          autoFocus={true}
          initialData={{
            elements: [

            ],
            appState: {
              currentItemStrokeColor: 'red',
              currentItemRoundness: "sharp",
              viewBackgroundColor: "transparent",
              toolbarVisible: true,
              activeTool: {
                type: "freedraw",
                locked: true
              }
            }
          }}
          UIOptions={{
            canvasActions: {
              'export': false,
              'saveAsImage': false,
            }
          }}
        />}
      </main>

      {isScreenshotMode && screenInfo && (
        <div
          ref={containerRef}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 999999,
            cursor: isDragging ? 'crosshair' : 'default',
            pointerEvents: isCapturing ? 'none' : 'auto',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {!isCapturing && (
            <>
              <canvas
                ref={canvasRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                }}
              />

              <div
                style={{
                  position: 'absolute',
                  bottom: 32,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  padding: '12px 24px',
                  backgroundColor: 'rgba(0, 0, 0, 0.6)',
                  color: '#ffffff',
                  borderRadius: '8px',
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                }}
              >
                <span>拖动选择区域</span>
                <span style={{ opacity: 0.5 }}>·</span>
                <span>Enter 确认</span>
                <span style={{ opacity: 0.5 }}>·</span>
                <span>Esc 退出</span>
              </div>

              <button
                onClick={() => setIsScreenshotMode(false)}
                style={{
                  position: 'absolute',
                  top: 24,
                  right: 24,
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(0, 0, 0, 0.6)',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '20px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
                }}
              >
                ✕
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

export default App;
