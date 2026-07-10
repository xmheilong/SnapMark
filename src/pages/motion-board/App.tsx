/**
 * MIT License
 * 
 * Copyright (c) 2026 xmheilong
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
import { getSettings, updateSettings } from "../../store/settings";
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

/**
 * 应用模式枚举
 * - idle: 鼠标穿透模式（空闲状态，不接收鼠标事件）
 * - draw: 绘图模式（Excalidraw 接管，可画标注，支持单选多选和删除）
 * - screenshot: 截图模式（独立选区覆盖层，不加入 Excalidraw 场景）
 */
type AppMode = 'idle' | 'draw' | 'screenshot';

function App() {
  // 从 store 加载鼠标设置
  const { mouseSettings, } = useMouseSettings();

  const { keyboardSettings, } = useKeyboardSettings();
  const { drawingSettings, } = useDrawingSettings();

  // 应用模式（idle/draw/screenshot 三态互斥）
  const [appMode, setAppMode] = useState<AppMode>('idle');
  // 派生值：鼠标穿透 = idle 模式
  const ignoreCursorEvents = appMode === 'idle';

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
        const currentMode = appModeRef.current;
        console.log(`[${label}] 收到 toggle-cursor-events 事件, 当前模式: ${currentMode}`);

        if (currentMode !== 'idle') {
          // 从任何非 idle 模式切换到 idle
          setAppMode('idle');
          setKeyboardPanel(prev => ({ ...prev, modifierKeys: [], keys: [] }));
          await appWindow.setFocusable(false);
          await appWindow.hide();
          await appWindow.show();
          await appWindow.setIgnoreCursorEvents(true);
        } else {
          // 从 idle 切换到绘图模式（默认进入绘图）
          setAppMode('draw');
          setSnackbar({ open: true, message: '进入绘制模式' });
          setKeyboardPanel(prev => ({ ...prev, modifierKeys: [], keys: [] }));
          await appWindow.setFocusable(true);
          await appWindow.setIgnoreCursorEvents(false);
          await appWindow.setFocus();
        }
      });
      return unlisten;
    };

    const unlistenPromise = setupListener();
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, [appMode]);

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

        // Escape 键退出当前模式
        if (event.payload.key === 'Escape' && appModeRef.current !== 'idle') {
          if (appModeRef.current === 'screenshot') {
            setAppMode('draw');
          } else {
            setAppMode('idle');
            await appWindow.setFocusable(false);
            await appWindow.hide();
            await appWindow.show();
            await appWindow.setIgnoreCursorEvents(true);
          }
          setKeyboardPanel(prev => ({ ...prev, modifierKeys: [], keys: [] }));
          return;
        }

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
  }, [appMode, mouseSettings, keyboardSettings]);

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string }>({ open: false, message: '' });

  // 派生值：截图模式
  const isScreenshotMode = appMode === 'screenshot';
  const [screenInfo, setScreenInfo] = useState<ScreenInfo | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [autoEraseEnabled, setAutoEraseEnabled] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 截图形状类型
  type ScreenshotShape = 'rectangle' | 'circle' | 'freehand';
  const [screenshotShape, setScreenshotShape] = useState<ScreenshotShape>('rectangle');
  // 圆形选区状态
  const [circleCenter, setCircleCenter] = useState<{ x: number; y: number } | null>(null);
  const [circleRadius, setCircleRadius] = useState(0);
  // 套索选区状态
  const [freehandPoints, setFreehandPoints] = useState<Array<{ x: number; y: number }>>([]);

  const excalidrawAPIRef = useRef<any>(null);
  const autoEraseTimerRef = useRef<number | null>(null);
  const appModeRef = useRef(appMode);
  appModeRef.current = appMode;

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
          setAppMode('draw');
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
      setAppMode('screenshot');
      setSnackbar({ open: true, message: i18n.t('drawing.messages.screenshotStarted') });
    };

    const handleAutoEraseToggle = () => {
      const newState = !autoEraseEnabled;
      setAutoEraseEnabled(newState);
      
      const api = excalidrawAPIRef.current;
      if (api) {
        api.updateScene({ appState: { autoEraseEnabled: newState } });
      }
      
      if (newState) {
        setSnackbar({ open: true, message: '自动擦除已开启（3秒后自动清除）' });
      } else {
        setSnackbar({ open: true, message: '自动擦除已关闭' });
        if (autoEraseTimerRef.current) {
          clearTimeout(autoEraseTimerRef.current);
          autoEraseTimerRef.current = null;
        }
      }
    };

    /**
     * 处理来自 LayerUI 分段控件的模式切换
     */
    const handleModeChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.mode) {
        setAppMode(detail.mode);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('screenshot-trigger', handleScreenshotTrigger);
    window.addEventListener('auto-erase-toggle', handleAutoEraseToggle);
    window.addEventListener('mode-change', handleModeChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('screenshot-trigger', handleScreenshotTrigger);
      window.removeEventListener('auto-erase-toggle', handleAutoEraseToggle);
      window.removeEventListener('mode-change', handleModeChange);
      if (autoEraseTimerRef.current) {
        clearTimeout(autoEraseTimerRef.current);
      }
    };
  }, [appMode, screenInfo, autoEraseEnabled]);

  const handleExcalidrawChange = useCallback(() => {
    if (!autoEraseEnabled) return;

    const api = excalidrawAPIRef.current;
    if (!api) return;

    const elements = api.getSceneElements();
    const nonDeletedElements = elements.filter((el: any) => !el.isDeleted);
    
    if (nonDeletedElements.length > 0) {
      if (autoEraseTimerRef.current) {
        clearTimeout(autoEraseTimerRef.current);
      }
      autoEraseTimerRef.current = window.setTimeout(() => {
        api.updateScene({
          elements: nonDeletedElements.map((el: any) => ({ ...el, isDeleted: true })),
        });
        autoEraseTimerRef.current = null;
      }, 3000);
    }
  }, [autoEraseEnabled]);

  useEffect(() => {
    const updateWindowSettings = async () => {
        const appWindow = await getCurrentWindow();
        const api = excalidrawAPIRef.current;
        
        if (isScreenshotMode) {
            await appWindow.setFocusable(true);
            await appWindow.setIgnoreCursorEvents(false);
            await appWindow.setFocus();
            
            if (api) {
                api.updateScene({ appState: { toolbarVisible: true } });
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

    // 通知 LayerUI 同步工具栏模式（Escape / Alt+` 触发时）
    if (appMode !== 'idle') {
      window.dispatchEvent(new CustomEvent('mode-updated', { detail: { mode: appMode } }));
    }
  }, [appMode]);

  useEffect(() => {
    if (!isScreenshotMode) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

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

    const COLOR = '#4ecdc4';
    const BORDER_WIDTH = 2;
    
    ctx.strokeStyle = COLOR;
    ctx.lineWidth = BORDER_WIDTH;
    
    if (isFlashing) {
        ctx.shadowColor = COLOR;
        ctx.shadowBlur = 20;
    }

    if (screenshotShape === 'rectangle' && selection) {
      ctx.clearRect(selection.x, selection.y, selection.width, selection.height);
      
      ctx.strokeRect(
          selection.x + BORDER_WIDTH / 2,
          selection.y + BORDER_WIDTH / 2,
          selection.width - BORDER_WIDTH,
          selection.height - BORDER_WIDTH
      );
      
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
    } else if (screenshotShape === 'circle' && circleCenter && circleRadius > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(circleCenter.x, circleCenter.y, circleRadius, 0, Math.PI * 2);
      ctx.clip();
      ctx.clearRect(0, 0, width, height);
      ctx.restore();
      
      ctx.beginPath();
      ctx.arc(circleCenter.x, circleCenter.y, circleRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      
      const sizeText = `${Math.round(circleRadius * 2)} × ${Math.round(circleRadius * 2)}`;
      const textX = circleCenter.x - circleRadius + 8;
      const textY = circleCenter.y - circleRadius + 8;
      
      const metrics = ctx.measureText(sizeText);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(textX - 4, textY - 4, metrics.width + 8, 24);
      
      ctx.fillStyle = '#ffffff';
      ctx.fillText(sizeText, textX, textY);
    } else if (screenshotShape === 'freehand' && freehandPoints.length > 1) {
      ctx.beginPath();
      ctx.moveTo(freehandPoints[0].x, freehandPoints[0].y);
      for (let i = 1; i < freehandPoints.length; i++) {
        ctx.lineTo(freehandPoints[i].x, freehandPoints[i].y);
      }
      ctx.closePath();
      ctx.clip();
      ctx.clearRect(0, 0, width, height);
      ctx.restore();
      
      ctx.beginPath();
      ctx.moveTo(freehandPoints[0].x, freehandPoints[0].y);
      for (let i = 1; i < freehandPoints.length; i++) {
        ctx.lineTo(freehandPoints[i].x, freehandPoints[i].y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    
    ctx.shadowBlur = 0;
  }, [appMode, selection, isFlashing, screenshotShape, circleCenter, circleRadius, freehandPoints]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isScreenshotMode || e.button !== 0) return;
    
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsDragging(true);
    setDragStart({ x, y });

    const api = excalidrawAPIRef.current;
    if (api) {
      api.updateScene({ appState: { toolbarVisible: false } });
    }

    if (screenshotShape === 'rectangle') {
      setSelection({ x, y, width: 0, height: 0 });
    } else if (screenshotShape === 'circle') {
      setCircleCenter({ x, y });
      setCircleRadius(0);
    } else if (screenshotShape === 'freehand') {
      setFreehandPoints([{ x, y }]);
    }
  }, [appMode, screenshotShape]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isScreenshotMode || !isDragging || !dragStart) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const clampX = Math.max(0, Math.min(x, rect.width));
    const clampY = Math.max(0, Math.min(y, rect.height));

    if (screenshotShape === 'rectangle') {
      const width = Math.abs(clampX - dragStart.x);
      const height = Math.abs(clampY - dragStart.y);
      const MIN_SIZE = 10;
      
      if (width >= MIN_SIZE && height >= MIN_SIZE) {
          setSelection({
              x: Math.min(clampX, dragStart.x),
              y: Math.min(clampY, dragStart.y),
              width,
              height,
          });
      }
    } else if (screenshotShape === 'circle') {
      if (circleCenter) {
        const dx = x - circleCenter.x;
        const dy = y - circleCenter.y;
        const rawRadius = Math.sqrt(dx * dx + dy * dy);
        
        const maxRadius = Math.min(
          circleCenter.x,
          circleCenter.y,
          rect.width - circleCenter.x,
          rect.height - circleCenter.y
        );
        
        const radius = Math.min(rawRadius, maxRadius);
        
        if (radius >= 10) {
          setCircleRadius(radius);
        }
      }
    } else if (screenshotShape === 'freehand') {
      setFreehandPoints(prev => [...prev, { x: clampX, y: clampY }]);
    }
  }, [appMode, isDragging, dragStart, screenshotShape, circleCenter]);

  const handleMouseUp = useCallback(() => {
    if (!isScreenshotMode || !isDragging) return;
    setIsDragging(false);
    setDragStart(null);

    const MIN_SIZE = 10;
    if (screenshotShape === 'rectangle' && selection && selection.width >= MIN_SIZE && selection.height >= MIN_SIZE) {
        handleCapture();
    } else if (screenshotShape === 'circle' && circleRadius >= MIN_SIZE) {
        handleCapture();
    } else if (screenshotShape === 'freehand' && freehandPoints.length > 5) {
        handleCapture();
    }
  }, [appMode, isDragging, selection, screenshotShape, circleRadius, freehandPoints]);

  const handleMouseUpRef = useRef(handleMouseUp);
  handleMouseUpRef.current = handleMouseUp;

  const handleMouseLeave = useCallback(() => {
    if (!isScreenshotMode || !isDragging) return;
    // 鼠标离开窗口时不取消拖动——选区冻结在屏幕边缘
    // 用户松手时通过 window mouseup 监听器触发截图
  }, [isScreenshotMode, isDragging]);

  // 当 isDragging 为 true 时，监听 window 级 mouseup 事件
  // 确保鼠标离开窗口后在扩展屏侧松手也能触发截图
  useEffect(() => {
    if (!isDragging) return;
    const onWindowMouseUp = () => {
      handleMouseUpRef.current();
    };
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => window.removeEventListener('mouseup', onWindowMouseUp);
  }, [isDragging]);

  const getBoundingRect = useCallback(() => {
    if (screenshotShape === 'rectangle' && selection) {
      return selection;
    } else if (screenshotShape === 'circle' && circleCenter && circleRadius > 0) {
      return {
        x: circleCenter.x - circleRadius,
        y: circleCenter.y - circleRadius,
        width: circleRadius * 2,
        height: circleRadius * 2,
      };
    } else if (screenshotShape === 'freehand' && freehandPoints.length > 1) {
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      freehandPoints.forEach(point => {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      });
      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    }
    return null;
  }, [screenshotShape, selection, circleCenter, circleRadius, freehandPoints]);

  const handleCapture = useCallback(async () => {
    const boundingRect = getBoundingRect();
    if (!boundingRect) return;

    // 保存鼠标光圈设置并关闭，避免光圈被截入截图
    const settings = await getSettings();
    const prevApertureEnabled = settings.mouse.enableAperture;
    if (prevApertureEnabled) {
        await updateSettings({ mouse: { ...settings.mouse, enableAperture: false } });
    }

    // 隐藏鼠标点击特效元素（带 .no-pointer 类的 mojs 动画），
    // 避免它们被截入截图画面
    const noPointerEls = document.querySelectorAll('.no-pointer') as NodeListOf<HTMLElement>;
    const prevDisplays: string[] = [];
    noPointerEls.forEach((el, i) => {
        prevDisplays[i] = el.style.display;
        el.style.display = 'none';
    });

    // 隐藏系统鼠标光标，避免截图中包含光标
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'none';

    try {
        setIsCapturing(true);
        
        await new Promise(resolve => setTimeout(resolve, 50));

        const appWindow = await getCurrentWindow();
        const windowPosition = await appWindow.innerPosition();
        const scaleFactor = await appWindow.scaleFactor();
        
        const physicalX = Math.round(boundingRect.x * scaleFactor + windowPosition.x);
        const physicalY = Math.round(boundingRect.y * scaleFactor + windowPosition.y);
        const physicalWidth = Math.round(boundingRect.width * scaleFactor);
        const physicalHeight = Math.round(boundingRect.height * scaleFactor);

        console.log(`Window position: (${windowPosition.x}, ${windowPosition.y})`);
        console.log(`Scale factor: ${scaleFactor}`);
        console.log(`Selection (logical): (${boundingRect.x}, ${boundingRect.y}) ${boundingRect.width}×${boundingRect.height}`);
        console.log(`Capture (physical): (${physicalX}, ${physicalY}) ${physicalWidth}×${physicalHeight}`);

        const pngData = await invoke<number[]>('capture_region', {
            x: physicalX,
            y: physicalY,
            width: physicalWidth,
            height: physicalHeight,
        });

        if (!pngData || pngData.length === 0) {
            throw new Error('未能获取截图数据');
        }

        const uint8Array = new Uint8Array(pngData);
        const blob = new Blob([uint8Array], { type: 'image/png' });

        if (screenshotShape === 'rectangle') {
            try {
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);
            } catch {
                await invoke('capture_and_copy_to_clipboard', {
                    x: physicalX,
                    y: physicalY,
                    width: physicalWidth,
                    height: physicalHeight,
                });
            }

            setIsCapturing(false);
            setIsFlashing(true);
            setTimeout(() => setIsFlashing(false), 200);
            
            setSnackbar({ open: true, message: '截图已复制到剪贴板' });
            setAppMode('draw');
            
            setTimeout(() => {
                const api = excalidrawAPIRef.current;
                if (api) {
                    api.updateScene({ appState: { toolbarVisible: true } });
                }
            }, 100);
        } else {
            const url = URL.createObjectURL(blob);
            
            const img = new Image();
            img.onload = async () => {
                URL.revokeObjectURL(url);
                
                const cropCanvas = document.createElement('canvas');
                cropCanvas.width = boundingRect.width;
                cropCanvas.height = boundingRect.height;
                const cropCtx = cropCanvas.getContext('2d');
                if (!cropCtx) {
                    throw new Error('无法创建 Canvas 上下文');
                }

                cropCtx.save();

                if (screenshotShape === 'circle' && circleCenter) {
                    const centerX = circleRadius;
                    const centerY = circleRadius;
                    cropCtx.beginPath();
                    cropCtx.arc(centerX, centerY, circleRadius, 0, Math.PI * 2);
                    cropCtx.clip();
                } else if (screenshotShape === 'freehand' && freehandPoints.length > 1) {
                    cropCtx.beginPath();
                    cropCtx.moveTo(freehandPoints[0].x - boundingRect.x, freehandPoints[0].y - boundingRect.y);
                    for (let i = 1; i < freehandPoints.length; i++) {
                        cropCtx.lineTo(freehandPoints[i].x - boundingRect.x, freehandPoints[i].y - boundingRect.y);
                    }
                    cropCtx.closePath();
                    cropCtx.clip();
                }

                cropCtx.drawImage(img, 0, 0, boundingRect.width, boundingRect.height);
                cropCtx.restore();

                cropCanvas.toBlob(async (cropBlob) => {
                    if (!cropBlob) {
                        throw new Error('无法生成裁剪后的图片');
                    }

                    try {
                        await navigator.clipboard.write([
                            new ClipboardItem({ 'image/png': cropBlob })
                        ]);
                    } catch {
                        const arrayBuffer = await cropBlob.arrayBuffer();
                        const cropUint8Array = new Uint8Array(arrayBuffer);
                        await invoke<string>('copy_png_to_clipboard', {
                            pngData: Array.from(cropUint8Array),
                        });
                    }

                    setIsCapturing(false);
                    setIsFlashing(true);
                    setTimeout(() => setIsFlashing(false), 200);
                    
                    setSnackbar({ open: true, message: '截图已复制到剪贴板' });
                    setAppMode('draw');
                    
                    setTimeout(() => {
                        const api = excalidrawAPIRef.current;
                        if (api) {
                            api.updateScene({ appState: { toolbarVisible: true } });
                        }
                    }, 100);
                }, 'image/png');
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                invoke('capture_and_copy_to_clipboard', {
                    x: physicalX,
                    y: physicalY,
                    width: physicalWidth,
                    height: physicalHeight,
                }).then(() => {
                    setIsCapturing(false);
                    setIsFlashing(true);
                    setTimeout(() => setIsFlashing(false), 200);
                    
                    setSnackbar({ open: true, message: '截图已复制到剪贴板' });
                    setAppMode('draw');
                    
                    setTimeout(() => {
                        const api = excalidrawAPIRef.current;
                        if (api) {
                            api.updateScene({ appState: { toolbarVisible: true } });
                        }
                    }, 100);
                });
            };
            img.src = url;
        }

    } catch (error) {
        setIsCapturing(false);
        console.error('Capture failed:', error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log('Full error:', error);
        setSnackbar({ open: true, message: `截图失败: ${errorMsg}` });
        setAppMode('draw');
    } finally {
        // 恢复鼠标点击特效元素的显示状态
        noPointerEls.forEach((el, i) => {
            el.style.display = prevDisplays[i] || '';
        });
        // 恢复系统鼠标光标
        document.body.style.cursor = prevCursor;
        // 恢复鼠标光圈设置
        if (prevApertureEnabled) {
            await updateSettings({ mouse: { ...settings.mouse, enableAperture: true } });
        }
    }
  }, [getBoundingRect, screenshotShape, circleCenter, circleRadius, freehandPoints]);

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
          zIndex: 10,
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
          onChange={handleExcalidrawChange}
          autoFocus={true}
          initialData={{
            elements: [

            ],
            appState: {
              currentItemStrokeColor: 'red',
              currentItemRoundness: "sharp",
              viewBackgroundColor: "transparent",
              toolbarVisible: true,
              autoEraseEnabled: false,
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
            zIndex: 1000,
            cursor: isDragging ? 'crosshair' : 'default',
            pointerEvents: isCapturing ? 'none' : 'auto',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
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
                  top: 24,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  padding: '8px',
                  backgroundColor: 'rgba(0, 0, 0, 0.6)',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <button
                  onClick={() => {
                    setScreenshotShape('rectangle');
                    setSelection(null);
                    setCircleCenter(null);
                    setCircleRadius(0);
                    setFreehandPoints([]);
                  }}
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '6px',
                    backgroundColor: screenshotShape === 'rectangle' ? 'rgba(78, 205, 196, 0.8)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background-color 0.2s',
                  }}
                  title="矩形截图"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff">
                    <path d="M3 3h18v18H3V3zm2 2v14h14V5H5z"/>
                  </svg>
                </button>
                <button
                  onClick={() => {
                    setScreenshotShape('circle');
                    setSelection(null);
                    setCircleCenter(null);
                    setCircleRadius(0);
                    setFreehandPoints([]);
                  }}
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '6px',
                    backgroundColor: screenshotShape === 'circle' ? 'rgba(78, 205, 196, 0.8)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background-color 0.2s',
                  }}
                  title="圆形截图"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff">
                    <circle cx="12" cy="12" r="10"/>
                  </svg>
                </button>
                <button
                  onClick={() => {
                    setScreenshotShape('freehand');
                    setSelection(null);
                    setCircleCenter(null);
                    setCircleRadius(0);
                    setFreehandPoints([]);
                  }}
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '6px',
                    backgroundColor: screenshotShape === 'freehand' ? 'rgba(78, 205, 196, 0.8)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background-color 0.2s',
                  }}
                  title="套索截图"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff">
                    <path d="M12 2c-2 0-4 1-5 3L7 7c1-2 3-3 5-3s4 1 5 3l0 0c-1-2-3-3-5-3zm0 18c2 0 4-1 5-3l2 2c-1 2-3 3-5 3s-4-1-5-3l2-2c1 2 3 3 5 3zm-7-8c0-2 1-4 3-5l-2-2c-2 1-3 3-3 5s1 4 3 5l2-2c-2-1-3-3-3-5zm14 0c0-2-1-4-3-5l2-2c2 1 3 3 3 5s-1 4-3 5l-2-2c2-1 3-3 3-5z"/>
                  </svg>
                </button>
                <div style={{ width: '1px', height: '24px', backgroundColor: 'rgba(255,255,255,0.2)' }} />
                <span style={{ color: '#ffffff', fontSize: '13px' }}>
                  {screenshotShape === 'rectangle' && '拖动选择区域'}
                  {screenshotShape === 'circle' && '点击圆心拖动半径'}
                  {screenshotShape === 'freehand' && '自由绘制选区'}
                </span>
                <span style={{ opacity: 0.5 }}>·</span>
                <span style={{ color: '#ffffff', fontSize: '13px' }}>Enter 确认</span>
                <span style={{ opacity: 0.5 }}>·</span>
                <span style={{ color: '#ffffff', fontSize: '13px' }}>Esc 退出</span>
              </div>

              <button
                onClick={() => setAppMode('draw')}
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
