//! macOS platform layer for Quick Capture: the event tap that watches for the
//! double-Shift gesture, and the readers that turn "the user just did it" into
//! text plus the context it came from.
//!
//! ## Two different permissions
//!
//! These are separate TCC services and the feature needs BOTH:
//!
//! - **Input Monitoring** (`kTCCServiceListenEvent`) gates `CGEventTapCreate` for
//!   keyboard events. Without it the tap is created NULL and the gesture silently
//!   never fires — indistinguishable, from the outside, from a broken detector.
//!   [`spawn_listener`] therefore reports tap creation as an explicit error rather
//!   than logging and continuing.
//! - **Accessibility** (`kTCCServiceAccessibility`) gates the `AX*` reads used for
//!   the selected text and the source window. Without it capture still works, via
//!   the clipboard fallback, and [`capture_context`] still names the frontmost app
//!   (that comes from `NSWorkspace`, which is ungated) — only the window title and
//!   the page URL are lost.
//!
//! ## The callback must be fast
//!
//! macOS disables an event tap whose callback is slow (`TapDisabledByTimeout`), and
//! once disabled it stays disabled. So the callback does nothing but feed the
//! [`Detector`](super::gesture::Detector) and push a trigger down a channel; every
//! expensive step — the AX reads, the synthetic ⌘C, the HTTP POST — happens on the
//! worker in [`super`]. The two `TapDisabled*` events are handled by re-enabling
//! the tap, without which one hiccup would kill the gesture for the whole session.

use std::os::raw::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;

use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
use core_foundation::string::{CFString, CFStringRef};
use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
    CGEventType, EventField,
};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use objc::{class, msg_send, sel, sel_impl};

use super::gesture::{Detector, Input, Side, Trigger};
use super::CaptureContext;

/// Virtual keycode for `C`, for the synthetic ⌘C fallback.
const KEYCODE_C: u16 = 8;

/// How long to wait for the pasteboard to change after a synthetic ⌘C before
/// giving up. Copy is asynchronous in most apps; ~500ms covers a slow Electron
/// target without leaving the worker stuck.
const COPY_WAIT_MS: u64 = 500;
const COPY_POLL_MS: u64 = 20;

/// Set while the synthetic ⌘C is in flight so the tap ignores the keystrokes it
/// posts itself.
///
/// What it actually guarantees: the Command press/release the fallback posts is not
/// fed to the detector. It is NOT a hermetic seal — the trailing `FlagsChanged` as
/// the modifiers return to zero can land just after the flag clears, producing one
/// stray `Input::OtherModifier`. That is harmless (it only resets a detector that
/// has nothing pending), and it is why this is a suppression window rather than a
/// correctness mechanism. The detector's own rules, not this flag, are what keep
/// synthetic input from being mistaken for a gesture.
static SYNTHESIZING: AtomicBool = AtomicBool::new(false);

/// Whether the listener should process events at all. The tap stays installed for
/// the life of the process once created (a `CFMachPort` cannot be moved off the
/// thread that owns it), so this is what "off" means: the callback returns before
/// looking at anything.
static LISTENING: AtomicBool = AtomicBool::new(false);

thread_local! {
    /// The tap's own `CFMachPortRef`, so the callback can re-enable itself after a
    /// `TapDisabled*`. Thread-local because the callback only ever runs on the
    /// thread that created the tap, and a `CFMachPort` may not leave it.
    static TAP_PORT: std::cell::Cell<*mut c_void> = const { std::cell::Cell::new(std::ptr::null_mut()) };
}

pub fn set_listening(on: bool) {
    LISTENING.store(on, Ordering::SeqCst);
}

pub fn is_listening() -> bool {
    LISTENING.load(Ordering::SeqCst)
}

