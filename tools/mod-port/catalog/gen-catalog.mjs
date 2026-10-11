// Generates the Rust catalog literal from D:/project/vencord-plugins.json.
// Ids, names and descriptions come from Vencord's own source.
//
// Classification is by FEASIBILITY IN A NATIVE CLIENT, never by how Vencord happens to implement a
// plugin. An earlier version of this file scanned Vencord's source for `dom`/`styles`/`store`
// usage and wrote "needs a DOM to inject into" for anything it found. That was wrong, and provably
// so: characterCounter, callTimer, platformIndicators, readAllNotificationsButton, showConnections
// and userVoiceShow are all implemented in Vencord with a stylesheet, and this client already does
// every one of them natively. A stylesheet is Vencord's technique, not a limitation here.
//
// So the rule is: an entry claims Native/Partial only if a real code path does that thing, and may
// carry a `setting` only if flipping a switch changes behaviour. Everything else that is portable is
// `Planned`, which is an honest "not built yet" and doubles as the porting backlog. Only the handful
// whose entire deliverable is a web page or Vencord's own backend are `Unsupported`.
import { readFileSync, writeFileSync } from 'node:fs';

const plugins = JSON.parse(readFileSync(process.env.VENCORD_PLUGINS ?? 'D:/project/vencord-plugins.json', 'utf8'));

// Verified present natively, with the code path that does it. Always on: these are just how this
// client renders, so there is nothing to switch.
const NATIVE = {
  characterCounter: 'Shows the remaining characters beside the composer, turning red at the limit',
  noReplyMention: 'Replies do not ping the original author',
  revealAllSpoilers: 'Spoilers reveal on click',
  platformIndicators: 'Platform indicators render on presence',
  roleColorEverywhere: 'Role colours apply to every surface',
  showConnections: 'Connections render on profiles',
  readAllNotificationsButton: 'A server can be marked read from its context menu',
  callTimer: 'Call duration shows in the voice bar',
  volumeBooster: 'Voice gain goes past 100%, as a device setting',
  noMiddleClickPaste: 'Middle-click does not fire a paste action',
  notificationVolume: 'Notification gain is a device setting',
  imageFilename: 'Filenames are visible before send',
  whoReacted: 'Reactions list who reacted',
  fixImagesQuality: 'Images load at their original resolution, never a downscaled proxy',
  alwaysExpandRoles: 'Role lists expand by default',
  userVoiceShow: 'Voice participants render in the member list',
  typingIndicator: 'The composer row names who is typing, and clears when nobody is',
  copyUserURLs: 'The user menu copies a discord.com/users link for the person it was opened on',
  copyStickerLinks: 'The sticker context menu copies the CDN link (media.discordapp.net/stickers/<id>.<ext>)',
};

// Implemented, but not the way the mod does it. `setting` names the preference a switch drives, and
// is only set where flipping that switch genuinely changes behaviour.
const PARTIAL = {
  fakeNitro: {
    note: 'Entitlement gates are off on this device; Discord can still refuse server-side',
    setting: 'LocalNitro',
  },
  showHiddenChannels: {
    note: 'Channels you cannot access are listed in Chat settings, off by default',
    setting: 'ShowHiddenChannels',
  },
  silentMessageToggle: {
    note: 'Silent send is the @silent message prefix, not a switch on the composer',
    setting: null,
  },
  alwaysAnimate: {
    note: 'One animation preference applies everywhere, not a per-surface control',
    setting: null,
  },
};

// The short list. Each of these exists to change a web page or to talk to Vencord's own services, so
// there is no client behaviour left to reproduce once you are not running a web app.
//
// Kept deliberately short. An earlier version of this file put 146 entries here on the strength of a
// scan for `dom`/`styles`/`store` usage in Vencord's source, which described Vencord's technique
// rather than a limit here - six plugins already implemented natively in this client are
// stylesheet-based upstream. `Unsupported` has to mean "there is nothing left to port", not "not
// built yet", or it stops being information.
const UNSUPPORTED = {
  'webPWA.browser': 'Exists to make Discord work as an installable web app; this client already is one',
  'webScreenShare.browser': 'Drives the browser tab-capture API, which has no native equivalent',
  'webContextMenus.web': 'Replaces the browser context menu on links',
  vencordToolbox: 'A patching toolbox for the minified web client, which does not exist here',
  crashHandler: 'Recovers from renderer-process crashes; a wgpu panic is not recoverable mid-frame',
  customRPC: 'Bridges to a locally running Discord RPC process, which this build does not ship',
  decor: 'Profile decorations come from a server-gated catalog this client does not implement',
};

