//! Native application menu (F.4).
//!
//! Builds a platform-appropriate menu bar:
//!   - Windows / Linux: File / Edit / View / Window / Help
//!   - macOS:           Lipi / File / Edit / View / Window / Help
//!     (the "Lipi" submenu is added by Tauri automatically when
//!     a PredefinedMenuItem::about / hide / quit is registered
//!     as a top-level item).
//!
//! The Rust side does NOT execute the menu actions - it emits
//! a `lipi://menu` event with a string command id (matching
//! the Command Palette `id` field), and the frontend dispatches.
//! This keeps the action logic in one place (the command palette
//! registry) and avoids duplicating it in Rust.

use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, Runtime,
};

/// Menu event channel name. The frontend listens via
/// `listen('lipi://menu', e => dispatch(e.payload.commandId))`.
pub const MENU_EVENT: &str = "lipi://menu";

/// The payload carried by `lipi://menu`. A single string id
/// matches the `Command.id` field in `src/shared/commands/commands.ts`,
/// so the frontend can route via the same dispatch the command
/// palette uses.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuEventPayload {
    pub command_id: String,
}

/// Build the main window menu. Called from `tauri::Builder::menu`
/// at startup. The `&AppHandle` is needed for `PredefinedMenuItem::copy`
/// / `cut` / `paste` / `select_all` (they take a manager).
///
/// Generic over the Tauri runtime so this works in tests (with a
/// mock runtime) and on the production `Wry` runtime.
pub fn build_main_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    // ---- File submenu ----
    let open_folder = MenuItemBuilder::with_id("menu.file.openFolder", "Open Folder...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let close_folder = MenuItemBuilder::with_id("menu.file.closeFolder", "Close Folder")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let settings = MenuItemBuilder::with_id("menu.file.settings", "Settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let command_palette = MenuItemBuilder::with_id("menu.file.commandPalette", "Command Palette")
        .accelerator("CmdOrCtrl+Shift+P")
        .build(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit Lipi"))?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&open_folder)
        .item(&close_folder)
        .separator()
        .item(&settings)
        .item(&command_palette)
        .separator()
        .item(&quit)
        .build()?;

    // ---- Edit submenu ----
    // PredefinedMenuItem gives us the OS-native copy/cut/paste/select_all
    // behaviour for free (they wire up to the WebView's clipboard, so
    // Monaco's selections just work). The "Find" and "Find Next" items
    // we wire up ourselves via the command palette (currently
    // surface as Monaco's built-in Ctrl+F).
    let undo = PredefinedMenuItem::undo(app, Some("Undo"))?;
    let redo = PredefinedMenuItem::redo(app, Some("Redo"))?;
    let cut = PredefinedMenuItem::cut(app, Some("Cut"))?;
    let copy = PredefinedMenuItem::copy(app, Some("Copy"))?;
    let paste = PredefinedMenuItem::paste(app, Some("Paste"))?;
    let select_all = PredefinedMenuItem::select_all(app, Some("Select All"))?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&undo)
        .item(&redo)
        .separator()
        .item(&cut)
        .item(&copy)
        .item(&paste)
        .item(&select_all)
        .build()?;

    // ---- View submenu ----
    // Dev Tools and Reload are dev-only. We always register them;
    // the frontend can ignore them in production. There's no native
    // way to gate a menu item at the Tauri 2 level, and adding a
    // dev-mode check here would couple the menu builder to
    // `cfg!(debug_assertions)`, which is fine - the menu just won't
    // be rebuilt if you flip the profile. For F.4 we keep it simple.
    let reload = MenuItemBuilder::with_id("menu.view.reload", "Reload")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let dev_tools = MenuItemBuilder::with_id("menu.view.devTools", "Toggle Developer Tools")
        .accelerator("CmdOrCtrl+Shift+I")
        .build(app)?;
    let command_palette_toggle = MenuItemBuilder::new("Show Command Palette")
        .accelerator("CmdOrCtrl+Shift+P")
        .enabled(false) // greyed-out: the same accelerator is in File; this is a hint
        .build(app)?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&reload)
        .item(&dev_tools)
        .separator()
        .item(&command_palette_toggle)
        .build()?;

    // ---- Window submenu (Linux) ----
    // On Linux, the Window menu is platform-conventional. On Windows
    // and macOS, Tauri handles the "minimize" / "close" automatically
    // via the window chrome (we don't need to register them). We
    // include minimize/maximize for cross-platform parity; the
    // predefines are no-ops on platforms that don't support them
    // (see PredefinedMenuItem docs - "Platform-specific: Linux:
    // Unsupported" for maximize).
    let minimize = PredefinedMenuItem::minimize(app, Some("Minimize"))?;
    let maximize = PredefinedMenuItem::maximize(app, Some("Maximize"))?;
    let window = SubmenuBuilder::new(app, "Window")
        .item(&minimize)
        .item(&maximize)
        .build()?;

    // ---- Help submenu ----
    // About is the only custom Help item. The rest of the menu
    // (docs, source, license) lives in the in-app About modal so
    // we have one source of truth for the project metadata.
    let about = MenuItemBuilder::with_id("menu.help.about", "About Lipi").build(app)?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&about)
        .build()?;

    // ---- Top-level ----
    // On Windows / Linux this is the menu bar of the main window.
    // On macOS the first submenu becomes the "app menu" (Lipi, with
    // About / Hide / Quit pre-populated) and the rest sit to the
    // right. We don't add a custom "Lipi" submenu here - the
    // platform-native one (with our PredefinedMenuItem::about /
    // quit + the default services) is exactly what we want.
    let menu = MenuBuilder::new(app)
        .item(&file)
        .item(&edit)
        .item(&view)
        .item(&window)
        .item(&help)
        .build()?;

    Ok(menu)
}

/// Emit a `lipi://menu` event for the given command id. Called from
/// `tauri::Builder::on_menu_event` in `lib.rs`. Frontend listens via
/// `listen('lipi://menu', e => dispatch(e.payload.commandId))`.
pub fn dispatch<R: Runtime>(app: &AppHandle<R>, command_id: impl Into<String>) {
    let payload = MenuEventPayload {
        command_id: command_id.into(),
    };
    if let Err(e) = app.emit(MENU_EVENT, &payload) {
        log::warn!("failed to emit menu event: {e}");
    }
}
