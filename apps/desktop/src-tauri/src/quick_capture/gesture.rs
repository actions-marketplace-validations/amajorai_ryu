//! The double-Shift gesture, as a pure state machine.
//!
//! Deliberately free of any OS types so it can be unit-tested: the platform layer
//! ([`super::mac`]) translates raw events into [`Input`]s and feeds them here, and
//! this decides — and only this decides — when a capture fires.
//!
//! ## Why this is not "two flagsChanged events"
//!
//! Typing `Hello World` presses and releases Shift twice within a few hundred
//! milliseconds. A detector that only watches the Shift bit would fire a capture
//! mid-sentence, over and over. The gesture is a double tap only when **nothing
//! else happened between the two taps**:
//!
//! - a non-modifier key going down cancels (that Shift was a capital letter);
//! - another modifier joining cancels (that was `⇧⌘K`, someone's shortcut);
//! - holding Shift rather than tapping it cancels (that was a selection drag);
//! - the two taps must be the same physical key, so left and right stay distinct
//!   (macOS keycode 56 vs 60 — the modifier flags alone cannot tell them apart).
//!
//! Left and right are reported separately so a future "capture as a prompt"
//! variant can bind to right-Shift without a second detector.

/// macOS virtual keycode for the left Shift key.
pub const SHIFT_LEFT_KEYCODE: i64 = 56;
/// macOS virtual keycode for the right Shift key.
pub const SHIFT_RIGHT_KEYCODE: i64 = 60;

/// How long after the first tap the second one still counts. 400ms is a
/// comfortable deliberate double-tap without being long enough to catch two
/// unrelated Shifts in ordinary typing.
pub const DOUBLE_TAP_WINDOW_MS: u64 = 400;

/// Which physical Shift key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Left,
    Right,
}

impl Side {
    /// The side for a macOS keycode, or `None` when it is not a Shift key.
    pub fn from_keycode(keycode: i64) -> Option<Self> {
        match keycode {
            SHIFT_LEFT_KEYCODE => Some(Side::Left),
            SHIFT_RIGHT_KEYCODE => Some(Side::Right),
            _ => None,
        }
    }
}

/// What the platform layer observed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Input {
    /// A Shift key went down. `other_modifiers` is true when any of
    /// Command/Control/Option/Function was already held.
    ShiftDown { side: Side, other_modifiers: bool },
    /// A Shift key came back up.
    ShiftUp { side: Side },
    /// Any non-modifier key went down.
    KeyDown,
    /// A modifier other than Shift changed state.
    OtherModifier,
}

/// A fired gesture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Trigger {
    pub side: Side,
}

#[derive(Debug, Clone, Copy)]
struct Pending {
    side: Side,
    down_at_ms: u64,
}

/// Feeds on [`Input`]s and emits a [`Trigger`] on a clean double tap.
#[derive(Debug)]
pub struct Detector {
    window_ms: u64,
    /// A Shift that is currently down and still eligible to become a tap.
    pending: Option<Pending>,
    /// The last COMPLETED tap: the first half of a potential double.
    last_tap: Option<(u64, Side)>,
}

impl Default for Detector {
    fn default() -> Self {
        Self::new(DOUBLE_TAP_WINDOW_MS)
    }
}

impl Detector {
    pub fn new(window_ms: u64) -> Self {
        Self {
            window_ms,
            pending: None,
            last_tap: None,
        }
    }

    /// Forget everything. Used when the tap is re-enabled after the system
    /// disabled it, since events were missed and half a gesture may be stale.
    pub fn reset(&mut self) {
        self.pending = None;
        self.last_tap = None;
    }

    /// Feed one input. Returns `Some` exactly once per completed double tap.
    pub fn feed(&mut self, now_ms: u64, input: Input) -> Option<Trigger> {
        match input {
            // A key press means that Shift was a capital letter, not a tap — and it
            // also breaks any half-finished double, so `Hi` followed by one
            // deliberate tap cannot add up to a gesture.
            Input::KeyDown | Input::OtherModifier => {
                self.reset();
                None
            }
            Input::ShiftDown {
                side,
                other_modifiers,
            } => {
                if other_modifiers {
                    // Shift joining an existing chord is never a capture.
                    self.reset();
                    return None;
                }
                self.pending = Some(Pending {
                    side,
                    down_at_ms: now_ms,
                });
                None
            }
            Input::ShiftUp { side } => self.on_shift_up(now_ms, side),
        }
    }

