import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { useSnackbar } from '../contexts/SnackbarContext';
import { isScreenshotEnabled, setScreenshotEnabled } from '../store/screenshot';

export function ScreenshotToggle({ onChange }: { onChange?: (enabled: boolean) => void }) {
    const { t } = useTranslation();
    const { notify } = useSnackbar();
    const [enabled, setEnabled] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadState = async () => {
            try {
                const state = await isScreenshotEnabled();
                setEnabled(state);
            } catch (error) {
                console.error('Failed to load screenshot state:', error);
            } finally {
                setLoading(false);
            }
        };
        loadState();
    }, []);

    const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = event.target.checked;
        
        try {
            await setScreenshotEnabled(newValue);
            setEnabled(newValue);
            
            if (onChange) {
                onChange(newValue);
            }
            
            notify(
                newValue 
                    ? t('screenshot.messages.enabled') 
                    : t('screenshot.messages.disabled'),
                'success'
            );
        } catch (error) {
            console.error('Failed to save screenshot state:', error);
            notify(t('screenshot.messages.saveFailed'), 'error');
            setEnabled(!newValue);
        }
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography>{t('screenshot.loading')}</Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography>{t('screenshot.enable')}</Typography>
            <Switch
                checked={enabled}
                onChange={handleChange}
                color="primary"
            />
        </Box>
    );
}