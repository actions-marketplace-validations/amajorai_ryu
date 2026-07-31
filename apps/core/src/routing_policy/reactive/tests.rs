//! Tests for the reactive failover decision.
//!
//! Everything here is pure: [`decide`] takes the vendor readings as data, so the
//! cases that actually go wrong in production — a plan that looks free on one
//! window and is spent on another, a wait ordered by the wrong field — are
//! testable with no credential, no network and no clock dependency.

use super::*;

/// An account-wide window.
fn window(label: &str, used: f64, resets_at: Option<&str>) -> WindowReading {
    WindowReading {
        label: label.to_string(),
        model: None,
        used_percent: used,
        resets_at: resets_at.map(str::to_string),
        window_seconds: None,
    }
}

/// A model-scoped window (Claude's per-model weeklies).
fn model_window(label: &str, model: &str, used: f64) -> WindowReading {
    WindowReading {
        label: label.to_string(),
        model: Some(model.to_string()),
        used_percent: used,
        resets_at: None,
        window_seconds: None,
    }
}

fn agent(id: &str, windows: Vec<WindowReading>) -> AgentWindows {
    AgentWindows {
        agent_id: id.to_string(),
        plan: Some("Max".to_string()),
        readable: true,
        windows,
    }
}

fn unreadable(id: &str) -> AgentWindows {
    AgentWindows {
        agent_id: id.to_string(),
        plan: None,
        readable: false,
        windows: Vec::new(),
    }
}

fn armed() -> RetryPolicy {
    RetryPolicy {
        enabled: true,
        ..RetryPolicy::default()
    }
}

// ── Headroom is the MINIMUM over gating windows ──────────────────────────────

#[test]
fn headroom_is_the_tightest_window_not_the_loosest() {
    // The bug this whole module is shaped around: a plan whose 5-hour window
    // just reset looks completely free if you take the maximum, while its weekly
    // window is one turn from empty. Retrying there fails exactly like the turn
    // it replaced.
    let a = agent(
        "acp:claude",
        vec![window("Session", 0.0, None), window("Weekly", 99.5, None)],
    );
    assert_eq!(a.headroom_percent(None), Some(0.5));
}

#[test]
fn an_unreadable_agent_reports_no_headroom() {
    // Not zero. Zero would mean "spent", which is a claim; unreadable is an
    // absence of information and must never be read as either.
    assert_eq!(unreadable("acp:grok").headroom_percent(None), None);
}

#[test]
fn an_agent_with_no_windows_reports_no_headroom() {
    assert_eq!(agent("acp:codex", vec![]).headroom_percent(None), None);
}

// ── Model scoping ────────────────────────────────────────────────────────────

#[test]
fn a_spent_per_model_window_only_gates_that_model() {
    let a = agent(
        "acp:claude",
        vec![
            window("Session", 10.0, None),
            model_window("Opus", "Opus", 100.0),
        ],
    );
    // A turn on Opus is blocked by the Opus cap...
    assert_eq!(
        a.headroom_percent(Some("claude-opus-4-20250514")),
        Some(0.0)
    );
    // ...but a Sonnet turn is not.
    assert_eq!(a.headroom_percent(Some("claude-sonnet-4")), Some(90.0));
}

#[test]
fn an_unknown_model_ignores_per_model_windows() {
    // Deliberate: folding a per-model cap in when we cannot attribute the turn
    // would condemn a whole plan for a model it may never touch.
    let a = agent(
        "acp:claude",
        vec![
            window("Session", 10.0, None),
            model_window("Opus", "Opus", 100.0),
        ],
    );
    assert_eq!(a.headroom_percent(None), Some(90.0));
}

#[test]
fn model_matching_survives_punctuation_and_case() {
    assert!(models_match("Opus", "claude-opus-4-20250514"));
    assert!(models_match("GPT-5", "gpt5"));
    assert!(!models_match("Opus", "claude-sonnet-4"));
    assert!(!models_match("", "anything"));
}

// ── The gate: is it really a cap? ────────────────────────────────────────────

#[test]
fn a_disabled_policy_never_speaks() {
    let readings = vec![agent("acp:claude", vec![window("Session", 100.0, None)])];
    assert_eq!(
        decide(
            &RetryPolicy::default(),
            "acp:claude",
            None,
            FailureKind::Other,
            &readings
        ),
        Verdict::Stand
    );
}

