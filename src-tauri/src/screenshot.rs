use screenshots::Screen;
use std::io::Cursor;
use tauri::State;
use base64::Engine;

#[tauri::command]
pub async fn capture_region(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    if width < 10 || height < 10 {
        return Err("选区尺寸过小（最小 10×10）".to_string());
    }

    let screens = Screen::all().map_err(|e| format!("获取屏幕列表失败: {}", e))?;

    if screens.is_empty() {
        return Err("未检测到显示器".to_string());
    }

    let target_screen = screens
        .iter()
        .find(|screen| {
            let info = &screen.display_info;
            x >= info.x
                && x < info.x + info.width as i32
                && y >= info.y
                && y < info.y + info.height as i32
        })
        .ok_or("坐标不在任何显示器范围内")?;

    let info = &target_screen.display_info;
    let local_x = x - info.x;
    let local_y = y - info.y;

    let image = target_screen
        .capture_area(local_x, local_y, width, height)
        .map_err(|e| format!("截图失败: {}", e))?;

    let mut png_data = Vec::new();
    let mut cursor = Cursor::new(&mut png_data);
    image
        .write_to(&mut cursor, screenshots::image::ImageOutputFormat::Png)
        .map_err(|e| format!("编码 PNG 失败: {}", e))?;

    Ok(png_data)
}

#[tauri::command]
pub async fn capture_and_copy_to_clipboard(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    clipboard: State<'_, tauri_plugin_clipboard::Clipboard>,
) -> Result<(), String> {
    if width < 10 || height < 10 {
        return Err("选区尺寸过小（最小 10×10）".to_string());
    }

    let screens = Screen::all().map_err(|e| format!("获取屏幕列表失败: {}", e))?;

    if screens.is_empty() {
        return Err("未检测到显示器".to_string());
    }

    let target_screen = screens
        .iter()
        .find(|screen| {
            let info = &screen.display_info;
            x >= info.x
                && x < info.x + info.width as i32
                && y >= info.y
                && y < info.y + info.height as i32
        })
        .ok_or("坐标不在任何显示器范围内")?;

    let info = &target_screen.display_info;
    let local_x = x - info.x;
    let local_y = y - info.y;

    let image = target_screen
        .capture_area(local_x, local_y, width, height)
        .map_err(|e| format!("截图失败: {}", e))?;

    let mut png_data = Vec::new();
    let mut cursor = Cursor::new(&mut png_data);
    image
        .write_to(&mut cursor, screenshots::image::ImageOutputFormat::Png)
        .map_err(|e| format!("编码 PNG 失败: {}", e))?;

    let png_base64 = base64::engine::general_purpose::STANDARD.encode(&png_data);
    clipboard.write_image_base64(png_base64).map_err(|e| format!("复制到剪贴板失败: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn copy_png_to_clipboard(
    png_data: Vec<u8>,
    clipboard: State<'_, tauri_plugin_clipboard::Clipboard>,
) -> Result<String, String> {
    if png_data.is_empty() {
        return Err("PNG 数据为空".to_string());
    }

    let png_base64 = base64::engine::general_purpose::STANDARD.encode(&png_data);
    clipboard.write_image_base64(png_base64).map_err(|e| format!("复制到剪贴板失败: {}", e))?;

    Ok("success".to_string())
}

#[tauri::command]
pub async fn get_screen_info() -> Result<serde_json::Value, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕列表失败: {}", e))?;

    let screen_info: Vec<serde_json::Value> = screens
        .iter()
        .enumerate()
        .map(|(i, screen)| {
            let info = &screen.display_info;
            serde_json::json!({
                "index": i,
                "width": info.width,
                "height": info.height,
                "x": info.x,
                "y": info.y,
                "is_primary": i == 0,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "screens": screen_info,
        "total_width": screens.iter().map(|s| s.display_info.width).sum::<u32>(),
        "total_height": screens.iter().map(|s| s.display_info.height).max().unwrap_or(0),
    }))
}