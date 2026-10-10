//! Emoji information uses the already-loaded server catalog and artwork.
use crate::{design, emoji, emoji_picker};
use std::sync::atomic::{AtomicBool, Ordering};

/// Whether a copied Unicode emoji becomes its `:shortcode:`. See [`markdown_copy`].
static COPY_MARKDOWN: AtomicBool = AtomicBool::new(false);

/// Whether "Copy emoji" writes markup rather than the raw glyph.
///
/// A process-wide flag for the same reason as `local_time`'s exact timestamps: the copy action is
/// reached from markdown inline rendering, and threading a preference through every one of those
/// call sites to reach one string helper would be a lot of churn for one format. Set once per frame
/// alongside the other preference syncs.
pub fn markdown_copy() -> bool {
	COPY_MARKDOWN.load(Ordering::Relaxed)
}

/// Applies [`markdown_copy`]. Called once per frame alongside the other preference syncs.
pub fn set_markdown_copy(markdown: bool) {
	COPY_MARKDOWN.store(markdown, Ordering::Relaxed);
}

/// What "Copy emoji" puts on the clipboard.
///
/// `markdown` is Vencord's `copyEmojiMarkdown`. A custom emoji arrives as `<:name:id>`, which is
/// already the markup the mod produces, so both modes copy it verbatim - that is the same answer,
/// not a skipped case. Unicode emoji are what change: `:thumbsup:` pastes as an emoji on the far
/// side where the raw character often arrives as plain text.
fn copy_payload(text: &str, markdown: bool) -> String {
	let custom = emoji::custom_prefix(text).is_some_and(|(_, len)| len == text.len());
	if markdown && !custom {
		title(text)
	} else {
		text.to_owned()
	}
}

fn title(text: &str) -> String {
	if let Some((_, len)) = emoji::custom_prefix(text)
		&& len == text.len()
	{
		return format!(
			":{}:",
			text.trim_end_matches('>')
				.split(':')
				.nth(1)
				.unwrap_or("emoji")
		);
	}
	emoji_picker::standard()
		.iter()
		.position(|(value, _)| {
			value
				.chars()
				.filter(|c| *c != '\u{fe0f}')
				.eq(text.chars().filter(|c| *c != '\u{fe0f}'))
		})
		.map_or_else(
			|| text.to_owned(),
			|index| emoji_picker::shortcodes()[index].clone(),
		)
}

pub(crate) fn show(
	ui: &mut egui::Ui,
	response: &egui::Response,
	text: &str,
	image: Option<egui::Image<'static>>,
	guilds: &[model::Guild],
) {
	if !ui.is_enabled() {
		egui::Popup::close_id(ui.ctx(), response.id.with("emoji-details"));
		return;
	}
	let colors = design::palette(ui);
	let width = 340.0_f32.min((ui.ctx().content_rect().width() - 40.0).max(160.0));
	egui::Popup::from_toggle_button_response(response)
		.id(response.id.with("emoji-details"))
		.close_behavior(egui::PopupCloseBehavior::CloseOnClickOutside)
		.gap(6.0)
		.width(width)
		.frame(
			egui::Frame::popup(ui.style())
				.fill(colors.raised)
				.inner_margin(16)
				.corner_radius(10),
		)
		.show(|ui| {
			let custom = emoji::custom_prefix(text);
			let source = custom.and_then(|(id, _)| {
				guilds.iter().find_map(|guild| {
					guild
						.emojis
						.as_ref()?
						.iter()
						.find(|emoji| emoji.id == id)
						.map(|emoji| (guild, emoji))
				})
			});
			ui.set_width(width - 32.0);
			ui.horizontal_top(|ui| {
				let (rect, _) =
					ui.allocate_exact_size(egui::Vec2::splat(64.0), egui::Sense::hover());
				if let Some(image) = image {
					let size = image.calc_size(rect.size(), image.size());
					image.paint_at(ui, egui::Rect::from_center_size(rect.center(), size));
				} else {
					ui.painter().text(
						rect.center(),
						egui::Align2::CENTER_CENTER,
						"?",
						egui::FontId::proportional(32.0),
						colors.muted,
					);
				}
				ui.add_space(12.0);
				ui.vertical(|ui| {
					ui.set_width(ui.available_width().max(52.0));
					let name = source
						.map_or_else(|| title(text), |(_, emoji)| format!(":{}:", emoji.name));
					ui.add(
						egui::Label::new(
							design::semibold(ui, name, 16.0).color(colors.text_strong),
						)
						.wrap(),
					);
					if custom.is_some() {
						ui.label(crate::i18n::translate("emoji-details-show-a-custom-emoji"));
						if let Some((guild, _)) = source {
							ui.add(
								egui::Label::new(format!(
									"{} {}",
									crate::i18n::translate("emoji-details-show-from"),
									guild.name
								))
								.wrap(),
							);
						} else {
							ui.add(
								egui::Label::new(crate::i18n::translate(
									"emoji-details-show-source-server-unavailable-in-this-session",
								))
								.wrap(),
							);
						}
					} else {
						ui.add(
							egui::Label::new(crate::i18n::translate(
								"emoji-details-show-a-default-emoji-you-can-use-this-emoji-everywhere-on",
							))
							.wrap(),
						);
					}
				});
			});
		});
	response.context_menu(|ui| {
		if ui
			.button(crate::i18n::translate("emoji-details-show-copy-emoji"))
			.clicked()
		{
			ui.ctx().copy_text(copy_payload(text, markdown_copy()));
			ui.close();
		}
	});
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_unicode_emoji_copies_as_markup_only_when_asked() {
		// The disagreement itself: the two modes have to differ, or the switch is a control that
		// does nothing.
		assert_eq!(copy_payload("👍", false), "👍");
		assert_eq!(copy_payload("👍", true), ":thumbsup:");
		assert_eq!(copy_payload("❤️", true), ":heart:");
	}

	#[test]
	fn a_custom_emoji_is_already_markup_in_both_modes() {
		// The custom form carries the id, so rewriting it as `:name:` would lose the emoji. Both
		// modes have to keep it whole.
		for token in ["<:serein_wave:9001>", "<a:serein_party:9001>"] {
			assert_eq!(copy_payload(token, false), token);
			assert_eq!(copy_payload(token, true), token);
		}
	}

	#[test]
	fn both_modes_agree_when_there_is_no_shortcode_to_use() {
		// Anything the bundled catalogue does not name has nothing to translate to, and inventing a
		// name would paste something other than what the user copied.
		for markdown in [false, true] {
			assert_eq!(copy_payload("漢", markdown), "漢");
		}
	}

	#[test]
	fn the_saved_preference_decides_what_reaches_the_clipboard() {
		// The flag is the only thing between the switch and the clipboard, so it has to be shown
		// moving the answer rather than merely existing.
		let previous = markdown_copy();
		set_markdown_copy(true);
		assert!(markdown_copy());
		assert_eq!(copy_payload("👍", markdown_copy()), ":thumbsup:");
		set_markdown_copy(false);
		assert!(!markdown_copy());
		assert_eq!(copy_payload("👍", markdown_copy()), "👍");
		set_markdown_copy(previous);
	}
}