/// Create the event tap on its own thread and stream triggers to `tx`.
///
/// Blocks until the tap has been created (or failed), so a missing Input
/// Monitoring grant surfaces as an error to the caller instead of a thread that
/// quietly does nothing. The thread then owns a CFRunLoop for the process's life.
pub fn spawn_listener(tx: Sender<Trigger>) -> Result<(), String> {
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();

    std::thread::Builder::new()
		.name("ryu-quick-capture".into())
		.spawn(move || {
			// The detector lives on this thread and is only ever touched by the
			// callback, so a RefCell is the right amount of synchronization.
			let detector = std::cell::RefCell::new(Detector::default());

			let tap = CGEventTap::new(
				CGEventTapLocation::HID,
				CGEventTapPlacement::HeadInsertEventTap,
				// LISTEN ONLY: Quick Capture observes the keyboard, it never
				// swallows a keystroke. A filtering tap that stalls would freeze
				// typing system-wide.
				CGEventTapOptions::ListenOnly,
				vec![
					CGEventType::KeyDown,
					CGEventType::FlagsChanged,
					CGEventType::TapDisabledByTimeout,
					CGEventType::TapDisabledByUserInput,
				],
				move |_proxy, event_type, event| {
					on_event(&detector, &tx, event_type, event);
					None
				},
			);

			let tap = match tap {
				Ok(tap) => tap,
				Err(()) => {
					let _ = ready_tx.send(Err(
						"couldn't create the keyboard event tap — grant Input Monitoring to Ryu in System Settings › Privacy & Security, then restart the app".into(),
					));
					return;
				}
			};

			let source = match tap.mach_port.create_runloop_source(0) {
				Ok(source) => source,
				Err(()) => {
					let _ = ready_tx.send(Err("couldn't attach the event tap to a run loop".into()));
					return;
				}
			};

			TAP_PORT.with(|slot| {
				slot.set(tap.mach_port.as_concrete_TypeRef() as *mut c_void);
			});

			let run_loop = CFRunLoop::get_current();
			unsafe {
				run_loop.add_source(&source, kCFRunLoopCommonModes);
			}
			tap.enable();
			let _ = ready_tx.send(Ok(()));

			// Owns this thread from here on. `tap` and `source` must stay alive for
			// the loop's lifetime, which they do by being held in this frame.
			CFRunLoop::run_current();
		})
		.map_err(|e| format!("couldn't start the Quick Capture listener thread: {e}"))?;

    ready_rx
        .recv()
        .map_err(|_| "the Quick Capture listener stopped before it started".to_string())?
}

/// Handle one tapped event. Kept tiny — see the module docs on tap timeouts.
fn on_event(
    detector: &std::cell::RefCell<Detector>,
    tx: &Sender<Trigger>,
    event_type: CGEventType,
    event: &CGEvent,
) {
    // The system disabled us (a slow callback, or the user's security settings).
    // Re-enabling is the only way back; the detector is reset because events were
    // missed and half a gesture may be stale. Handled BEFORE the `LISTENING` check
    // so a tap that is momentarily off still recovers.
    if matches!(
        event_type,
        CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput
    ) {
        detector.borrow_mut().reset();
        // Re-enable, or the gesture is dead for the rest of the session.
        TAP_PORT.with(|port| {
            let port = port.get();
            if !port.is_null() {
                unsafe { CGEventTapEnable(port, true) };
            }
        });
        return;
    }

    if !is_listening() || SYNTHESIZING.load(Ordering::SeqCst) {
        return;
    }

    let now_ms = now_millis();
    let flags = event.get_flags();
    let input = match event_type {
        // Any real key press. Modifier presses arrive as FlagsChanged, never here,
        // so this is unambiguously "a character was typed".
        CGEventType::KeyDown => Some(Input::KeyDown),
        CGEventType::FlagsChanged => {
            let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
            match Side::from_keycode(keycode) {
                Some(side) => {
                    // FlagsChanged does not say "up" or "down" — the Shift bit in the
                    // post-change flags does. Set = this event pressed it.
                    if flags.contains(CGEventFlags::CGEventFlagShift) {
                        Some(Input::ShiftDown {
                            side,
                            other_modifiers: has_other_modifiers(flags),
                        })
                    } else {
                        Some(Input::ShiftUp { side })
                    }
                }
                // Command/Option/Control/Fn/CapsLock moving is what breaks a chord
                // out of being a capture.
                None => Some(Input::OtherModifier),
            }
        }
        _ => None,
    };

    let Some(input) = input else {
        return;
    };
    if let Some(trigger) = detector.borrow_mut().feed(now_ms, input) {
        // A full channel means the worker is still busy with the previous capture;
        // dropping is correct (the user gets one capture, not a queue of them).
        let _ = tx.send(trigger);
    }
}