// Implemented behind a switch. Only listed here once the switch drives something real - the
// settings page refuses to render an entry with no `setting`, and `Setting` has no variant that does
// not correspond to a preference that is read.
const OPT_IN = {
  dontRoundMyTimestamps: {
    note: 'Elapsed time is floored instead of rounded, so it never claims more time than has passed',
    setting: 'ExactTimestamps',
  },
  noTypingAnimation: {
    note: 'The typing indicator holds still, and stops asking for repaints to animate it',
    setting: 'NoTypingAnimation',
  },
  copyEmojiMarkdown: {
    note: 'Copying a Unicode emoji writes its :shortcode:; a custom emoji is already <:name:id>',
    setting: 'CopyEmojiMarkdown',
  },
  noServerEmojis: {
    note: 'Server emoji are left out of the : autocomplete list; the emoji picker keeps them',
    setting: 'NoServerEmojis',
  },
  plainFolderIcon: {
    note: 'A server folder paints a plain tile, keeping its colour, unread count and voice badge',
    setting: 'PlainFolderIcon',
  },
  replyTimestamp: {
    note: 'A replied-message preview carries the time it quotes, from loaded history only',
    setting: 'ReplyTimestamp',
  },
  fixCodeblockGap: {
    note: 'The gap between a code block and the following text is removed',
    setting: 'FixCodeblockGap',
  },
};

// Notes for planned entries whose Vencord description undersells what porting them here would take.
const PLANNED_NOTE = {
  messageLogger: 'Writes every message seen in a session to a local file',
  noBlockedMessages: 'Blocked users are silenced in notifications, but their messages still show in chat',
  addAttachments: 'Attachments cannot be added while editing a message, which is the reverse of the mod',
  showAllMessageButtons: 'The message toolbar is still hover-only, with the extras behind shift',
  dontRoundMyTimestamps: 'Timestamps round the same way the web client rounds them',
  noTypingAnimation: 'The typing indicator pulses; animation is not suppressed',
  blurNsfw: 'NSFW is only read when editing a channel, never when rendering media',
  openInApp: 'Links open in the system browser rather than in the client',
  clearURLs: 'Tracking parameters are still passed through to opened links',
  unsuppressEmbeds: 'Embeds can be suppressed in the model, but no UI sets the flag',
  // These two depend on Vencord's own backend rather than on anything Discord serves, so the mod as
  // written cannot be reproduced. The underlying need is portable though, which is why they are
  // Planned and not Unsupported: a review UI can be built against a different data source, and
  // experiment overrides are just seeded flags.
  reviewDB: 'Vencord\'s crowdsourced review database is not reachable; the review UI itself is portable',
  experiments: 'There is no experiment registry to seed; the overrides are just flags on the session',
};

const rows = [];
for (const p of plugins) {
  const id = p.id;
  let port;
  let note = '';
  let setting = null;

  if (NATIVE[id]) {
    port = 'Native';
    note = NATIVE[id];
  } else if (OPT_IN[id]) {
    port = 'NativeOptIn';
    note = OPT_IN[id].note;
    setting = OPT_IN[id].setting;
  } else if (PARTIAL[id]) {
    port = 'Partial';
    note = PARTIAL[id].note;
    setting = PARTIAL[id].setting;
  } else if (UNSUPPORTED[id]) {
    port = 'Unsupported';
    note = UNSUPPORTED[id];
  } else {
    port = 'Planned';
    note = PLANNED_NOTE[id] || p.description;
  }
  rows.push({ id, name: p.vencordName, desc: p.description, port, note, setting });
}

function lit(s) {
  if (s === '') return '""';
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

const lines = [];
lines.push('//! Generated from Vencord\'s `src/plugins`; see the module docs for how to read it.');
lines.push('//!');
lines.push('//! Regenerate with `gen-catalog.js`; do not hand-edit.');
lines.push('');
lines.push('use super::{Plugin, Port, Setting};');
lines.push('');
lines.push('/// Every Vencord plugin, with what became of it here.');
lines.push('///');
lines.push('/// Ids, names and descriptions come from Vencord\'s own source, so a familiar name maps to a');
lines.push('/// familiar plugin and one that does not is never quietly dropped.');
lines.push('pub const ALL: &[Plugin] = &[');
for (const r of rows) {
  lines.push('\tPlugin {');
  lines.push(`\t\tid: ${lit(r.id)},`);
  lines.push(`\t\tname: ${lit(r.name)},`);
  lines.push(`\t\tdescription: ${lit(r.desc)},`);
  lines.push(`\t\tport: Port::${r.port},`);
  lines.push(`\t\tnote: ${lit(r.note)},`);
  lines.push(`\t\tsetting: ${r.setting ? 'Some(Setting::' + r.setting + ')' : 'None'},`);
  lines.push('\t},');
}
lines.push('];');

const output = process.env.CATALOG_OUT ?? 'crates/extensions/src/builtin_plugins/catalog.rs';
writeFileSync(output, lines.join('\n') + '\n');

const byPort = {};
for (const r of rows) byPort[r.port] = (byPort[r.port] || 0) + 1;
console.log('wrote catalog.rs:', rows.length, 'entries');
console.log(byPort);
console.log('toggleable:', rows.filter(r => r.setting).map(r => `${r.id} -> ${r.setting}`));
