import { useEffect, useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../contexts/SnackbarContext';

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

export function ScreenshotOverlay({ onExit }: { onExit: () => void }) {
    const { t } = useTranslation();
    const { notify } = useSnackbar();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    
    const [screenInfo, setScreenInfo] = useState<ScreenInfo | null>(null);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
    const [isFlashing, setIsFlashing] = useState(false);
    
    const COLOR = '#4ecdc4';
    const BORDER_WIDTH = 2;
    const MIN_SIZE = 10;

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

    useEffect(() => {
        const loadScreenInfo = async () => {
            try {
                const info = await invoke<ScreenInfo>('get_screen_info');
                setScreenInfo(info);
                setSelection(getDefaultSelection());
            } catch (error) {
                console.error('Failed to get screen info:', error);
                setSelection({ x: 0, y: 0, width: 1920, height: 1080 });
            }
        };
        loadScreenInfo();
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (isDragging && selection) {
                    setIsDragging(false);
                    setDragStart(null);
                    setSelection(getDefaultSelection());
                } else {
                    onExit();
                }
            } else if (e.key === 'Enter') {
                handleCapture();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isDragging, selection, onExit, getDefaultSelection]);

    useEffect(() => {
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
    }, [selection, isFlashing]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return;
        
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setIsDragging(true);
        setDragStart({ x, y });
        setSelection({ x, y, width: 0, height: 0 });
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging || !dragStart) return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const clampX = Math.max(0, Math.min(x, rect.width));
        const clampY = Math.max(0, Math.min(y, rect.height));

        const width = Math.abs(clampX - dragStart.x);
        const height = Math.abs(clampY - dragStart.y);
        
        if (width >= MIN_SIZE && height >= MIN_SIZE) {
            setSelection({
                x: Math.min(clampX, dragStart.x),
                y: Math.min(clampY, dragStart.y),
                width,
                height,
            });
        }
    }, [isDragging, dragStart]);

    const handleMouseUp = useCallback(() => {
        if (!isDragging) return;
        setIsDragging(false);
        setDragStart(null);

        if (selection && selection.width >= MIN_SIZE && selection.height >= MIN_SIZE) {
            handleCapture();
        } else if (selection) {
            setSelection(getDefaultSelection());
        }
    }, [isDragging, selection, getDefaultSelection]);

    const handleCapture = useCallback(async () => {
        if (!selection) return;

        try {
            const pngBytes = await invoke<Uint8Array>('capture_region', {
                x: selection.x,
                y: selection.y,
                width: selection.width,
                height: selection.height,
            });

            const blob = new Blob([pngBytes], { type: 'image/png' });
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob }),
            ]);

            setIsFlashing(true);
            setTimeout(() => setIsFlashing(false), 200);

        } catch (error) {
            console.error('Capture failed:', error);
            notify(t('screenshot.messages.captureFailed', { error: String(error) }), 'error');
            onExit();
        }
    }, [selection, t, notify, onExit]);

    const handleExitClick = useCallback(() => {
        onExit();
    }, [onExit]);

    if (!screenInfo) {
        return null;
    }

    return (
        <div
            ref={containerRef}
            className="screenshot-overlay"
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                zIndex: 99999,
                cursor: isDragging ? 'crosshair' : 'default',
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
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
                className="screenshot-hint"
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
                <span>{t('screenshot.hint.drag')}</span>
                <span style={{ opacity: 0.5 }}>·</span>
                <span>{t('screenshot.hint.enter')}</span>
                <span style={{ opacity: 0.5 }}>·</span>
                <span>{t('screenshot.hint.escape')}</span>
            </div>

            <button
                className="screenshot-exit-btn"
                onClick={handleExitClick}
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
        </div>
    );
}