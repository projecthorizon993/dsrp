//! Converts UTC instants to the user's local zone for display.

use std::sync::atomic::{AtomicBool, Ordering};

/// Whether relative times floor instead of rounding. See [`exact_timestamps`].
static EXACT_TIMESTAMPS: AtomicBool = AtomicBool::new(false);

/// Whether elapsed times are reported exactly rather than rounded to the nearest unit.
///
/// A process-wide flag rather than a parameter because `discord_timestamp` is called from message
/// rendering all over the place, and threading a preference through every one of those call sites to
/// reach one arithmetic helper would be a lot of churn for one rounding step. The same pattern as
/// `design`'s theme variant: set once per frame from the saved preference.
pub fn exact_timestamps() -> bool {
	EXACT_TIMESTAMPS.load(Ordering::Relaxed)
}

/// Applies [`exact_timestamps`]. Called once per frame alongside the other preference syncs.
pub fn set_exact_timestamps(exact: bool) {
	EXACT_TIMESTAMPS.store(exact, Ordering::Relaxed);
}

/// Shifts `instant` to the local offset in effect at that moment; falls back to UTC.
pub fn local(instant: time::OffsetDateTime) -> time::OffsetDateTime {
	// Tests pin UTC so date-boundary assertions hold on every machine.
	let offset = if cfg!(test) {
		time::UtcOffset::UTC
	} else {
		time::UtcOffset::local_offset_at(instant).unwrap_or(time::UtcOffset::UTC)
	};
	instant.to_offset(offset)
}

/// Current wall-clock time in the local zone.
pub fn now() -> time::OffsetDateTime {
	local(time::OffsetDateTime::now_utc())
}

/// Renders a Discord `<t:seconds:style>` reference the way the official client does: absolute
/// styles in the viewer's zone, `R` as a coarse relative phrase that refreshes on every frame.
pub fn discord_timestamp(seconds: i64, style: u8) -> Option<String> {
	let instant = time::OffsetDateTime::from_unix_timestamp(seconds).ok()?;
	if style == b'R' {
		return Some(relative(
			instant - time::OffsetDateTime::now_utc(),
			exact_timestamps(),
		));
	}
	let at = local(instant);
	let date = at.date();
	let clock = format!("{:02}:{:02}", at.hour(), at.minute());
	Some(match style {
		b't' => clock,
		b'T' => format!("{clock}:{:02}", at.second()),
		b'd' => format!(
			"{:02}/{:02}/{}",
			u8::from(date.month()),
			date.day(),
			date.year()
		),
		b'D' => format!("{} {}, {}", date.month(), date.day(), date.year()),
		b'F' => format!(
			"{}, {} {}, {} {clock}",
			date.weekday(),
			date.month(),
			date.day(),
			date.year()
		),
		_ => format!("{} {}, {} {clock}", date.month(), date.day(), date.year()),
	})
}
/// "… ago" for a past instant, measured against the current clock.
pub(crate) fn ago(instant: time::OffsetDateTime) -> String {
	relative(
		instant - time::OffsetDateTime::now_utc(),
		exact_timestamps(),
	)
}
/// "1 day" rather than "1 days".
///
/// Rounding almost never yields 1 for the larger units - it is what pushes 1.4 days up to "2 days" -
/// so the templates could get away with a bare plural. Flooring cannot, so every unit goes through
/// here.
fn plural(value: u64, unit: &str) -> String {
	if value == 1 {
		format!("1 {unit}")
	} else {
		format!("{value} {unit}s")
	}
}

/// Coarse "in …"/"… ago" phrasing with the same thresholds the web client's relative times use.
///
/// `exact` drops the rounding: the default rounds each unit to nearest, so 47 hours reads "2 days",
/// which is what the web client does and what a reader expects. With exact timestamps on, it floors
/// instead, so the number never claims more time than has actually passed.
fn relative(delta: time::Duration, exact: bool) -> String {
	let seconds = delta.whole_seconds();
	let ahead = seconds > 0;
	let seconds = seconds.unsigned_abs();
	let unit = |value: u64, size: u64| {
		if exact {
			value / size
		} else {
			(value + size / 2) / size
		}
	};
	let minutes = unit(seconds, 60);
	let hours = unit(minutes, 60);
	let days = unit(hours, 24);
	let months = unit(days, 30);
	let years = unit(days, 365);
	let amount = if seconds < 45 {
		"a few seconds".to_owned()
	} else if seconds < 90 {
		"a minute".to_owned()
	} else if minutes < 45 {
		plural(minutes, "minute")
	} else if minutes < 90 {
		"an hour".to_owned()
	} else if hours < 22 {
		plural(hours, "hour")
	} else if hours < 36 {
		"a day".to_owned()
	} else if days < 26 {
		plural(days, "day")
	} else if days < 46 {
		"a month".to_owned()
	} else if days < 320 {
		plural(months, "month")
	} else if days < 548 {
		"a year".to_owned()
	} else {
		plural(years, "year")
	};
	if ahead {
		format!("in {amount}")
	} else {
		format!("{amount} ago")
	}
}

#[cfg(test)]
mod tests {
	#[test]
	fn formats_every_discord_timestamp_style() {
		let at = 1_700_000_000;
		for (style, expected) in [
			(b't', "22:13"),
			(b'T', "22:13:20"),
			(b'd', "11/14/2023"),
			(b'D', "November 14, 2023"),
			(b'f', "November 14, 2023 22:13"),
			(b'F', "Tuesday, November 14, 2023 22:13"),
		] {
			assert_eq!(
				super::discord_timestamp(at, style).as_deref(),
				Some(expected)
			);
		}
		assert_eq!(super::discord_timestamp(i64::MAX, b'f'), None);
	}

	/// These are the cases where the two modes actually disagree, chosen because rounding pushes the
	/// value across a branch threshold rather than merely changing the number.
	#[test]
	fn exact_timestamps_floor_where_the_default_rounds() {
		use time::Duration;
		// 47 hours: rounding takes it to 2 days, flooring leaves 1.
		assert_eq!(super::relative(-Duration::hours(47), false), "2 days ago");
		assert_eq!(super::relative(-Duration::hours(47), true), "1 day ago");
		// 91 seconds: rounding takes it to 2 minutes, flooring leaves 1.
		assert_eq!(
			super::relative(-Duration::seconds(91), false),
			"2 minutes ago"
		);
		assert_eq!(
			super::relative(-Duration::seconds(91), true),
			"1 minute ago"
		);
	}

	#[test]
	fn both_modes_agree_away_from_a_rounding_boundary() {
		use time::Duration;
		// Well inside a unit, so neither mode has anything to round.
		for delta in [-Duration::hours(5), -Duration::hours(20)] {
			assert_eq!(super::relative(delta, false), super::relative(delta, true));
		}
		assert_eq!(super::relative(-Duration::hours(5), true), "5 hours ago");
	}

	/// Flooring is the only mode that can produce 1 for the larger units, so it is the only mode
	/// that can produce a singular. A bare plural template would render "1 days" here.
	#[test]
	fn exact_timestamps_read_naturally_when_a_unit_floors_to_one() {
		use time::Duration;
		for (delta, expected) in [
			(-Duration::hours(47), "1 day ago"),
			(-Duration::seconds(91), "1 minute ago"),
			(-Duration::hours(20), "20 hours ago"),
		] {
			assert_eq!(super::relative(delta, true), expected);
		}
		// The default never reaches a singular for these units, and must not gain one.
		assert_eq!(super::relative(-Duration::hours(47), false), "2 days ago");
	}
}