    fn on_shift_up(&mut self, now_ms: u64, side: Side) -> Option<Trigger> {
        let pending = self.pending.take()?;
        if pending.side != side {
            // Both Shifts were down; this is not a clean tap of either.
            self.last_tap = None;
            return None;
        }
        // A HOLD is not a tap. Someone shift-clicking through a selection should
        // never trip the gesture, however briefly they release afterwards.
        if now_ms.saturating_sub(pending.down_at_ms) > self.window_ms {
            self.last_tap = None;
            return None;
        }

        match self.last_tap {
            Some((first_at, first_side))
                if first_side == side && now_ms.saturating_sub(first_at) <= self.window_ms =>
            {
                // Cleared, not left in place: a third tap starts a fresh pair rather
                // than firing again off the same first half.
                self.last_tap = None;
                Some(Trigger { side })
            }
            _ => {
                self.last_tap = Some((now_ms, side));
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tap Shift: down at `at`, up 40ms later (well inside the hold threshold).
    fn tap(d: &mut Detector, at: u64, side: Side) -> Option<Trigger> {
        d.feed(
            at,
            Input::ShiftDown {
                side,
                other_modifiers: false,
            },
        );
        d.feed(at + 40, Input::ShiftUp { side })
    }

    #[test]
    fn two_quick_taps_fire_once() {
        let mut d = Detector::default();
        assert_eq!(tap(&mut d, 0, Side::Left), None);
        assert_eq!(
            tap(&mut d, 200, Side::Left),
            Some(Trigger { side: Side::Left })
        );
    }

    #[test]
    fn a_slow_second_tap_does_not_fire() {
        let mut d = Detector::default();
        tap(&mut d, 0, Side::Left);
        assert_eq!(tap(&mut d, 900, Side::Left), None);
    }

    #[test]
    fn three_taps_fire_exactly_once() {
        // The third tap must start a NEW pair, not re-fire against the first.
        let mut d = Detector::default();
        assert_eq!(tap(&mut d, 0, Side::Left), None);
        assert_eq!(
            tap(&mut d, 150, Side::Left),
            Some(Trigger { side: Side::Left })
        );
        assert_eq!(tap(&mut d, 300, Side::Left), None);
    }

    #[test]
    fn typing_a_capital_letter_never_fires() {
        // `Hello World`: Shift, H, … Shift, W. Both Shifts are consumed by a key.
        let mut d = Detector::default();
        d.feed(
            0,
            Input::ShiftDown {
                side: Side::Left,
                other_modifiers: false,
            },
        );
        d.feed(10, Input::KeyDown);
        assert_eq!(d.feed(20, Input::ShiftUp { side: Side::Left }), None);

        d.feed(
            200,
            Input::ShiftDown {
                side: Side::Left,
                other_modifiers: false,
            },
        );
        d.feed(210, Input::KeyDown);
        assert_eq!(d.feed(220, Input::ShiftUp { side: Side::Left }), None);
    }

    #[test]
    fn a_key_between_two_clean_taps_breaks_the_pair() {
        let mut d = Detector::default();
        tap(&mut d, 0, Side::Left);
        d.feed(100, Input::KeyDown);
        assert_eq!(tap(&mut d, 150, Side::Left), None);
    }

    #[test]
    fn shift_in_a_chord_never_fires() {
        // ⇧⌘K, twice. The Command flag change cancels each time.
        let mut d = Detector::default();
        for at in [0, 200] {
            d.feed(
                at,
                Input::ShiftDown {
                    side: Side::Left,
                    other_modifiers: false,
                },
            );
            d.feed(at + 5, Input::OtherModifier);
            d.feed(at + 10, Input::KeyDown);
            assert_eq!(d.feed(at + 20, Input::ShiftUp { side: Side::Left }), None);
        }
    }

    #[test]
    fn shift_pressed_while_command_is_already_held_never_fires() {
        let mut d = Detector::default();
        for at in [0, 150] {
            d.feed(
                at,
                Input::ShiftDown {
                    side: Side::Left,
                    other_modifiers: true,
                },
            );
            assert_eq!(d.feed(at + 20, Input::ShiftUp { side: Side::Left }), None);
        }
    }

    #[test]
    fn holding_shift_is_not_a_tap() {
        // Shift held for a second (a selection drag), then tapped once.
        let mut d = Detector::default();
        d.feed(
            0,
            Input::ShiftDown {
                side: Side::Left,
                other_modifiers: false,
            },
        );
        assert_eq!(d.feed(1000, Input::ShiftUp { side: Side::Left }), None);
        assert_eq!(tap(&mut d, 1100, Side::Left), None);
    }

    #[test]
    fn left_and_right_shift_are_distinct_gestures() {
        let mut d = Detector::default();
        tap(&mut d, 0, Side::Left);
        // Mixing sides is not a double tap of either.
        assert_eq!(tap(&mut d, 150, Side::Right), None);

        let mut d = Detector::default();
        assert_eq!(tap(&mut d, 0, Side::Right), None);
        assert_eq!(
            tap(&mut d, 150, Side::Right),
            Some(Trigger { side: Side::Right })
        );
    }

    #[test]
    fn both_shifts_down_together_is_not_a_tap() {
        let mut d = Detector::default();
        d.feed(
            0,
            Input::ShiftDown {
                side: Side::Left,
                other_modifiers: false,
            },
        );
        d.feed(
            10,
            Input::ShiftDown {
                side: Side::Right,
                other_modifiers: false,
            },
        );
        // The pending press is the RIGHT one; releasing LEFT matches nothing.
        assert_eq!(d.feed(20, Input::ShiftUp { side: Side::Left }), None);
        assert_eq!(d.feed(30, Input::ShiftUp { side: Side::Right }), None);
    }

    #[test]
    fn a_stray_shift_up_is_ignored() {
        let mut d = Detector::default();
        assert_eq!(d.feed(0, Input::ShiftUp { side: Side::Left }), None);
    }

    #[test]
    fn reset_drops_a_half_finished_gesture() {
        let mut d = Detector::default();
        tap(&mut d, 0, Side::Left);
        d.reset();
        assert_eq!(tap(&mut d, 100, Side::Left), None);
    }

    #[test]
    fn keycodes_map_to_sides() {
        assert_eq!(Side::from_keycode(SHIFT_LEFT_KEYCODE), Some(Side::Left));
        assert_eq!(Side::from_keycode(SHIFT_RIGHT_KEYCODE), Some(Side::Right));
        assert_eq!(Side::from_keycode(0), None);
    }
}