fn has_other_modifiers(flags: CGEventFlags) -> bool {
    flags.intersects(
        CGEventFlags::CGEventFlagCommand
            | CGEventFlags::CGEventFlagControl
            | CGEventFlags::CGEventFlagAlternate
            | CGEventFlags::CGEventFlagSecondaryFn,
    )
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ── selection + context ─────────────────────────────────────────────────────

/// Read whatever text the user currently has selected in the frontmost app.
///
/// `AXSelectedText` is tried first — it is non-destructive and instant. It is also
/// empty in a great many of the apps this feature targets (browser and Electron
/// UIs frequently do not publish it), so the fallback synthesizes ⌘C and watches
/// the pasteboard, restoring the previous clipboard afterwards.
pub fn read_selection() -> Option<String> {
    if let Some(text) = ax_selected_text() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    copy_selection_via_clipboard()
}

/// Where the capture came from: the frontmost app, its focused window title, and
/// the document URL when the app publishes one (browsers do).
pub fn capture_context() -> CaptureContext {
    CaptureContext {
        app: frontmost_app_name(),
        title: ax_focused_window_string("AXTitle"),
        url: ax_focused_window_string("AXDocument").filter(|u| u.starts_with("http")),
    }
}

fn ax_selected_text() -> Option<String> {
    unsafe {
        let system = AXUIElementCreateSystemWide();
        if system.is_null() {
            return None;
        }
        let focused = ax_copy_element(system, "AXFocusedUIElement");
        CFRelease(system as CFTypeRef);
        let focused = focused?;
        let text = ax_copy_string(focused, "AXSelectedText");
        CFRelease(focused as CFTypeRef);
        text
    }
}

fn ax_focused_window_string(attribute: &str) -> Option<String> {
    unsafe {
        let system = AXUIElementCreateSystemWide();
        if system.is_null() {
            return None;
        }
        let app = ax_copy_element(system, "AXFocusedApplication");
        CFRelease(system as CFTypeRef);
        let app = app?;
        let window = ax_copy_element(app, "AXFocusedWindow");
        CFRelease(app as CFTypeRef);
        let window = window?;
        let value = ax_copy_string(window, attribute);
        CFRelease(window as CFTypeRef);
        value
    }
}

/// Copy an AX attribute that is itself an element (returns a +1 reference the
/// caller must `CFRelease`).
unsafe fn ax_copy_element(element: AXUIElementRef, attribute: &str) -> Option<AXUIElementRef> {
    let key = CFString::new(attribute);
    let mut value: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(element, key.as_concrete_TypeRef(), &mut value);
    if err != 0 || value.is_null() {
        return None;
    }
    Some(value as AXUIElementRef)
}

/// Copy an AX attribute that is a string. Returns `None` (rather than a garbled
/// value) when the attribute exists but is not a CFString.
unsafe fn ax_copy_string(element: AXUIElementRef, attribute: &str) -> Option<String> {
    let key = CFString::new(attribute);
    let mut value: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(element, key.as_concrete_TypeRef(), &mut value);
    if err != 0 || value.is_null() {
        return None;
    }
    if CFGetTypeID(value) != CFStringGetTypeID() {
        CFRelease(value);
        return None;
    }
    let s = CFString::wrap_under_create_rule(value as CFStringRef).to_string();
    Some(s)
}

/// The ⌘C fallback: remember the pasteboard, synthesize the copy, wait for the
/// change, then put the pasteboard back.
///
/// Restoring matters — Quick Capture must not eat whatever the user had on their
/// clipboard just because they tapped Shift twice.
fn copy_selection_via_clipboard() -> Option<String> {
    let previous = pasteboard_string();
    let before = pasteboard_change_count();

    SYNTHESIZING.store(true, Ordering::SeqCst);
    let posted = post_command_c();
    // Released only after the wait, so the tap ignores the whole synthetic burst.
    let copied = if posted {
        wait_for_pasteboard_change(before)
    } else {
        None
    };
    SYNTHESIZING.store(false, Ordering::SeqCst);

    // Put the user's clipboard back regardless of whether the copy produced
    // anything — a failed capture must still be invisible.
    if let Some(previous) = previous {
        set_pasteboard_string(&previous);
    }

    copied
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn post_command_c() -> bool {
    // A fresh source per event: `CGEventSource` is cheap and this avoids depending
    // on whether the binding exposes a retaining `Clone`.
    let Ok(down_source) = CGEventSource::new(CGEventSourceStateID::HIDSystemState) else {
        return false;
    };
    let Ok(down) = CGEvent::new_keyboard_event(down_source, KEYCODE_C, true) else {
        return false;
    };
    down.set_flags(CGEventFlags::CGEventFlagCommand);
    down.post(CGEventTapLocation::HID);

    let Ok(up_source) = CGEventSource::new(CGEventSourceStateID::HIDSystemState) else {
        return false;
    };
    let Ok(up) = CGEvent::new_keyboard_event(up_source, KEYCODE_C, false) else {
        return false;
    };
    up.set_flags(CGEventFlags::CGEventFlagCommand);
    up.post(CGEventTapLocation::HID);
    true
}

fn wait_for_pasteboard_change(before: i64) -> Option<String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(COPY_WAIT_MS);
    while std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(COPY_POLL_MS));
        if pasteboard_change_count() != before {
            return pasteboard_string();
        }
    }
    None
}