#[test]
fn a_failure_with_headroom_left_is_not_a_cap() {
    // The turn failed for some other reason — a crashed CLI, a network blip.
    // Rerouting on that would move users off their chosen agent for no reason.
    let readings = vec![
        agent("acp:claude", vec![window("Session", 12.0, None)]),
        agent("acp:codex", vec![window("Session", 1.0, None)]),
    ];
    assert_eq!(
        decide(&armed(), "acp:claude", None, FailureKind::Other, &readings),
        Verdict::Stand
    );
}

#[test]
fn an_unconfirmable_failure_stands() {
    // The failed agent's own windows are unreadable, so we cannot say a cap was
    // hit. Abstain rather than guess.
    let readings = vec![
        unreadable("acp:claude"),
        agent("acp:codex", vec![window("Session", 1.0, None)]),
    ];
    assert_eq!(
        decide(&armed(), "acp:claude", None, FailureKind::Other, &readings),
        Verdict::Stand
    );
}

#[test]
fn a_failed_agent_missing_from_the_readings_stands() {
    let readings = vec![agent("acp:codex", vec![window("Session", 1.0, None)])];
    assert_eq!(
        decide(&armed(), "acp:claude", None, FailureKind::Other, &readings),
        Verdict::Stand
    );
}

// ── Rerouting ────────────────────────────────────────────────────────────────

#[test]
fn a_capped_turn_reroutes_to_the_agent_with_the_most_room() {
    let readings = vec![
        agent("acp:claude", vec![window("Session", 100.0, None)]),
        agent("acp:codex", vec![window("Session", 60.0, None)]),
        agent("acp:copilot", vec![window("Session", 10.0, None)]),
    ];
    let verdict = decide(&armed(), "acp:claude", None, FailureKind::Other, &readings);
    assert_eq!(verdict.reroute_agent(), Some("acp:copilot"));
    assert!(
        verdict.note().unwrap().contains("Copilot"),
        "note must name the agent it moved to: {:?}",
        verdict.note()
    );
}

#[test]
fn reroute_skips_a_candidate_whose_other_window_is_spent() {
    // Codex looks free on its session window and is out of weekly. The naive
    // max-over-windows pick sends the retry straight into another cap.
    let readings = vec![
        agent("acp:claude", vec![window("Session", 100.0, None)]),
        agent(
            "acp:codex",
            vec![window("Session", 0.0, None), window("Weekly", 99.9, None)],
        ),
        agent("acp:copilot", vec![window("Session", 40.0, None)]),
    ];
    assert_eq!(
        decide(&armed(), "acp:claude", None, FailureKind::Other, &readings).reroute_agent(),
        Some("acp:copilot")
    );
}

#[test]
fn reroute_never_picks_the_agent_that_just_failed() {
    let readings = vec![agent("acp:claude", vec![window("Session", 100.0, None)])];
    let verdict = decide(&armed(), "acp:claude", None, FailureKind::Other, &readings);
    assert_eq!(verdict.reroute_agent(), None);
}

#[test]
fn reroute_ignores_unreadable_and_unsupported_agents() {
    // A signed-out Grok is not a fallback. Treating an unreadable snapshot as
    // "plenty of room" would send every capped turn to an agent that cannot run.
    let readings = vec![
        agent("acp:claude", vec![window("Session", 100.0, None)]),
        unreadable("acp:grok"),
    ];
    assert!(matches!(
        decide(&armed(), "acp:claude", None, FailureKind::Other, &readings),
        Verdict::NoCandidate { .. }
    ));
}

#[test]
fn an_explicit_candidate_list_is_priority_order_not_just_a_filter() {
    // Codex is listed first, Copilot has more room. The user's stated order wins
    // — otherwise the list would silently be a set.
    let policy = RetryPolicy {
        enabled: true,
        candidates: vec!["acp:codex".into(), "acp:copilot".into()],
        ..RetryPolicy::default()
    };
    let readings = vec![
        agent("acp:claude", vec![window("Session", 100.0, None)]),
        agent("acp:codex", vec![window("Session", 50.0, None)]),
        agent("acp:copilot", vec![window("Session", 5.0, None)]),
    ];
    assert_eq!(
        decide(&policy, "acp:claude", None, FailureKind::Other, &readings).reroute_agent(),
        Some("acp:codex")
    );
}

