//! A small append-only diagnostics log for events a user can report but not see.
//!
//! Gateway close codes and session-ending failures decide whether the client
//! reconnects, and the UI reports neither. The env-var diagnostics print to
//! stderr, which a windowed application has no console to write to, so these
//! events otherwise leave no trace at all. This sink records them next to the
//! client's other on-disk state so a bug report can be matched to a cause.
//!
//! Writing is best effort. A full disk, a read-only directory or a revoked
//! permission must never affect the session, so every failure here is dropped.

use std::{
	fs::OpenOptions,
	io::Write,
	path::PathBuf,
	sync::{OnceLock, RwLock},
	time::{SystemTime, UNIX_EPOCH},
};

const FILE_NAME: &str = "dsrp-run.log";
/// Cap the file so a long-running client cannot grow it without limit.
const MAX_BYTES: u64 = 4 * 1024 * 1024;

/// Directory the owner resolved once at startup, if logging is wanted.
fn target() -> &'static RwLock<Option<PathBuf>> {
	static TARGET: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();
	TARGET.get_or_init(|| RwLock::new(None))
}

/// Point the log at `directory`, or disable it when `directory` is `None`.
///
/// The owner owns data-directory resolution, so it passes the result in rather
/// than this module growing a dependency on the store.
pub fn use_directory(directory: Option<PathBuf>) {
	if let Ok(mut target) = target().write() {
		*target = directory;
	}
}

/// Path of the active log file, for surfacing it in a bug report.
pub fn path() -> Option<PathBuf> {
	target().read().ok()?.clone()
}

/// Record one diagnostic line. Callers must not depend on this succeeding.
///
/// The timestamp is milliseconds since the Unix epoch rather than a formatted
/// date, so the log needs no date-time dependency.
pub fn record(component: &str, message: &str) {
	let Ok(target) = target().read() else { return };
	let Some(directory) = target.as_ref() else {
		return;
	};
	if std::fs::create_dir_all(directory).is_err() {
		return;
	}
	let path = directory.join(FILE_NAME);
	// Rotate by truncating once the cap is reached. The log is diagnostic, so
	// losing the oldest lines beats growing the file without limit.
	if std::fs::metadata(&path).is_ok_and(|meta| meta.len() >= MAX_BYTES) {
		let _ = std::fs::write(&path, b"");
	}
	let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) else {
		return;
	};
	let millis = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map_or(0, |d| d.as_millis());
	// Newlines inside a message would forge extra entries in the log.
	let message = message.replace(['\r', '\n'], " ");
	let _ = writeln!(file, "{millis}\t{component}\t{message}");
}