fn frontmost_app_name() -> Option<String> {
    unsafe {
        let workspace: *mut objc::runtime::Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        if workspace.is_null() {
            return None;
        }
        let app: *mut objc::runtime::Object = msg_send![workspace, frontmostApplication];
        if app.is_null() {
            return None;
        }
        let name: *mut objc::runtime::Object = msg_send![app, localizedName];
        ns_string_to_rust(name)
    }
}

fn pasteboard_change_count() -> i64 {
    unsafe {
        let pb: *mut objc::runtime::Object = msg_send![class!(NSPasteboard), generalPasteboard];
        if pb.is_null() {
            return 0;
        }
        msg_send![pb, changeCount]
    }
}

fn pasteboard_string() -> Option<String> {
    unsafe {
        let pb: *mut objc::runtime::Object = msg_send![class!(NSPasteboard), generalPasteboard];
        if pb.is_null() {
            return None;
        }
        let ty = ns_string("public.utf8-plain-text");
        let s: *mut objc::runtime::Object = msg_send![pb, stringForType: ty];
        ns_string_to_rust(s)
    }
}

fn set_pasteboard_string(text: &str) {
    unsafe {
        let pb: *mut objc::runtime::Object = msg_send![class!(NSPasteboard), generalPasteboard];
        if pb.is_null() {
            return;
        }
        let _: i64 = msg_send![pb, clearContents];
        let value = ns_string(text);
        let ty = ns_string("public.utf8-plain-text");
        let _: bool = msg_send![pb, setString: value forType: ty];
    }
}

unsafe fn ns_string(s: &str) -> *mut objc::runtime::Object {
    let cls = class!(NSString);
    let alloc: *mut objc::runtime::Object = msg_send![cls, alloc];
    let bytes = s.as_ptr() as *const c_void;
    // 4 == NSUTF8StringEncoding.
    let obj: *mut objc::runtime::Object = msg_send![
        alloc,
        initWithBytes: bytes
        length: s.len()
        encoding: 4usize
    ];
    obj
}

unsafe fn ns_string_to_rust(s: *mut objc::runtime::Object) -> Option<String> {
    if s.is_null() {
        return None;
    }
    let bytes: *const std::os::raw::c_char = msg_send![s, UTF8String];
    if bytes.is_null() {
        return None;
    }
    std::ffi::CStr::from_ptr(bytes)
        .to_str()
        .ok()
        .map(str::to_string)
}

// ── raw framework bindings ──────────────────────────────────────────────────
//
// Declared here rather than pulled in as another crate, matching how
// `ghost-permissions` links AppKit/CoreGraphics directly.

type AXUIElementRef = *const c_void;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFGetTypeID(cf: CFTypeRef) -> usize;
    fn CFStringGetTypeID() -> usize;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    /// Re-arm a tap the system disabled. Takes the tap's `CFMachPortRef`.
    fn CGEventTapEnable(tap: *mut c_void, enable: bool);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The one thing about this module that cannot be unit-tested in CI: whether
    /// the OS actually hands us a keyboard event tap. It depends on a TCC grant
    /// (Input Monitoring) held by the *running binary*, which a `cargo test`
    /// harness does not have — so this is `#[ignore]`d rather than asserted.
    ///
    /// Run it deliberately, after granting Input Monitoring to your terminal:
    ///
    /// ```text
    /// cargo test -p desktop --lib -- --ignored tap_can_be_created
    /// ```
    ///
    /// A pass means `CGEventTapCreate` returned non-null and the mask/placement
    /// arguments are accepted — the failure mode the gesture is most prone to and
    /// the one that otherwise looks identical to a broken detector.
    #[test]
    #[ignore = "requires the Input Monitoring TCC grant for the test binary"]
    fn tap_can_be_created() {
        let tap = CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![CGEventType::KeyDown, CGEventType::FlagsChanged],
            |_proxy, _etype, _event| None,
        );
        assert!(
            tap.is_ok(),
            "CGEventTapCreate returned null — grant Input Monitoring to the process \
			 running this test in System Settings › Privacy & Security"
        );
    }

    /// The pasteboard round-trip the ⌘C fallback depends on. Needs no permission:
    /// reading and writing the general pasteboard is ungated.
    #[test]
    fn pasteboard_round_trips_and_bumps_its_change_count() {
        let original = pasteboard_string();
        let before = pasteboard_change_count();

        set_pasteboard_string("ryu-quick-capture-test");
        assert_eq!(
            pasteboard_string().as_deref(),
            Some("ryu-quick-capture-test")
        );
        assert_ne!(
            pasteboard_change_count(),
            before,
            "changeCount must move — the ⌘C fallback polls exactly this to know a copy landed"
        );

        // Leave the developer's clipboard as we found it, the same contract
        // `copy_selection_via_clipboard` owes the user.
        if let Some(original) = original {
            set_pasteboard_string(&original);
        }
    }
}
