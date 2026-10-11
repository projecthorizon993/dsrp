//! Built-in mods ported from Vencord's plugin list.
//!
//! Serein's plugin system is Wasm-based: a plugin package carries a Wasm module with no imports, and
//! `Package::validate` admits nothing else. A Rust mod therefore cannot be registered as a plugin at
//! all - it has to be a built-in module with a native code path. This module is the catalog of those,
//! so the settings page can say which exist and the host can drive the ones with a switch.
//!
//! # The catalog is a claim, so it has to be kept true
//!
//! The source of truth for *which* mods exist is Vencord's `src/plugins`. Every entry in
//! [`Plugin::ALL`] carries the upstream id and display name, so a familiar name maps to a familiar
//! behaviour and one that has not been ported says so plainly instead of quietly vanishing.
//!
//! Porting a mod is not the same as describing one. An entry here may only claim [`Port::Native`] or
//! [`Port::Partial`] if a real code path in this client does that thing, and it may only carry a
//! [`Plugin::setting`] if flipping a switch actually changes behaviour.
//!
//! Classification is by what is *possible in a native client*, never by how Vencord implements a
//! plugin. A plugin that injects a stylesheet is describing its own technique, not a limit here: six
//! plugins this client already implements natively - the character counter, call timer, platform
//! indicators, mark-server-read, connections and voice participants - are all stylesheet-based in
//! Vencord. So [`Port::Planned`] means "portable, not built yet" and covers most of the catalog,
//! while [`Port::Unsupported`] is reserved for the handful whose entire deliverable is a web page or
//! Vencord's own backend. Anything else would be a backlog item dressed up as a refusal.
//!
//! A catalog written ahead of the implementations is worse than an empty one, because it makes the
//! settings page lie on the user's behalf.
//!
//! That is also why [`Plugin::setting`] exists instead of a bare "toggleable" flag: most native
//! behaviour is simply how this client renders, with nothing to switch. A switch on such an entry
//! would be a control that does nothing.

/// A preference a mod's switch drives.
///
/// Adding a variant is how a genuinely switchable mod enters the catalog â€” one arm here, one in the
/// settings page, and the id mapped in the generator. A mod with no variant here is not switchable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Setting {
	/// The `local_nitro` entitlement override.
	LocalNitro,
	/// Listing channels the account cannot access.
	ShowHiddenChannels,
	/// Holding the typing indicator still.
	NoTypingAnimation,
	/// Reporting elapsed time without rounding.
	/// Reporting elapsed time without rounding.
	ExactTimestamps,
	/// Carrying the sent time on a replied-message preview.
	ReplyTimestamp,
	/// Painting folder tiles without the server-icon mosaic.
	PlainFolderIcon,
	/// Leaving server emoji out of the `:` autocomplete list.
	NoServerEmojis,
	/// Copying Unicode emoji as `:shortcode:`.
	CopyEmojiMarkdown,
}

/// How faithfully a Vencord plugin can exist here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Port {
	/// Implemented, and simply how this client behaves. There is nothing to switch.
	Native,
	/// Implemented behind a switch. Not currently used; see [`Plugin::setting`].
	NativeOptIn,
	/// Implemented, but not the way the mod does it.
	Partial,
	/// Portable in principle, not built yet. This is the porting backlog, not a refusal.
	Planned,
	/// No client behaviour left to reproduce. [`Plugin::note`] says why.
	Unsupported,
}

impl Port {
	/// Whether this status means the client really does the thing.
	pub const fn is_implemented(self) -> bool {
		matches!(self, Self::Native | Self::NativeOptIn | Self::Partial)
	}

	/// Whether this is worth porting, as opposed to genuinely out of reach.
	pub const fn is_portable(self) -> bool {
		!matches!(self, Self::Unsupported)
	}

	/// Short label for reports.
	pub const fn label(self) -> &'static str {
		match self {
			Self::Native => "native",
			Self::NativeOptIn => "opt-in",
			Self::Partial => "partial",
			Self::Planned => "planned",
			Self::Unsupported => "unsupported",
		}
	}
}

/// A Vencord plugin, with what became of it here.
#[derive(Debug, Clone, Copy)]
pub struct Plugin {
	/// The Vencord id, kept identical so a familiar name maps to a familiar plugin.
	pub id: &'static str,
	/// Vencord's own display name.
	pub name: &'static str,
	/// Vencord's own one-line description.
	pub description: &'static str,
	/// What this client can do with it.
	pub port: Port,
	/// What this client does, or why it cannot.
	pub note: &'static str,
	/// The preference this mod's switch drives, or `None` when there is no switch.
	///
	/// `None` is the common case and is not a gap: native behaviour is usually just how this client
	/// renders. A `Some` here is a promise that flipping that switch does something.
	pub setting: Option<Setting>,
}

mod catalog;
use catalog::ALL;

impl Plugin {
	/// Every Vencord plugin, with the port verdict for each.
	pub const ALL: &'static [Plugin] = ALL;

	/// Whether the settings page should offer a switch for this mod.
	#[must_use]
	pub const fn is_toggleable(&self) -> bool {
		self.setting.is_some()
	}
}