#[test]
fn an_agent_outside_the_candidate_list_is_never_used() {
    let policy = RetryPolicy {
        enabled: true,
        candidates: vec!["acp:codex".into()],
        ..RetryPolicy::default()
    };
    let readings = vec![
        agent("acp:claude", vec![window("Session", 100.0, None)]),
        agent("acp:codex", vec![window("Session", 100.0, None)]),
        agent("acp:copilot", vec![window("Session", 0.0, None)]),
    ];
    // Codex is listed but spent; Copilot has room but is not listed.
    assert!(matches!(
        decide(&policy, "acp:claude", None, FailureKind::Other, &readings),
        Verdict::Wait { .. } | Verdict::NoCandidate { .. }
    ));
}

#[test]
fn ties_break_deterministically_on_agent_id() {
    let readings = vec![
        agent("acp:claude", vec![window("Session", 100.0, None)]),
        agent("acp:copilot", vec![window("Session", 30.0, None)]),
        agent("acp:codex", vec![window("Session", 30.0, None)]),
    ];
    let first = decide(&armed(), "acp:claude", None, FailureKind::Other, &readings)
        .reroute_agent()
        .map(str::to_owned);
    assert_eq!(first.as_deref(), Some("acp:codex"));
}

// ── Notify-only ──────────────────────────────────────────────────────────────

#[test]
fn notify_only_finds_the_agent_but_reroutes_nothing() {
    let policy = RetryPolicy {
        enabled: true,
        notify_only: true,
        ..RetryPolicy::default()
    };
    let readings = vec![
        agent("acp:claude", vec![window("Session", 100.0, None)]),
        agent("acp:codex", vec![window("Session", 20.0, None)]),
    ];
    let verdict = decide(&policy, "acp:claude", None, FailureKind::Other, &readings);
    assert_eq!(
        verdict.reroute_agent(),
        None,
        "notify-only must not reroute"
    );
    // `Held`, not `NoCandidate`: a plan with room WAS found. The distinction is
    // what stops a working notify-only setup from rendering as "nothing could be
    // done" — the client picks its icon off this variant.
    match &verdict {
        Verdict::Held {
            agent_id,
            headroom_percent,
            ..
        } => {
            assert_eq!(agent_id, "acp:codex");
            assert!((*headroom_percent - 80.0).abs() < f64::EPSILON);
        }
        other => panic!("expected Held, got {other:?}"),
    }
    let note = verdict.note().expect("notify-only still explains");
    assert!(
        note.contains("Codex"),
        "note names the agent that had room: {note}"
    );
    assert!(
        note.contains("notify only"),
        "note says why nothing moved: {note}"
    );
}

// ── Waiting ──────────────────────────────────────────────────────────────────

#[test]
fn a_wait_is_ordered_by_reset_time_not_window_length() {
    // The trap: a 5-hour window is *shorter*, so sorting by length picks it. But
    // it only just refilled to spent, while the weekly rolls over in minutes.
    let readings = vec![AgentWindows {
        agent_id: "acp:claude".into(),
        plan: Some("Max".into()),
        readable: true,
        windows: vec![
            WindowReading {
                label: "Session".into(),
                model: None,
                used_percent: 100.0,
                resets_at: Some("2026-08-01T18:00:00Z".into()),
                window_seconds: Some(5 * 3600),
            },
            WindowReading {
                label: "Weekly".into(),
                model: None,
                used_percent: 100.0,
                resets_at: Some("2026-08-01T14:10:00Z".into()),
                window_seconds: Some(7 * 24 * 3600),
            },
        ],
    }];
    match decide(&armed(), "acp:claude", None, FailureKind::Other, &readings) {
        // Carried verbatim, not re-serialized: the vendor's own string is what
        // any later scheduling would have to hand back.
        Verdict::Wait { resets_at, .. } => assert_eq!(resets_at, "2026-08-01T14:10:00Z"),
        other => panic!("expected a wait, got {other:?}"),
    }
}

#[test]
fn a_window_with_an_unknown_reset_is_not_schedulable() {
    // Absent `resets_at` must not sort as "now" — the same abstain rule the
    // proactive module states for an absent signal.
    let readings = vec![agent("acp:claude", vec![window("Session", 100.0, None)])];
    assert!(matches!(
        decide(&armed(), "acp:claude", None, FailureKind::Other, &readings),
        Verdict::NoCandidate { .. }
    ));
}

