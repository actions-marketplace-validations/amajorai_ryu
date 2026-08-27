use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

const MAX_KEY_BYTES: usize = 256;

#[derive(Debug, Clone, Deserialize)]
pub struct TimelineAppIconRequest {
    pub app_path: Option<String>,
    pub bundle_id: Option<String>,
    pub key: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TimelineAppIconResult {
    pub icon_url: Option<String>,
    pub key: String,
}

static ICON_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

fn icon_cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    ICON_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}

fn valid_key(key: &str) -> Option<String> {
    let trimmed = key.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_KEY_BYTES || trimmed.contains('\0') {
        return None;
    }
    Some(trimmed.to_string())
}

#[tauri::command]
pub fn resolve_timeline_app_icons(apps: Vec<TimelineAppIconRequest>) -> Vec<TimelineAppIconResult> {
    let mut seen = HashSet::new();
    let mut results = Vec::new();

    for app in apps {
        let Some(key) = valid_key(&app.key) else {
            continue;
        };
        if !seen.insert(key.clone()) {
            continue;
        }

        let icon_url = if let Ok(cache) = icon_cache().lock() {
            cache.get(&key).cloned()
        } else {
            None
        }
        .unwrap_or_else(|| {
            let icon_url = resolve_native(&app);
            if let Ok(mut cache) = icon_cache().lock() {
                cache.insert(key.clone(), icon_url.clone());
            }
            icon_url
        });

        results.push(TimelineAppIconResult { icon_url, key });
    }

    results
}