/// Search the catalog by id or name. `None` when nothing matches.
#[must_use]
pub fn find(query: &str) -> Option<&'static Plugin> {
	let needle = query.trim().to_ascii_lowercase();
	if needle.is_empty() {
		return None;
	}
	Plugin::ALL.iter().find(|plugin| {
		plugin.id.to_ascii_lowercase() == needle
			|| plugin.name.to_ascii_lowercase() == needle
			|| plugin.name.to_ascii_lowercase().replace(' ', "") == needle.replace(' ', "")
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn every_catalog_entry_is_unique_and_described() {
		let mut ids = std::collections::BTreeSet::new();
		for plugin in Plugin::ALL {
			assert!(ids.insert(plugin.id), "duplicate id {}", plugin.id);
			assert!(!plugin.name.is_empty(), "{} has no name", plugin.id);
			assert!(
				!plugin.description.is_empty(),
				"{} has no description",
				plugin.id
			);
			// Every entry, supported or not, has to justify itself: what it does, or why it cannot.
			// An unsupported entry with no reason reads as a TODO, and an implemented entry with no
			// behaviour reads as a placeholder.
			assert!(
				!plugin.note.is_empty(),
				"{} has no note explaining its status",
				plugin.id
			);
		}
		// The full Vencord plugin set, not a curated subset.
		assert_eq!(Plugin::ALL.len(), 166);
	}

	#[test]
	fn a_switch_is_only_ever_offered_where_one_would_work() {
		// The invariant that keeps the settings page honest: a switch appears if and only if a real
		// preference drives it. Without this, adding a `setting` to an unimplemented entry would put
		// a live-looking control in front of the user that changes nothing.
		for plugin in Plugin::ALL {
			if plugin.is_toggleable() {
				assert!(
					plugin.port.is_implemented(),
					"{} offers a switch but is not implemented",
					plugin.id
				);
			}
		}
		// The converse is deliberately not asserted: native behaviour with no switch is the normal
		// case, since most of it is just how this client renders.
	}

	#[test]
	fn unsupported_is_reserved_for_things_that_cannot_work_here() {
		// The guard against regressing into the old bug, where 146 of 166 entries were called
		// unsupported because Vencord implemented them with a stylesheet. Most of the catalog is
		// portable; only a handful target a web page or Vencord's own backend. If this count climbs,
		// the classification has started describing implementation technique again.
		let unsupported = Plugin::ALL
			.iter()
			.filter(|p| p.port == Port::Unsupported)
			.count();
		assert!(
			unsupported <= 15,
			"{unsupported} entries claim they cannot work here; that is a backlog wearing a refusal"
		);
		for plugin in Plugin::ALL.iter().filter(|p| p.port == Port::Unsupported) {
			assert!(
				!plugin.note.is_empty(),
				"{} is unsupported with no reason",
				plugin.id
			);
		}
	}

	#[test]
	fn planned_work_is_a_backlog_not_a_refusal() {
		// Planned entries are portable, so they have to stay visibly distinct from Unsupported. A
		// user reading "planned" learns the mod is worth doing; one reading "unsupported" learns it
		// is not. Collapsing the two is what made the first version of this catalog useless.
		let planned = Plugin::ALL
			.iter()
			.filter(|p| p.port == Port::Planned)
			.count();
		assert!(planned > 0);
		for plugin in Plugin::ALL.iter().filter(|p| p.port == Port::Planned) {
			assert!(
				plugin.port.is_portable(),
				"{} is planned but not portable",
				plugin.id
			);
			assert!(
				plugin.setting.is_none(),
				"{} is planned but claims a switch",
				plugin.id
			);
		}
	}

	#[test]
	fn implemented_entries_name_a_real_status() {
		let implemented = Plugin::ALL
			.iter()
			.filter(|p| p.port.is_implemented())
			.count();
		assert!(implemented > 0, "nothing is ported, which cannot be right");
		// Sanity-bound the claim. These are exact counts on purpose: if a port lands, the count moves
		// and whoever moved it has to update this, which is the point.
		assert_eq!(
			implemented, 29,
			"implemented count changed; update this test"
		);
	}

	#[test]
	fn a_native_plugin_offers_no_switch() {
		// This is the case that used to be wrong: native behaviour is simply how the client renders,
		// so offering a switch for it would be a control that does nothing.
		let always_on = Plugin::ALL
			.iter()
			.find(|p| p.port == Port::Native)
			.expect("there is at least one native plugin");
		assert!(!always_on.is_toggleable());
		assert!(always_on.setting.is_none());
	}

	#[test]
	fn every_switch_is_backed_by_a_distinct_preference() {
		// Two mods writing the same preference would make the page quietly wrong: turning one off
		// would turn the other off too, and neither entry could explain why.
		let mut seen = std::collections::BTreeSet::new();
		for plugin in Plugin::ALL.iter().filter(|p| p.is_toggleable()) {
			let setting = plugin.setting.expect("toggleable implies a setting");
			assert!(
				seen.insert(setting),
				"{} shares {:?} with another mod",
				plugin.id,
				setting
			);
		}
	}

	#[test]
	fn find_is_forgiving_about_spacing_and_case() {
		let plugin = Plugin::ALL.first().expect("non-empty catalog");
		assert_eq!(find(plugin.id).map(|p| p.id), Some(plugin.id));
		assert_eq!(
			find(plugin.id.to_uppercase().as_str()).map(|p| p.id),
			Some(plugin.id)
		);
		assert_eq!(find("  ").map(|p| p.id), None);
	}

	#[test]
	fn a_name_matches_without_its_spaces() {
		// Vencord's display names are camel case with no spaces, so a query typed as "Message Logger"
		// should still find messageLogger.
		let found = find("Message Logger");
		assert!(
			found.is_some(),
			"'Message Logger' should match a Vencord name"
		);
	}
}