#[test]
fn a_wait_ignores_windows_that_are_not_actually_spent() {
    // The session window resets sooner but is not what is blocking; reporting it
    // would promise relief that does not come.
    let readings = vec![AgentWindows {
        agent_id: "acp:claude".into(),
        plan: None,
        readable: true,
        windows: vec![
            WindowReading {
                label: "Session".into(),
                model: None,
                used_percent: 100.0,
                resets_at: Some("2026-08-01T20:00:00Z".into()),
                window_seconds: None,
            },
            WindowReading {
                label: "Weekly".into(),
                model: None,
                used_percent: 3.0,
                resets_at: Some("2026-08-01T09:00:00Z".into()),
                window_seconds: None,
            },
        ],
    }];
    match decide(&armed(), "acp:claude", None, FailureKind::Other, &readings) {
        Verdict::Wait {
            resets_at, note, ..
        } => {
            assert_eq!(resets_at, "2026-08-01T20:00:00Z");
            assert!(
                note.contains("session"),
                "note names the spent window: {note}"
            );
        }
        other => panic!("expected a wait, got {other:?}"),
    }
}

#[test]
fn a_wait_reports_the_soonest_reset_across_every_readable_plan() {
    let readings = vec![
        agent(
            "acp:claude",
            vec![window("Session", 100.0, Some("2026-08-01T18:00:00Z"))],
        ),
        agent(
            "acp:codex",
            vec![window("Weekly", 100.0, Some("2026-08-01T12:30:00Z"))],
        ),
    ];
    match decide(&armed(), "acp:claude", None, FailureKind::Other, &readings) {
        Verdict::Wait { agent_id, .. } => assert_eq!(agent_id, "acp:codex"),
        other => panic!("expected a wait, got {other:?}"),
    }
}

// ── Config ───────────────────────────────────────────────────────────────────

#[test]
fn an_unreadable_pref_disables_rather_than_erroring() {
    let policy = RetryPolicy::parse("{ not json");
    assert!(
        !policy.enabled,
        "a corrupt setting must degrade to today's behaviour"
    );
    assert_eq!(RetryPolicy::parse(""), RetryPolicy::default());
}

#[test]
fn a_stored_policy_round_trips() {
    let policy = RetryPolicy {
        enabled: true,
        notify_only: true,
        candidates: vec!["acp:codex".into()],
        spent_below_percent: 5.0,
    };
    assert_eq!(RetryPolicy::parse(&policy.to_pref_value()), policy);
}

#[test]
fn an_out_of_range_threshold_is_clamped() {
    let policy = RetryPolicy {
        enabled: true,
        spent_below_percent: 140.0,
        ..RetryPolicy::default()
    };
    assert_eq!(policy.spent_threshold(), 100.0);
    let negative = RetryPolicy {
        spent_below_percent: -5.0,
        ..RetryPolicy::default()
    };
    assert_eq!(negative.spent_threshold(), 0.0);
    let nan = RetryPolicy {
        spent_below_percent: f64::NAN,
        ..RetryPolicy::default()
    };
    assert_eq!(nan.spent_threshold(), DEFAULT_SPENT_BELOW_PERCENT);
}

#[test]
fn the_threshold_decides_what_counts_as_spent() {
    let generous = RetryPolicy {
        enabled: true,
        spent_below_percent: 25.0,
        ..RetryPolicy::default()
    };
    let readings = vec![
        agent("acp:claude", vec![window("Session", 80.0, None)]),
        agent("acp:codex", vec![window("Session", 10.0, None)]),
    ];
    // 20% left is above the 2% default (no cap) but below a 25% threshold.
    assert_eq!(
        decide(&armed(), "acp:claude", None, FailureKind::Other, &readings),
        Verdict::Stand
    );
    assert_eq!(
        decide(&generous, "acp:claude", None, FailureKind::Other, &readings).reroute_agent(),
        Some("acp:codex")
    );
}

// ── Failure classification ───────────────────────────────────────────────────

#[test]
fn a_429_is_a_rate_limit_whatever_the_body_says() {
    assert_eq!(gateway_failure_kind(429, None), FailureKind::RateLimited);
}

#[test]
fn the_gateways_typed_rate_limit_errors_are_recognised() {
    // Pinned against `apps/gateway/src/error.rs`: these two strings are the
    // contract, the human message is not.
    assert_eq!(
        gateway_failure_kind(429, Some("provider_rate_limited")),
        FailureKind::RateLimited
    );
    assert_eq!(
        gateway_failure_kind(200, Some("rate_limit_exceeded")),
        FailureKind::RateLimited
    );
    assert_eq!(
        gateway_failure_kind(403, Some("policy_violation")),
        FailureKind::Other
    );
    assert_eq!(gateway_failure_kind(502, None), FailureKind::Other);
}

