import { Store } from '@tauri-apps/plugin-store';
import { emit } from '@tauri-apps/api/event';

let screenshotStore: Store | null = null;

const DEFAULT_ENABLED = false;

export const initScreenshotStore = async () => {
    if (!screenshotStore) {
        screenshotStore = await Store.load('settings.bin');
    }
    return screenshotStore;
};

export const isScreenshotEnabled = async (): Promise<boolean> => {
    const store = await initScreenshotStore();
    const enabled = await store.get<boolean>('screenshot_enabled');
    return enabled ?? DEFAULT_ENABLED;
};

export const setScreenshotEnabled = async (enabled: boolean): Promise<boolean> => {
    const store = await initScreenshotStore();
    await store.set('screenshot_enabled', enabled);
    await store.save();
    
    try {
        await emit('screenshot-enabled-changed', { enabled });
    } catch (error) {
        console.error('Failed to emit screenshot-enabled-changed event:', error);
    }
    
    return enabled;
};

export const toggleScreenshot = async (): Promise<boolean> => {
    const current = await isScreenshotEnabled();
    const newState = !current;
    await setScreenshotEnabled(newState);
    return newState;
};