fn resolve_native(app: &TimelineAppIconRequest) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        return macos::resolve(app);
    }

    #[cfg(target_os = "windows")]
    {
        return windows::resolve(app);
    }

    #[cfg(target_os = "linux")]
    {
        return linux::resolve(app);
    }

    #[allow(unreachable_code)]
    None
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{data_url, TimelineAppIconRequest};
    use cocoa::base::{id, nil};
    use cocoa::foundation::NSString;
    use objc::{class, msg_send, sel, sel_impl};
    use std::path::Path;

    pub fn resolve(app: &TimelineAppIconRequest) -> Option<String> {
        // `NSWorkspace` and AppKit image conversion both use autoreleased
        // objects. Keep the pool local to this IPC call so repeated journal
        // polling cannot accumulate native image objects.
        unsafe {
            let pool: id = msg_send![class!(NSAutoreleasePool), new];
            let result = resolve_inner(app);
            let _: () = msg_send![pool, drain];
            result
        }
    }

    unsafe fn resolve_inner(app: &TimelineAppIconRequest) -> Option<String> {
        let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
        if workspace == nil {
            return None;
        }

        let app_path = app
            .app_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty());
        let fallback_path = app_path
            .map(str::to_string)
            .or_else(|| application_path_for_name(&app.name));
        let bundle_id = app
            .bundle_id
            .as_deref()
            .map(str::trim)
            .filter(|bundle_id| !bundle_id.is_empty());

        let path: id = if let Some(bundle_id) = bundle_id {
            let bundle_id = NSString::alloc(nil).init_str(bundle_id);
            let url: id = msg_send![workspace, URLForApplicationWithBundleIdentifier: bundle_id];
            if url == nil {
                return fallback_path.as_deref().and_then(|path| {
                    if !Path::new(path).exists() {
                        return None;
                    }
                    let path = NSString::alloc(nil).init_str(path);
                    icon_for_path(workspace, path)
                });
            }
            msg_send![url, path]
        } else if let Some(path) = fallback_path.as_deref() {
            if !Path::new(path).exists() {
                return None;
            }
            NSString::alloc(nil).init_str(path)
        } else {
            return None;
        };

        icon_for_path(workspace, path)
    }

    fn application_path_for_name(name: &str) -> Option<String> {
        let mut roots = vec![
            std::path::PathBuf::from("/Applications"),
            std::path::PathBuf::from("/System/Applications"),
        ];
        if let Some(home) = std::env::var_os("HOME") {
            roots.push(std::path::PathBuf::from(home).join("Applications"));
        }

        for root in roots {
            let Ok(entries) = std::fs::read_dir(root) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|extension| extension.to_str()) != Some("app") {
                    continue;
                }
                let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
                    continue;
                };
                if stem.eq_ignore_ascii_case(name.trim()) {
                    return Some(path.to_string_lossy().into_owned());
                }
            }
        }
        None
    }

    unsafe fn icon_for_path(workspace: id, path: impl Into<id>) -> Option<String> {
        let path: id = path.into();
        if path == nil {
            return None;
        }
        let icon: id = msg_send![workspace, iconForFile: path];
        if icon == nil {
            return None;
        }
        let tiff: id = msg_send![icon, TIFFRepresentation];
        if tiff == nil {
            return None;
        }
        let bitmap: id = msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff];
        if bitmap == nil {
            return None;
        }
        // NSBitmapImageFileTypePNG is 4 in AppKit's public enum.
        let png: id = msg_send![bitmap, representationUsingType: 4usize properties: nil];
        if png == nil {
            return None;
        }
        let length: usize = msg_send![png, length];
        let bytes: *const u8 = msg_send![png, bytes];
        if length == 0 || bytes.is_null() {
            return None;
        }
        Some(data_url(
            "image/png",
            std::slice::from_raw_parts(bytes, length),
        ))
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::{data_url, TimelineAppIconRequest};
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Imaging::{
        CLSID_WICImagingFactory, GUID_ContainerFormatPng, GUID_WICPixelFormat32bppPBGRA,
        IWICImagingFactory, WICBitmapEncoderCacheInMemory,
    };
    use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET,
    };
    use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
    use windows::Win32::UI::WindowsAndMessaging::DestroyIcon;

    pub fn resolve(app: &TimelineAppIconRequest) -> Option<String> {
        let path = app
            .app_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())?;
        if path.contains('\0') {
            return None;
        }

        let wide: Vec<u16> = std::ffi::OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut file_info = SHFILEINFOW::default();
        let found = unsafe {
            SHGetFileInfoW(
                PCWSTR(wide.as_ptr()),
                FILE_FLAGS_AND_ATTRIBUTES(0),
                Some(&mut file_info),
                size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_LARGEICON,
            )
        };
        if found == 0 || file_info.hIcon.0.is_null() {
            return None;
        }

        let icon = unsafe { encode_icon(file_info.hIcon) };
        unsafe {
            let _ = DestroyIcon(file_info.hIcon);
        }
        icon.map(|bytes| data_url("image/png", &bytes))
    }

    unsafe fn encode_icon(icon: windows::Win32::UI::WindowsAndMessaging::HICON) -> Option<Vec<u8>> {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = encode_icon_inner(icon);
        CoUninitialize();
        result
    }

    unsafe fn encode_icon_inner(
        icon: windows::Win32::UI::WindowsAndMessaging::HICON,
    ) -> Option<Vec<u8>> {
        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).ok()?;
        let bitmap = factory.CreateBitmapFromHICON(icon).ok()?;
        let stream = windows::Win32::UI::Shell::SHCreateMemStream(None)?;
        let encoder = factory
            .CreateEncoder(&GUID_ContainerFormatPng, std::ptr::null())
            .ok()?;
        encoder
            .Initialize(&stream, WICBitmapEncoderCacheInMemory)
            .ok()?;

        let mut frame = None;
        let mut options = None;
        encoder.CreateNewFrame(&mut frame, &mut options).ok()?;
        let frame = frame?;
        frame.Initialize(options.as_ref()).ok()?;

        let mut width = 0;
        let mut height = 0;
        bitmap.GetSize(&mut width, &mut height).ok()?;
        frame.SetSize(width, height).ok()?;
        let mut pixel_format = GUID_WICPixelFormat32bppPBGRA;
        frame.SetPixelFormat(&mut pixel_format).ok()?;
        frame.WriteSource(&bitmap, std::ptr::null()).ok()?;
        frame.Commit().ok()?;
        encoder.Commit().ok()?;

        let mut stat = STATSTG::default();
        stream.Stat(&mut stat, STATFLAG_NONAME).ok()?;
        stream.Seek(0, STREAM_SEEK_SET, None).ok()?;
        let size = usize::try_from(stat.cbSize).ok()?;
        if size == 0 {
            return None;
        }
        let mut bytes = vec![0u8; size];
        let mut read = 0u32;
        stream
            .Read(bytes.as_mut_ptr().cast(), size as u32, Some(&mut read))
            .ok()
            .ok()?;
        bytes.truncate(read as usize);
        Some(bytes)
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::{data_url, TimelineAppIconRequest};
    use std::path::{Path, PathBuf};

    const MAX_ICON_SCAN_DEPTH: usize = 4;

    pub fn resolve(app: &TimelineAppIconRequest) -> Option<String> {
        let dirs = desktop_dirs();
        let desktop = find_desktop_entry(app, &dirs);
        let icon_name = desktop
            .as_ref()
            .and_then(|entry| entry.icon.as_deref())
            .or_else(|| {
                app.app_path
                    .as_deref()
                    .map(Path::new)
                    .and_then(Path::file_stem)
                    .and_then(|stem| stem.to_str())
            })?;
        let icon_path = find_icon_file(icon_name, &icon_roots())?;
        let bytes = std::fs::read(&icon_path).ok()?;
        let mime = match icon_path
            .extension()
            .and_then(|extension| extension.to_str())
        {
            Some("svg") => "image/svg+xml",
            Some("png") => "image/png",
            _ => return None,
        };
        Some(data_url(mime, &bytes))
    }

    #[derive(Debug)]
    struct DesktopEntry {
        exec: Option<String>,
        icon: Option<String>,
        name: Option<String>,
    }

    fn desktop_dirs() -> Vec<PathBuf> {
        let mut dirs = Vec::new();
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            dirs.push(home.join(".local/share/applications"));
            dirs.push(home.join(".local/share/flatpak/exports/share/applications"));
        }
        let data_dirs = std::env::var("XDG_DATA_DIRS")
            .unwrap_or_else(|_| "/usr/local/share:/usr/share".to_string());
        for data_dir in data_dirs.split(':').filter(|dir| !dir.is_empty()) {
            dirs.push(PathBuf::from(data_dir).join("applications"));
        }
        dirs.push(PathBuf::from("/var/lib/flatpak/exports/share/applications"));
        dirs.push(PathBuf::from("/var/lib/snapd/desktop/applications"));
        dirs
    }

    fn icon_roots() -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            roots.push(home.join(".local/share/icons"));
            roots.push(home.join(".icons"));
        }
        let data_dirs = std::env::var("XDG_DATA_DIRS")
            .unwrap_or_else(|_| "/usr/local/share:/usr/share".to_string());
        for data_dir in data_dirs.split(':').filter(|dir| !dir.is_empty()) {
            roots.push(PathBuf::from(data_dir).join("icons"));
            roots.push(PathBuf::from(data_dir).join("pixmaps"));
        }
        roots.push(PathBuf::from("/usr/share/pixmaps"));
        roots
    }

    fn parse_desktop_entry(contents: &str) -> DesktopEntry {
        let mut in_entry = false;
        let mut entry = DesktopEntry {
            exec: None,
            icon: None,
            name: None,
        };
        for raw_line in contents.lines() {
            let line = raw_line.trim();
            if line.starts_with('[') {
                in_entry = line == "[Desktop Entry]";
                continue;
            }
            if !in_entry {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            if key == "Name" && entry.name.is_none() {
                entry.name = Some(value.trim().to_string());
            } else if key == "Icon" && entry.icon.is_none() {
                entry.icon = Some(value.trim().to_string());
            } else if key == "Exec" && entry.exec.is_none() {
                entry.exec = Some(value.trim().to_string());
            }
        }
        entry
    }

    fn find_desktop_entry(app: &TimelineAppIconRequest, dirs: &[PathBuf]) -> Option<DesktopEntry> {
        let path_stem = app
            .app_path
            .as_deref()
            .map(Path::new)
            .and_then(Path::file_stem)
            .and_then(|stem| stem.to_str())
            .map(str::to_lowercase);
        let app_name = app.name.trim().to_lowercase();

        for dir in dirs {
            let Ok(entries) = std::fs::read_dir(dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|extension| extension.to_str()) != Some("desktop") {
                    continue;
                }
                let Ok(contents) = std::fs::read_to_string(&path) else {
                    continue;
                };
                let desktop = parse_desktop_entry(&contents);
                let name_matches = desktop
                    .name
                    .as_deref()
                    .is_some_and(|name| name.eq_ignore_ascii_case(&app_name));
                let exec_matches = path_stem.as_deref().is_some_and(|stem| {
                    desktop.exec.as_deref().is_some_and(|exec| {
                        exec.split_whitespace().next().is_some_and(|command| {
                            Path::new(command)
                                .file_stem()
                                .and_then(|value| value.to_str())
                                .is_some_and(|command_stem| command_stem.eq_ignore_ascii_case(stem))
                        })
                    })
                });
                let file_matches = path_stem.as_deref().is_some_and(|stem| {
                    path.file_stem()
                        .and_then(|value| value.to_str())
                        .is_some_and(|file_stem| file_stem.eq_ignore_ascii_case(stem))
                });
                if name_matches || exec_matches || file_matches {
                    return Some(desktop);
                }
            }
        }
        None
    }

    fn find_icon_file(icon_name: &str, roots: &[PathBuf]) -> Option<PathBuf> {
        let direct = Path::new(icon_name);
        if direct.is_absolute() && direct.is_file() {
            return Some(direct.to_path_buf());
        }

        for root in roots {
            for extension in ["png", "svg"] {
                let candidate = root.join(format!("{icon_name}.{extension}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
            if let Some(found) = find_icon_recursive(root, icon_name, 0) {
                return Some(found);
            }
        }
        None
    }

    fn find_icon_recursive(root: &Path, icon_name: &str, depth: usize) -> Option<PathBuf> {
        if depth > MAX_ICON_SCAN_DEPTH {
            return None;
        }
        let entries = std::fs::read_dir(root).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(found) = find_icon_recursive(&path, icon_name, depth + 1) {
                    return Some(found);
                }
                continue;
            }
            let extension = path.extension().and_then(|extension| extension.to_str());
            if !matches!(extension, Some("png") | Some("svg")) {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            if stem == icon_name || stem.strip_suffix("-symbolic") == Some(icon_name) {
                return Some(path);
            }
        }
        None
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn parses_desktop_entry_icon_and_exec() {
            let entry = parse_desktop_entry(
                "[Desktop Entry]\nName=WhatsApp\nIcon=whatsapp\nExec=/opt/WhatsApp/whatsapp %U\n",
            );
            assert_eq!(entry.name.as_deref(), Some("WhatsApp"));
            assert_eq!(entry.icon.as_deref(), Some("whatsapp"));
            assert_eq!(entry.exec.as_deref(), Some("/opt/WhatsApp/whatsapp %U"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_blank_or_oversized_keys() {
        assert_eq!(valid_key("  "), None);
        assert_eq!(valid_key(&"x".repeat(MAX_KEY_BYTES + 1)), None);
        assert_eq!(
            valid_key("name:whatsapp"),
            Some("name:whatsapp".to_string())
        );
    }

    #[test]
    fn command_deduplicates_and_degrades_for_missing_apps() {
        let key = format!("missing-test-{}", std::process::id());
        let request = || TimelineAppIconRequest {
            app_path: Some("/definitely/missing/application".to_string()),
            bundle_id: None,
            key: key.clone(),
            name: "Missing app".to_string(),
        };
        let results = resolve_timeline_app_icons(vec![request(), request()]);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].key, key);
        assert_eq!(results[0].icon_url, None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn resolves_an_installed_macos_app_icon() {
        let results = resolve_timeline_app_icons(vec![TimelineAppIconRequest {
            app_path: Some("/Applications/WhatsApp.app".to_string()),
            bundle_id: Some("com.whatsapp.WhatsApp".to_string()),
            key: "installed-whatsapp-proof".to_string(),
            name: "WhatsApp".to_string(),
        }]);

        assert_eq!(results.len(), 1);
        assert!(
            results[0]
                .icon_url
                .as_deref()
                .is_some_and(|url| url.starts_with("data:image/png;base64,")),
            "expected a PNG data URL for the installed WhatsApp app"
        );
    }

    #[test]
    fn data_urls_are_csp_safe() {
        assert_eq!(data_url("image/png", &[0, 1]), "data:image/png;base64,AAE=");
    }
}