#[test]
fn the_error_type_is_read_out_of_the_gateway_envelope() {
    let body = r#"{"error":{"message":"Upstream provider rate limit reached.","type":"provider_rate_limited"}}"#;
    assert_eq!(
        error_type_of(body).as_deref(),
        Some("provider_rate_limited")
    );
    assert_eq!(error_type_of("not json"), None);
    assert_eq!(error_type_of(r#"{"error":{"message":"x"}}"#), None);
}

// ── Display ──────────────────────────────────────────────────────────────────

#[test]
fn agent_ids_render_as_vendor_names() {
    assert_eq!(display_agent("acp:claude"), "Claude");
    assert_eq!(display_agent("acp:glm"), "GLM");
    assert_eq!(display_agent("my-agent"), "My-agent");
}

// ── The turn watch ───────────────────────────────────────────────────────────

#[test]
fn a_disarmed_watch_records_nothing() {
    let watch = TurnWatch::off();
    assert!(!watch.is_armed());
    watch.mark_content();
    watch.record_failure("acp:claude", None, FailureKind::RateLimited, "boom");
    assert!(watch.retryable().is_none());
}

#[test]
fn an_armed_watch_reports_a_clean_failure_as_retryable() {
    let watch = TurnWatch::armed();
    watch.record_failure(
        "acp:claude",
        Some("claude-opus-4"),
        FailureKind::RateLimited,
        "5-hour limit reached",
    );
    let failure = watch.retryable().expect("clean failure is retryable");
    assert_eq!(failure.agent_id, "acp:claude");
    assert_eq!(failure.model.as_deref(), Some("claude-opus-4"));
    assert_eq!(failure.kind, FailureKind::RateLimited);
    assert_eq!(failure.detail, "5-hour limit reached");
}

#[test]
fn content_already_shown_blocks_a_retry() {
    // Retrying here would stack a fresh answer on top of a half-written one the
    // user is already looking at.
    let watch = TurnWatch::armed();
    watch.mark_content();
    watch.record_failure("acp:claude", None, FailureKind::RateLimited, "boom");
    assert!(watch.retryable().is_none());
}

#[test]
fn content_flushed_after_the_failure_still_blocks_a_retry() {
    // The failure is recorded, then a buffered delta lands before the wrapper
    // asks. Reading `emitted_content` as of *now* is what catches this.
    let watch = TurnWatch::armed();
    watch.record_failure("acp:claude", None, FailureKind::RateLimited, "boom");
    watch.mark_content();
    assert!(watch.retryable().is_none());
}

#[test]
fn a_watch_with_no_failure_is_not_retryable() {
    let watch = TurnWatch::armed();
    assert!(watch.retryable().is_none());
}

#[test]
fn the_first_failure_wins() {
    // A route that fails and then tears down must not have its cause
    // overwritten by the teardown's own error.
    let watch = TurnWatch::armed();
    watch.record_failure(
        "acp:claude",
        None,
        FailureKind::RateLimited,
        "the real cause",
    );
    watch.record_failure("acp:claude", None, FailureKind::Other, "teardown noise");
    assert_eq!(watch.retryable().unwrap().detail, "the real cause");
}

#[test]
fn a_watch_clone_shares_one_state() {
    // The routes clone the handle down into the stream generator; both halves
    // must see the same turn.
    let watch = TurnWatch::armed();
    let inner = watch.clone();
    inner.record_failure("acp:codex", None, FailureKind::RateLimited, "capped");
    assert!(watch.retryable().is_some());
}

// ── The gateway plane's typed witness ────────────────────────────────────────

#[test]
fn a_typed_rate_limit_confirms_the_cap_without_readable_windows() {
    // A gateway 429 against a BYO-key provider: there is no subscription window
    // to read for the agent that failed. Demanding one would make the feature
    // silently inert for exactly the failure the Gateway told us about.
    let readings = vec![
        unreadable("ryu"),
        agent("acp:codex", vec![window("Session", 20.0, None)]),
    ];
    assert_eq!(
        decide(&armed(), "ryu", None, FailureKind::RateLimited, &readings).reroute_agent(),
        Some("acp:codex")
    );
}

#[test]
fn the_same_failure_untyped_is_left_alone() {
    // Identical readings, but the plane carried no typed signal — so there is no
    // witness at all and abstaining is the only honest answer.
    let readings = vec![
        unreadable("ryu"),
        agent("acp:codex", vec![window("Session", 20.0, None)]),
    ];
    assert_eq!(
        decide(&armed(), "ryu", None, FailureKind::Other, &readings),
        Verdict::Stand
    );
}

#[test]
fn a_typed_rate_limit_still_respects_the_disabled_policy() {
    let readings = vec![agent("acp:codex", vec![window("Session", 20.0, None)])];
    assert_eq!(
        decide(
            &RetryPolicy::default(),
            "ryu",
            None,
            FailureKind::RateLimited,
            &readings
        ),
        Verdict::Stand
    );
}

#[test]
fn a_typed_rate_limit_will_not_reroute_to_a_spent_plan() {
    // Being told a limit was hit says nothing about where to go next; the
    // candidate still has to have room.
    let readings = vec![agent("acp:codex", vec![window("Session", 99.9, None)])];
    assert!(matches!(
        decide(&armed(), "ryu", None, FailureKind::RateLimited, &readings),
        Verdict::NoCandidate { .. }
    ));
}

// ── The frame gate ───────────────────────────────────────────────────────────

#[test]
fn frames_are_held_until_content_appears() {
    let mut gate = FrameGate::default();
    assert_eq!(gate.admit(false), FrameAction::Hold);
    assert_eq!(gate.admit(false), FrameAction::Hold);
    assert!(!gate.forwarded_anything());
}

#[test]
fn the_frame_carrying_the_first_content_triggers_the_flush() {
    // The flush must INCLUDE this frame, or the delta that proved content
    // exists is the one frame the client never receives.
    let mut gate = FrameGate::default();
    assert_eq!(gate.admit(false), FrameAction::Hold);
    assert_eq!(gate.admit(true), FrameAction::Flush);
    assert!(gate.forwarded_anything());
}

#[test]
fn the_gate_is_monotonic() {
    // Once open it never closes again — that is what bounds the buffer to the
    // preamble rather than to the size of a whole answer.
    let mut gate = FrameGate::default();
    assert_eq!(gate.admit(true), FrameAction::Flush);
    assert_eq!(gate.admit(false), FrameAction::Pass);
    assert_eq!(gate.admit(false), FrameAction::Pass);
}

#[test]
fn a_turn_that_never_forwarded_is_replaceable() {
    // The wrapper only considers a retry when nothing reached the client; a gate
    // that never opened is exactly that condition.
    let mut gate = FrameGate::default();
    for _ in 0..5 {
        assert_eq!(gate.admit(false), FrameAction::Hold);
    }
    assert!(!gate.forwarded_anything());
}

// ── Every verdict a client can receive carries a sentence ────────────────────

#[test]
fn every_surfaced_verdict_has_a_note() {
    // The failover wrapper renders `note()` as a visible text block, which is the
    // ONLY explanation a TUI / native / island user gets — they do not render
    // `data-*` frames. A verdict that reached a client with no note would mean an
    // answer silently arriving from a different subscription.
    let spent = vec![agent("acp:claude", vec![window("Session", 100.0, None)])];
    let with_room = vec![
        agent("acp:claude", vec![window("Session", 100.0, None)]),
        agent("acp:codex", vec![window("Session", 20.0, None)]),
    ];
    let resets = vec![agent(
        "acp:claude",
        vec![window("Session", 100.0, Some("2026-08-01T18:00:00Z"))],
    )];
    let notify = RetryPolicy {
        enabled: true,
        notify_only: true,
        ..RetryPolicy::default()
    };

    for (label, verdict) in [
        (
            "reroute",
            decide(&armed(), "acp:claude", None, FailureKind::Other, &with_room),
        ),
        (
            "held",
            decide(&notify, "acp:claude", None, FailureKind::Other, &with_room),
        ),
        (
            "wait",
            decide(&armed(), "acp:claude", None, FailureKind::Other, &resets),
        ),
        (
            "no_candidate",
            decide(&armed(), "acp:claude", None, FailureKind::Other, &spent),
        ),
    ] {
        assert!(
            !matches!(verdict, Verdict::Stand),
            "{label} case should not stand"
        );
        let note = verdict
            .note()
            .unwrap_or_else(|| panic!("{label} verdict must carry a note"));
        assert!(!note.trim().is_empty(), "{label} note must not be blank");
    }
}
